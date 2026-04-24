import re
from dataclasses import dataclass
from functools import lru_cache

from agent_settings import AGENT_ROUTE_SEARCH_LIMIT
from tools import read_page_doc, read_routes_doc


@dataclass(frozen=True)
class RouteEntry:
    path: str
    title: str
    doc_file: str
    keywords: tuple[str, ...]
    is_dynamic: bool


def _clean_filename(filename: str) -> str:
    candidate = str(filename or "").strip().replace("\\", "/").split("/")[-1]
    if not candidate.endswith(".md") or ".." in candidate:
        return ""
    return candidate


def _split_table_row(line: str) -> list[str]:
    text = line.strip()
    if "|" not in text:
        return []
    if text.startswith("|"):
        text = text.strip("|")
    return [cell.strip() for cell in text.split("|")]


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
def get_routes_doc() -> str:
    return read_routes_doc()


@lru_cache(maxsize=1)
def load_routes() -> tuple[RouteEntry, ...]:
    routes_doc = get_routes_doc()
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


def format_route_entry(route: RouteEntry) -> str:
    return f"{route.path} | {route.title or '-'} | {route.doc_file or '-'}"


def find_current_route(pathname: str, routes: tuple[RouteEntry, ...] | None = None) -> RouteEntry | None:
    available_routes = routes or load_routes()
    current_path = str(pathname or "/").strip() or "/"
    for route in available_routes:
        if route.path == current_path:
            return route

    dynamic_routes = [route for route in available_routes if route.is_dynamic and _match_dynamic_route(route.path, current_path)]
    return max(
        dynamic_routes,
        key=lambda item: len([segment for segment in item.path.split("/") if segment and not segment.startswith(":")]),
        default=None,
    )


def score_route(route: RouteEntry, query_text: str, pathname: str = "/") -> int:
    text = str(query_text or "").lower()
    current_path = str(pathname or "/").strip() or "/"

    score = 25 if route.path == current_path else 12 if route.is_dynamic and _match_dynamic_route(route.path, current_path) else 0
    if route.path.lower() in text:
        score += 18
    if route.title and route.title.lower() in text:
        score += 12
    if route.doc_file and route.doc_file.lower().replace(".md", "") in text:
        score += 8
    score += sum(1 for keyword in route.keywords[:8] if len(keyword) >= 2 and keyword in text) * 2
    return score


def search_routes(query: str, pathname: str = "/", limit: int = AGENT_ROUTE_SEARCH_LIMIT) -> tuple[RouteEntry, ...]:
    routes = load_routes()
    ranked = sorted(
        ((route, score_route(route, query, pathname=pathname)) for route in routes),
        key=lambda item: item[1],
        reverse=True,
    )
    selected = [route for route, score in ranked if score > 0][: max(1, limit)]
    return tuple(selected)


def resolve_route_reference(reference: str, pathname: str = "/", routes: tuple[RouteEntry, ...] | None = None) -> RouteEntry | None:
    available_routes = routes or load_routes()
    raw = str(reference or "").strip()
    if not raw or raw.lower() in {"current", "current_page", "current-route", "当前页", "当前页面"}:
        return find_current_route(pathname, available_routes)

    normalized = raw.replace("\\", "/").strip()
    if normalized.endswith(".md"):
        safe_doc = _clean_filename(normalized)
        return next((route for route in available_routes if route.doc_file == safe_doc), None)

    exact_route = next((route for route in available_routes if route.path == normalized), None)
    if exact_route:
        return exact_route

    if normalized.startswith("/"):
        return find_current_route(normalized, available_routes)

    lowered = normalized.lower()
    exact_title_matches = [route for route in available_routes if route.title.lower() == lowered]
    if len(exact_title_matches) == 1:
        return exact_title_matches[0]

    exact_doc_matches = [route for route in available_routes if route.doc_file.lower().replace(".md", "") == lowered]
    if len(exact_doc_matches) == 1:
        return exact_doc_matches[0]

    return None


def get_current_page_doc(pathname: str) -> tuple[RouteEntry | None, str]:
    route = find_current_route(pathname)
    if not route or not route.doc_file:
        return route, ""
    return route, read_page_doc(route.doc_file)
