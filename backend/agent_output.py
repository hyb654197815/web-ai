import json
import re
from typing import Any

from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage

from agent_context import RouteEntry
from agent_settings import (
    AGENT_MAX_MESSAGE_CHARS,
    ALLOWED_ACTIONS,
    CURRENT_PAGE_ACTION_CONTEXT_KEYWORDS,
    CURRENT_PAGE_READ_INTENT_KEYWORDS,
    DEFAULT_MESSAGE,
    DISALLOWED_RESPONSE_PATTERNS,
    FORM_INTENT_KEYWORDS,
    GUIDE_INTENT_KEYWORDS,
    NAV_INTENT_KEYWORDS,
)
from agent_support import truncate

SENSITIVE_SENTENCE_PATTERNS = (
    re.compile(r"[^。！？\n]*(组件文件|源码中|源码里|接口文件|sourceFiles|doc_file)[^。！？\n]*[。！？]?", flags=re.IGNORECASE),
    re.compile(r"[^。！？\n]*(src/|src\\|@/|page-[A-Za-z0-9._-]+\.md|routes\.md)[^。！？\n]*[。！？]?", flags=re.IGNORECASE),
)
SENSITIVE_INLINE_PATTERNS = (
    re.compile(r"`?(?:routes\.md|page-[A-Za-z0-9._-]+\.md)`?", flags=re.IGNORECASE),
    re.compile(r"`?(?:src[\\/][^`\s，。；,;)]*|@/[^\s`，。；,;)]*)`?", flags=re.IGNORECASE),
    re.compile(r"`?[A-Za-z0-9_./\\-]+\.(?:vue|js|ts|tsx|jsx|py|json|md)`?", flags=re.IGNORECASE),
)
WEAK_FORM_INTENT_KEYWORDS = {"帮我", "替我", "执行", "操作", "处理", "完成"}
AMBIGUOUS_NAV_FORM_KEYWORDS = {"打开", "切换"}
EXPLICIT_CURRENT_PAGE_CONTEXT_KEYWORDS = ("当前页", "当前页面", "这个页面", "本页", "这里", "页面上")
NAV_TARGET_KEYWORDS = ("页面", "模块", "菜单", "入口", "路由")


def content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                if item.get("type") in {"text", "output_text", "reasoning"} and isinstance(item.get("text"), str):
                    parts.append(item["text"])
                    continue
                if isinstance(item.get("content"), str):
                    parts.append(item["content"])
                    continue
            text = getattr(item, "text", None)
            if isinstance(text, str):
                parts.append(text)
        return "".join(parts)
    return str(content)


def message_to_text(message: BaseMessage | AIMessageChunk | Any) -> str:
    return content_to_text(getattr(message, "content", message))


def strip_reasoning_text(raw_text: str) -> str:
    text = str(raw_text or "").strip()
    if not text:
        return ""

    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"^\s*思考[:：].*$", "", text, flags=re.MULTILINE).strip()
    return text


def _try_parse_json_dict(text: str) -> dict[str, Any] | None:
    raw = str(text or "").strip()
    if not raw:
        return None

    def _parse(candidate: str) -> dict[str, Any] | None:
        try:
            value = json.loads(candidate)
        except Exception:
            return None
        return value if isinstance(value, dict) else None

    direct = _parse(raw)
    if direct is not None:
        return direct

    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, flags=re.IGNORECASE)
    if fenced:
        parsed = _parse(fenced.group(1).strip())
        if parsed is not None:
            return parsed

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        return _parse(raw[start : end + 1])
    return None


def normalize_plain_message(value: Any) -> str:
    text = strip_reasoning_text(str(value or "")).strip()
    if not text:
        return ""

    text = re.sub(r"^```(?:json|text|markdown)?\s*", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"\s*```$", "", text).strip()
    if not text:
        return ""

    if any(pattern.search(text) for pattern in DISALLOWED_RESPONSE_PATTERNS):
        return ""

    text = sanitize_user_visible_text(text)
    return truncate(text, AGENT_MAX_MESSAGE_CHARS)


def sanitize_user_visible_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    text = re.sub(r"```[\s\S]*?```", "", text).strip()

    for pattern in SENSITIVE_SENTENCE_PATTERNS:
        text = pattern.sub("", text)

    for pattern in SENSITIVE_INLINE_PATTERNS:
        text = pattern.sub("相关页面信息", text)

    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"([。！？]){2,}", r"\1", text)
    return text.strip()


def extract_last_ai_message_text(messages: list[Any] | None) -> str:
    if not isinstance(messages, list):
        return ""
    for message in reversed(messages):
        if isinstance(message, AIMessage):
            text = normalize_plain_message(message_to_text(message))
            if text:
                return text
    return ""


def _is_safe_route(route: Any) -> bool:
    if not isinstance(route, str):
        return False

    normalized = route.strip()
    if not normalized.startswith("/"):
        return False
    if normalized.startswith("//"):
        return False
    if len(normalized) > 300:
        return False
    if re.search(r"\s", normalized):
        return False
    if re.match(r"^(https?:|javascript:)", normalized, flags=re.IGNORECASE):
        return False
    return True


