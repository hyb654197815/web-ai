import re
from dataclasses import dataclass
from functools import lru_cache

from agent_prompts import build_user_prompt as render_user_prompt
from agent_settings import (
    AGENT_HISTORY_ITEM_CHARS,
    AGENT_MAX_DOC_CHARS,
    AGENT_MAX_HISTORY_LINES,
    AGENT_MAX_RELATED_DOCS,
    AGENT_MAX_ROUTE_LINES,
    EXPANDED_SCOPE_EXTRA_DOCS,
)
from agent_support import truncate
from tools import list_page_docs, read_page_doc, read_routes_doc


@dataclass(frozen=True)
class RouteEntry:
    path: str
    title: str
    doc_file: str
    keywords: tuple[str, ...]
    is_dynamic: bool


@dataclass(frozen=True)
class PromptContext:
    prompt: str
    routes: tuple[RouteEntry, ...]
    related_docs: tuple[tuple[str, str], ...]


def _clean_filename(filename: str) -> str:
    candidate = str(filename or "").strip().replace("\\", "/").split("/")[-1]
    if not candidate.endswith(".md") or ".." in candidate:
        return ""
    return candidate


def _split_table_row(line: str) -> list[str]:
    text = line.strip()
    if not text.startswith("|") or "|" not in text[1:]:
        return []
    return [cell.strip() for cell in text.strip("|").split("|")]


def _is_separator_row(cells: list[str]) -> bool:
    if not cells:
        return False
    return all(not cell.replace(" ", "") or re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)


def _parse_markdown_tables(markdown_text: str) -> list[tuple[list[str], list[list[str]]]]:
    tables: list[tuple[list[str], list[list[str]]]] = []
    lines = markdown_text.splitlines()
    index = 0
    while index < len(lines):
        first = _split_table_row(lines[index])
        if not first:
            index += 1
            continue

        block = [first]
        index += 1
        while index < len(lines):
            row = _split_table_row(lines[index])
            if not row:
                break
            block.append(row)
            index += 1

        if len(block) >= 2 and _is_separator_row(block[1]):
            tables.append((block[0], block[2:]))
    return tables


def _header_key(text: str) -> str:
    return re.sub(r"[\s_\-:/]", "", str(text or "").lower())


def _find_col(headers: list[str], keywords: tuple[str, ...], default_idx: int) -> int:
    keys = [_header_key(header) for header in headers]
    for idx, key in enumerate(keys):
        if any(keyword in key for keyword in keywords):
            return idx
    return min(default_idx, max(0, len(headers) - 1))


def _normalize_doc_file(value: str) -> str:
    text = str(value or "").strip()
    if text in {"", "-", "null", "None"}:
        return ""
    match = re.search(r"(page-[A-Za-z0-9._-]+\.md)", text)
    return _clean_filename(match.group(1) if match else text)


def _extract_keywords(path: str, title: str, doc_file: str) -> tuple[str, ...]:
    tokens: set[str] = set()
    for value in (path, title, doc_file.replace(".md", "")):
        raw = str(value or "").strip().lower()
        if not raw:
            continue
        tokens.add(raw)
        for part in re.split(r"[\/_\-\s]+", raw):
            if len(part) >= 2:
                tokens.add(part)
    return tuple(sorted(tokens, key=len, reverse=True))


def _is_dynamic_path(path: str) -> bool:
    return any(token in str(path or "") for token in (":", "*", "(.*)"))


def _match_dynamic_route(pattern: str, pathname: str) -> bool:
    route_pattern = str(pattern or "").strip()
    route_pathname = str(pathname or "/").strip() or "/"
    if not route_pattern:
        return False
    if route_pattern == route_pathname or route_pattern in {"/:path(.*)*", "/:pathMatch(.*)*"}:
        return True

    pattern_parts = [item for item in route_pattern.strip("/").split("/") if item]
    pathname_parts = [item for item in route_pathname.strip("/").split("/") if item]

    idx = 0
    for part in pattern_parts:
        if idx >= len(pathname_parts):
            return part.startswith(":") and "(.*)*" in part
        if part in {"*", "**"} or "(.*)*" in part:
            return True
        if part.startswith(":"):
            idx += 1
            continue
        if part != pathname_parts[idx]:
            return False
        idx += 1
    return idx == len(pathname_parts)


@lru_cache(maxsize=1)
def load_routes() -> tuple[RouteEntry, ...]:
    routes_doc = read_routes_doc()
    routes: list[RouteEntry] = []

    for headers, rows in _parse_markdown_tables(routes_doc):
        if len(headers) < 2:
            continue
        path_idx = _find_col(headers, ("路径", "path", "route"), 0)
        title_idx = _find_col(headers, ("页面", "title", "name", "说明"), 1)
        doc_idx = _find_col(headers, ("文档", "doc", "file"), min(3, len(headers) - 1))

        for row in rows:
            if path_idx >= len(row):
                continue
            path = str(row[path_idx] or "").strip()
            if not path or path == "-":
                continue

            title = str(row[title_idx] or "").strip() if title_idx < len(row) else ""
            doc_file = _normalize_doc_file(row[doc_idx] if doc_idx < len(row) else "")
            routes.append(RouteEntry(path, title, doc_file, _extract_keywords(path, title, doc_file), _is_dynamic_path(path)))

    return tuple(routes)


