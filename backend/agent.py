from collections.abc import Iterator
import json
from typing import Any

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from agent_context import get_current_page_doc, get_routes_doc, load_routes
from agent_llm import create_llm
from agent_output import extract_last_ai_message_text, message_to_text, normalize_model_output, sanitize_user_visible_text
from agent_prompts import build_system_prompt, build_user_prompt
from agent_settings import DEFAULT_MESSAGE, STREAM_MAX_TOOL_PREVIEW_CHARS, STREAM_THINKING_SUMMARY_LIMIT
from agent_support import truncate
from agent_tools import build_agent_tools
from agent_admin import select_model_config

_CHECKPOINTER = InMemorySaver()


def _thinking_event(stage: str, title: str, summary: str) -> dict[str, Any]:
    return {
        "type": "thinking",
        "stage": stage,
        "title": title,
        "summary": truncate(sanitize_user_visible_text(summary), STREAM_THINKING_SUMMARY_LIMIT),
    }


def _agent_inputs(user_message: str, pathname: str) -> dict[str, Any]:
    return {
        "messages": [
            {
                "role": "user",
                "content": build_user_prompt(
                    current_page=str(pathname or "/").strip() or "/",
                    user_request=str(user_message or "").strip(),
                ),
            }
        ]
    }


def _agent_config(session_id: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": session_id}}


def _build_agent(pathname: str, *, streaming: bool, model_config: dict[str, Any] | None = None):
    return create_agent(
        model=create_llm(streaming=streaming, model_config=model_config),
        tools=build_agent_tools(pathname=pathname),
        system_prompt=build_system_prompt(routes_doc=get_routes_doc()),
        checkpointer=_CHECKPOINTER,
        name="frontend_site_agent",
    )


def _safe_json(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


def _iter_messages(value: Any) -> Iterator[BaseMessage]:
    if isinstance(value, list):
        for item in value:
            if isinstance(item, BaseMessage):
                yield item
        return
    if isinstance(value, BaseMessage):
        yield value


def _walk_messages(value: Any) -> Iterator[BaseMessage]:
    if isinstance(value, BaseMessage):
        yield value
        return
    if isinstance(value, dict):
        for item in value.values():
            yield from _walk_messages(item)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from _walk_messages(item)


def _summarize_ai_message(message: AIMessage) -> tuple[str, str] | None:
    tool_calls = getattr(message, "tool_calls", None) or []
    if tool_calls:
        tool_summaries = []
        for tool_call in tool_calls:
            name = str(tool_call.get("name") or "").strip() or "unknown_tool"
            if name in {"get_page_doc", "get_current_page_doc"}:
                tool_summaries.append("读取相关页面说明")
            elif name == "search_routes":
                tool_summaries.append("搜索候选页面")
            elif name.startswith("mcp_"):
                tool_summaries.append(f"调用 MCP 工具 {name}")
            else:
                tool_summaries.append(name)
        summary = "计划调用工具：" + "；".join(tool_summaries)
        return ("action", summary)

    text = message_to_text(message)
    if text.strip():
        sanitized = sanitize_user_visible_text(text.strip())
        if sanitized:
            return ("reason", f"形成阶段性判断：{truncate(sanitized, STREAM_MAX_TOOL_PREVIEW_CHARS)}")
    return None


def _summarize_tool_message(message: ToolMessage) -> str:
    tool_name = getattr(message, "name", None) or "tool"
    content = message_to_text(message).strip()

    if tool_name in {"get_page_doc", "get_current_page_doc"}:
        return f"{tool_name} 已返回相关页面说明。"

    if tool_name == "search_routes":
        count = len([line for line in content.splitlines() if line.strip().startswith("- ")])
        if count:
            return f"{tool_name} 已返回 {count} 个候选路由。"

    if tool_name.startswith("mcp_"):
        return f"{tool_name} 已返回 MCP 结果。"

    preview = truncate(sanitize_user_visible_text(content or "工具已返回结果。"), STREAM_MAX_TOOL_PREVIEW_CHARS)
    return f"{tool_name} 返回：{preview}"


def _handle_update_payload(payload: Any) -> Iterator[dict[str, Any]]:
    if not isinstance(payload, dict):
        return

    for node_name, node_payload in payload.items():
        for message in _iter_messages(node_payload.get("messages") if isinstance(node_payload, dict) else None):
            if isinstance(message, AIMessage):
                summary = _summarize_ai_message(message)
                if not summary:
                    continue
                stage, text = summary
                yield _thinking_event(stage, "模型推理", text)
            elif isinstance(message, ToolMessage):
                yield _thinking_event("observation", "工具观察", _summarize_tool_message(message))
        if isinstance(node_payload, dict) and node_payload.get("structured_response") is not None:
            yield _thinking_event(
                "reason",
                "结构化输出",
                truncate(sanitize_user_visible_text(_safe_json(node_payload.get("structured_response"))), STREAM_MAX_TOOL_PREVIEW_CHARS),
            )


def _collect_usage_from_update_payload(payload: Any, usage_collector: dict[str, int] | None) -> None:
    if usage_collector is None or not isinstance(payload, dict):
        return

    for node_payload in payload.values():
        messages = node_payload.get("messages") if isinstance(node_payload, dict) else None
        for message in _walk_messages(node_payload):
            if isinstance(message, (AIMessage, AIMessageChunk)):
                _merge_usage(usage_collector, _usage_from_message(message))


def _current_page_info(pathname: str) -> str:
    _, doc = get_current_page_doc(pathname)
    return doc


def _extract_payload_from_state(state: dict[str, Any], user_message: str, pathname: str) -> dict[str, Any]:
    routes = load_routes()
    current_page_info = _current_page_info(pathname)
    raw_text = extract_last_ai_message_text(state.get("messages"))
    if not raw_text and isinstance(state.get("structured_response"), dict):
        raw_text = _safe_json(state.get("structured_response"))
    return normalize_model_output(raw_text, user_message, routes, current_page_info=current_page_info)


def _error_message_for_exception(exc: Exception) -> str:
    message = str(exc or "").strip()
    return message or DEFAULT_MESSAGE


def _usage_from_message(message: AIMessage | AIMessageChunk) -> dict[str, int]:
    usage_metadata = getattr(message, "usage_metadata", None)
    response_metadata = getattr(message, "response_metadata", None)
    usage = usage_metadata if isinstance(usage_metadata, dict) else {}
    token_usage = response_metadata.get("token_usage") if isinstance(response_metadata, dict) and isinstance(response_metadata.get("token_usage"), dict) else {}

    def to_int(value: Any) -> int:
        if isinstance(value, bool) or value is None:
            return 0
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0

    input_tokens = to_int(usage.get("input_tokens") or token_usage.get("prompt_tokens"))
    output_tokens = to_int(usage.get("output_tokens") or token_usage.get("completion_tokens"))
    total_tokens = to_int(usage.get("total_tokens") or token_usage.get("total_tokens"))
    details = usage.get("input_token_details") if isinstance(usage.get("input_token_details"), dict) else {}
    prompt_details = token_usage.get("prompt_tokens_details") if isinstance(token_usage.get("prompt_tokens_details"), dict) else {}
    cache_read_tokens = to_int(
        details.get("cache_read")
        or details.get("cache_read_tokens")
        or prompt_details.get("cached_tokens")
        or prompt_details.get("cache_read_tokens")
    )
    cache_write_tokens = to_int(
        details.get("cache_creation")
        or details.get("cache_write")
        or details.get("cache_write_tokens")
        or prompt_details.get("cache_creation_input_tokens")
        or prompt_details.get("cache_write_tokens")
    )
    if not total_tokens:
        total_tokens = input_tokens + output_tokens + cache_write_tokens
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_write_tokens": cache_write_tokens,
        "cache_read_tokens": cache_read_tokens,
        "total_tokens": total_tokens,
    }


def _merge_usage(target: dict[str, int], usage: dict[str, int]) -> None:
    for key in ("input_tokens", "output_tokens", "cache_write_tokens", "cache_read_tokens", "total_tokens"):
        target[key] = int(target.get(key) or 0) + int(usage.get(key) or 0)


def _estimate_tokens(value: Any) -> int:
    text = message_to_text(value).strip() if isinstance(value, BaseMessage) else str(value or "").strip()
    if not text:
        return 0
    cjk = sum(1 for char in text if "\u4e00" <= char <= "\u9fff")
    other = max(0, len(text) - cjk)
    return max(1, int(cjk / 1.6 + other / 4))


def _estimate_usage_from_state(state: dict[str, Any], routes_doc: str) -> dict[str, int]:
    input_tokens = _estimate_tokens(routes_doc)
    output_tokens = 0
    for message in _walk_messages(state.get("messages")):
        if isinstance(message, (AIMessage, AIMessageChunk)):
            output_tokens += _estimate_tokens(message)
        elif isinstance(message, (HumanMessage, SystemMessage, ToolMessage)):
            input_tokens += _estimate_tokens(message)
        elif isinstance(message, BaseMessage):
            input_tokens += _estimate_tokens(message)
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_write_tokens": 0,
        "cache_read_tokens": 0,
        "total_tokens": input_tokens + output_tokens,
    }