def _build_navigation_message(route: str, routes: tuple[RouteEntry, ...]) -> str:
    target = route.strip()
    matched = next((item for item in routes if item.path == target), None)
    if matched and matched.title:
        return f"正在跳转到{matched.title}。"
    return f"正在跳转到 {target}。"


def _build_form_payload(user_message: str, current_page_info: str, raw: dict[str, Any] | None = None) -> dict[str, Any]:
    params = raw.get("params") if isinstance(raw, dict) and isinstance(raw.get("params"), dict) else {}
    raw_page_info = params.get("pageInfo") or raw.get("pageInfo") if isinstance(raw, dict) else ""
    return {
        "action": "form",
        "params": {
            "message": str(user_message or "").strip(),
            "pageInfo": str(current_page_info or raw_page_info or ""),
        },
    }


def _normalize_action_object(
    raw: Any,
    routes: tuple[RouteEntry, ...],
    user_message: str,
    current_page_info: str,
) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    action = str(raw.get("action") or "").strip()
    if action not in ALLOWED_ACTIONS:
        return None

    if action == "form":
        return _build_form_payload(user_message, current_page_info, raw)

    params = raw.get("params") if isinstance(raw.get("params"), dict) else {}
    route = params.get("route") or params.get("path") or raw.get("route") or raw.get("path")
    if not _is_safe_route(route):
        return None

    normalized_route = str(route).strip()
    message = normalize_plain_message(raw.get("message")) or _build_navigation_message(normalized_route, routes)
    return {
        "action": "navigate",
        "params": {"route": normalized_route},
        "message": message,
    }


def _extract_message_from_payload(raw: Any) -> str:
    if not isinstance(raw, dict):
        return ""

    for key in ("message", "content", "answer", "text"):
        if isinstance(raw.get(key), str) and raw.get(key).strip():
            return normalize_plain_message(raw.get(key))

    parts = raw.get("parts")
    if isinstance(parts, list):
        for part in parts:
            if isinstance(part, dict) and isinstance(part.get("text"), str) and part.get("text").strip():
                return normalize_plain_message(part.get("text"))

    return ""


def _has_navigation_intent(user_message: str) -> bool:
    text = str(user_message or "").strip().lower()
    if not text:
        return False
    if not any(keyword in text for keyword in NAV_INTENT_KEYWORDS):
        return False
    if any(keyword in text for keyword in GUIDE_INTENT_KEYWORDS):
        return False
    if any(keyword in text for keyword in EXPLICIT_CURRENT_PAGE_CONTEXT_KEYWORDS):
        return False
    if any(keyword in text for keyword in NAV_TARGET_KEYWORDS):
        return True
    matched_form_keywords = {keyword for keyword in FORM_INTENT_KEYWORDS if keyword in text}
    if matched_form_keywords - AMBIGUOUS_NAV_FORM_KEYWORDS:
        return False
    if any(keyword in text for keyword in CURRENT_PAGE_ACTION_CONTEXT_KEYWORDS):
        return False
    return True


def _has_form_intent(user_message: str) -> bool:
    text = str(user_message or "").strip()
    text_lower = text.lower()
    if not text_lower:
        return False
    if _has_navigation_intent(text_lower):
        return False
    if any(keyword in text_lower for keyword in GUIDE_INTENT_KEYWORDS):
        return False
    if any(marker in text for marker in ("?", "？")):
        return False
    if any(keyword in text for keyword in EXPLICIT_CURRENT_PAGE_CONTEXT_KEYWORDS) and any(
        keyword in text for keyword in CURRENT_PAGE_READ_INTENT_KEYWORDS
    ):
        return True
    matched_keywords = {keyword for keyword in FORM_INTENT_KEYWORDS if keyword in text}
    if not matched_keywords:
        return False
    if matched_keywords - WEAK_FORM_INTENT_KEYWORDS:
        return True
    return any(keyword in text for keyword in CURRENT_PAGE_ACTION_CONTEXT_KEYWORDS)


def _should_force_form_action(user_message: str) -> bool:
    return _has_form_intent(user_message)


def normalize_model_output(
    raw_text: str,
    user_message: str,
    routes: tuple[RouteEntry, ...],
    current_page_info: str = "",
) -> dict[str, Any]:
    raw = strip_reasoning_text(raw_text)
    parsed = _try_parse_json_dict(raw)
    candidates: list[dict[str, Any]] = []
    fallback_message = ""

    if isinstance(parsed, dict):
        candidates.append(parsed)
        for key in ("payload", "result", "data"):
            nested = parsed.get(key)
            if isinstance(nested, dict):
                candidates.append(nested)

    for candidate in candidates:
        action_payload = _normalize_action_object(candidate, routes, user_message, current_page_info)
        if action_payload is not None:
            return action_payload

        message = _extract_message_from_payload(candidate)
        if message and not fallback_message:
            fallback_message = message

    if _should_force_form_action(user_message):
        return _build_form_payload(user_message, current_page_info)

    if fallback_message:
        return {"message": fallback_message}

    plain_message = normalize_plain_message(raw)
    if plain_message:
        return {"message": plain_message}

    return {"message": DEFAULT_MESSAGE}