def find_current_route(pathname: str, routes: tuple[RouteEntry, ...]) -> RouteEntry | None:
    current_path = str(pathname or "/").strip() or "/"
    for route in routes:
        if route.path == current_path:
            return route

    dynamic_routes = [route for route in routes if route.is_dynamic and _match_dynamic_route(route.path, current_path)]
    return max(
        dynamic_routes,
        key=lambda item: len([segment for segment in item.path.split("/") if segment and not segment.startswith(":")]),
        default=None,
    )


def score_route(route: RouteEntry, user_text_lower: str, pathname: str) -> int:
    score = 25 if route.path == pathname else 12 if route.is_dynamic and _match_dynamic_route(route.path, pathname) else 0
    if route.path.lower() in user_text_lower:
        score += 18
    if route.title and route.title.lower() in user_text_lower:
        score += 12
    if route.doc_file and route.doc_file.lower().replace(".md", "") in user_text_lower:
        score += 8
    score += sum(1 for keyword in route.keywords[:6] if len(keyword) >= 2 and keyword in user_text_lower) * 2
    return score


def select_related_docs(
    user_message: str,
    pathname: str,
    routes: tuple[RouteEntry, ...],
    expand_scope: bool = False,
) -> tuple[tuple[str, str], ...]:
    user_lower = str(user_message or "").lower()
    current_path = str(pathname or "/").strip() or "/"
    ranked: list[tuple[int, str]] = []
    seen: set[str] = set()

    current_route = find_current_route(current_path, routes)
    if current_route and current_route.doc_file:
        ranked.append((999, current_route.doc_file))
        seen.add(current_route.doc_file)

    for route in routes:
        if not route.doc_file or route.doc_file in seen:
            continue
        score = score_route(route, user_lower, current_path)
        if score <= 0 and not expand_scope:
            continue
        ranked.append((max(score, 1), route.doc_file))
        seen.add(route.doc_file)

    ranked.sort(key=lambda item: item[0], reverse=True)
    limit = max(1, AGENT_MAX_RELATED_DOCS + EXPANDED_SCOPE_EXTRA_DOCS) if expand_scope else max(1, AGENT_MAX_RELATED_DOCS)

    selected: list[tuple[str, str]] = []
    for _, doc_file in ranked:
        if len(selected) >= limit:
            break
        content = read_page_doc(doc_file)
        if content.strip():
            selected.append((doc_file, truncate(content, AGENT_MAX_DOC_CHARS)))

    if expand_scope and len(selected) < limit:
        for doc_file in list_page_docs():
            if any(existing == doc_file for existing, _ in selected):
                continue
            content = read_page_doc(doc_file)
            if content.strip():
                selected.append((doc_file, truncate(content, AGENT_MAX_DOC_CHARS)))
            if len(selected) >= limit:
                break

    return tuple(selected)


def format_routes_snapshot(routes: tuple[RouteEntry, ...]) -> str:
    if not routes:
        return "无路由数据"
    return "\n".join(
        f"- {route.path} | {route.title or '-'} | {route.doc_file or '-'}"
        for route in routes[: max(1, AGENT_MAX_ROUTE_LINES)]
    )


def format_history(history: list[dict[str, str]] | None) -> str:
    if not history:
        return ""

    lines: list[str] = []
    for item in history[-AGENT_MAX_HISTORY_LINES :]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "user").strip().lower()
        if role not in {"user", "assistant"}:
            role = "user"
        content = truncate(str(item.get("content") or ""), AGENT_HISTORY_ITEM_CHARS)
        if content:
            lines.append(f"{role}: {content}")
    return "\n".join(lines)


def format_related_docs_section(related_docs: tuple[tuple[str, str], ...]) -> str:
    if not related_docs:
        return "[相关页面文档]\n无"
    return "\n\n".join(f"[相关页面文档 #{idx}] {name}\n{content}" for idx, (name, content) in enumerate(related_docs, start=1))


def doc_file_names(docs: tuple[tuple[str, str], ...]) -> tuple[str, ...]:
    return tuple(name for name, _ in docs)


def build_prompt_context(
    user_message: str,
    pathname: str,
    history: list[dict[str, str]] | None,
    expand_scope: bool = False,
) -> PromptContext:
    routes = load_routes()
    related_docs = select_related_docs(user_message, pathname, routes, expand_scope=expand_scope)
    history_text = format_history(history)
    history_section = f"[会话历史]\n{history_text}\n\n" if history_text else ""
    prompt = render_user_prompt(
        current_page=str(pathname or "/").strip() or "/",
        session_history_section=history_section,
        routes_snapshot=format_routes_snapshot(routes),
        related_docs_section=format_related_docs_section(related_docs),
        user_request=str(user_message or "").strip(),
    )
    return PromptContext(prompt=prompt, routes=routes, related_docs=related_docs)