def stream_agent_events(
    user_message: str,
    *,
    pathname: str = "/",
    session_id: str,
    model_config: dict[str, Any] | None = None,
    usage_collector: dict[str, int] | None = None,
) -> Iterator[dict[str, Any]]:
    try:
        selected_model = model_config or select_model_config()
        routes = load_routes()
        current_route, _ = get_current_page_doc(pathname)
        yield _thinking_event(
            "pending",
            "准备上下文",
            f"已加载路由清单（{len(routes)} 条路由），当前页面是 {current_route.path if current_route else pathname}。",
        )

        routes_doc = get_routes_doc()
        agent = _build_agent(pathname, streaming=True, model_config=selected_model)
        last_state: dict[str, Any] = {}

        for mode, data in agent.stream(
            _agent_inputs(user_message, pathname),
            _agent_config(session_id),
            stream_mode=["updates", "custom", "values"],
        ):
            if mode == "updates":
                _collect_usage_from_update_payload(data, usage_collector)
                yield from _handle_update_payload(data)
                continue
            if mode == "custom":
                if isinstance(data, dict):
                    stage = str(data.get("stage") or "tool")
                    title = str(data.get("title") or "工具调用")
                    summary = str(data.get("summary") or "").strip()
                    if summary:
                        yield _thinking_event(stage, title, summary)
                continue
            if mode == "values" and isinstance(data, dict):
                last_state = data

        if usage_collector is not None and not any(int(value or 0) for value in usage_collector.values()):
            for message in _iter_messages(last_state.get("messages")):
                if isinstance(message, (AIMessage, AIMessageChunk)):
                    _merge_usage(usage_collector, _usage_from_message(message))
            if not any(int(value or 0) for value in usage_collector.values()):
                _merge_usage(usage_collector, _estimate_usage_from_state(last_state, routes_doc))

        payload = _extract_payload_from_state(last_state, user_message, pathname)
        yield {"type": "final", "payload": payload}
    except Exception as exc:
        yield {"type": "error", "message": _error_message_for_exception(exc)}
        yield {"type": "final", "payload": {"message": DEFAULT_MESSAGE}}


def run_agent(
    user_message: str,
    *,
    pathname: str = "/",
    session_id: str,
    model_config: dict[str, Any] | None = None,
    usage_collector: dict[str, int] | None = None,
) -> dict[str, Any]:
    try:
        final_payload: dict[str, Any] | None = None
        for event in stream_agent_events(
            user_message,
            pathname=pathname,
            session_id=session_id,
            model_config=model_config,
            usage_collector=usage_collector,
        ):
            if event.get("type") == "final" and isinstance(event.get("payload"), dict):
                final_payload = event["payload"]
        return final_payload or {"message": DEFAULT_MESSAGE}
    except Exception as exc:
        message = _error_message_for_exception(exc)
        return {"message": message if "Missing" in message or "missing" in message else DEFAULT_MESSAGE}


__all__ = ["DEFAULT_MESSAGE", "run_agent", "stream_agent_events"]
