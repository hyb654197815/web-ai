import json
import re
from typing import Any

from agent_context import RouteEntry, score_route
from agent_settings import (
    AGENT_MAX_MESSAGE_CHARS,
    ALLOWED_ACTIONS,
    DEFAULT_MESSAGE,
    DISALLOWED_RESPONSE_PATTERNS,
    GUIDE_INTENT_KEYWORDS,
    NAV_INTENT_KEYWORDS,
)
from agent_support import truncate


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


def strip_reasoning_text(raw_text: str) -> str:
    text = str(raw_text or "").strip()
    if not text:
        return ""

    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"^\s*思考[:：].*$", "", text, flags=re.MULTILINE).strip()
    return text


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

    return truncate(text, AGENT_MAX_MESSAGE_CHARS)


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


def _normalize_action_object(raw: Any, routes: tuple[RouteEntry, ...]) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    action = str(raw.get("action") or "").strip()
    if action not in ALLOWED_ACTIONS:
        return None

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
    return True


def _infer_navigation_payload(user_message: str, pathname: str, routes: tuple[RouteEntry, ...]) -> dict[str, Any] | None:
    if not _has_navigation_intent(user_message):
        return None

    user_lower = str(user_message or "").lower()
    current_path = str(pathname or "/").strip() or "/"
    ranked = sorted(((route, score_route(route, user_lower, current_path)) for route in routes), key=lambda item: item[1], reverse=True)
    if not ranked:
        return None

    best_route, score = ranked[0]
    if score < 12:
        return None

    return {
        "action": "navigate",
        "params": {"route": best_route.path},
        "message": _build_navigation_message(best_route.path, routes),
    }


def normalize_model_output(raw_text: str, user_message: str, routes: tuple[RouteEntry, ...], pathname: str) -> dict[str, Any]:
    raw = strip_reasoning_text(raw_text)
    parsed = _try_parse_json_dict(raw)
    candidates: list[dict[str, Any]] = []

    if isinstance(parsed, dict):
        candidates.append(parsed)
        for key in ("payload", "result", "data"):
            nested = parsed.get(key)
            if isinstance(nested, dict):
                candidates.append(nested)

    for candidate in candidates:
        action_payload = _normalize_action_object(candidate, routes)
        if action_payload is not None:
            return action_payload

        message = _extract_message_from_payload(candidate)
        if message:
            return {"message": message}

    plain_message = normalize_plain_message(raw)
    if plain_message:
        return {"message": plain_message}

    heuristic_navigation = _infer_navigation_payload(user_message, pathname, routes)
    if heuristic_navigation is not None:
        return heuristic_navigation

    return {"message": DEFAULT_MESSAGE}


def payload_is_unresolved(payload: dict[str, Any]) -> bool:
    if payload.get("action") in ALLOWED_ACTIONS:
        return False

    message = str(payload.get("message") or "").strip()
    return (not message) or any(marker in message for marker in (DEFAULT_MESSAGE, "信息不足", "无法准确", "未提供"))
