from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from agent_context import RouteEntry, build_prompt_context, doc_file_names
from agent_llm import build_messages, invoke_model, stream_model_chunks
from agent_output import normalize_model_output, payload_is_unresolved, strip_reasoning_text
from agent_settings import (
    DEFAULT_MESSAGE,
    MODEL_DONE_SUMMARY_LIMIT,
    STREAM_MAX_THINKING_EVENTS,
    STREAM_THINKING_FLUSH_CHARS,
    STREAM_THINKING_SUMMARY_LIMIT,
    THINKING_SUMMARY_LIMIT,
)
from agent_support import truncate


@dataclass(frozen=True)
class AgentRoundResult:
    prompt: str
    routes: tuple[RouteEntry, ...]
    related_docs: tuple[tuple[str, str], ...]
    raw: str
    payload: dict[str, Any]


def _thinking_event(stage: str, title: str, summary: str) -> dict[str, Any]:
    limit = STREAM_THINKING_SUMMARY_LIMIT if stage == "model_stream" else THINKING_SUMMARY_LIMIT
    return {
        "type": "thinking",
        "stage": stage,
        "title": title,
        "summary": truncate(summary, limit),
    }


def _execute_agent_round(
    user_message: str,
    pathname: str,
    history: list[dict[str, str]] | None,
    expand_scope: bool = False,
) -> AgentRoundResult:
    context = build_prompt_context(user_message, pathname, history, expand_scope=expand_scope)
    messages = build_messages(context.prompt)
    raw = invoke_model(messages, streaming=False)
    payload = normalize_model_output(raw, user_message, context.routes, pathname) if raw else {"message": DEFAULT_MESSAGE}
    return AgentRoundResult(
        prompt=context.prompt,
        routes=context.routes,
        related_docs=context.related_docs,
        raw=raw,
        payload=payload,
    )


def _stream_agent_round(
    user_message: str,
    pathname: str,
    history: list[dict[str, str]] | None,
    expand_scope: bool = False,
):
    context = build_prompt_context(user_message, pathname, history, expand_scope=expand_scope)
    yield _thinking_event(
        "prepare_context",
        "准备上下文",
        f"已加载路由 {len(context.routes)} 条，关联页面文档 {len(context.related_docs)} 份。",
    )

    messages = build_messages(context.prompt)
    all_parts: list[str] = []
    buffer = ""
    event_count = 0
    overflow_notified = False

    for chunk in stream_model_chunks(messages):
        all_parts.append(chunk)
        buffer += chunk
        while len(buffer) >= STREAM_THINKING_FLUSH_CHARS:
            piece = buffer[:STREAM_THINKING_FLUSH_CHARS]
            buffer = buffer[STREAM_THINKING_FLUSH_CHARS:]
            if not piece.strip():
                continue
            if event_count < STREAM_MAX_THINKING_EVENTS:
                yield _thinking_event("model_stream", "模型输出", piece)
                event_count += 1
            elif not overflow_notified:
                yield _thinking_event("model_stream", "模型输出", "中间流式片段较多，后续内容已省略展示。")
                overflow_notified = True

    if buffer.strip() and event_count < STREAM_MAX_THINKING_EVENTS:
        yield _thinking_event("model_stream", "模型输出", buffer)

    raw = "".join(all_parts).strip() or invoke_model(messages, streaming=False)
    yield _thinking_event("model_done", "模型完成", truncate(strip_reasoning_text(raw) or raw, MODEL_DONE_SUMMARY_LIMIT))
    return AgentRoundResult(
        prompt=context.prompt,
        routes=context.routes,
        related_docs=context.related_docs,
        raw=raw,
        payload=normalize_model_output(raw, user_message, context.routes, pathname) if raw else {"message": DEFAULT_MESSAGE},
    )


def _error_message_for_exception(exc: Exception) -> str:
    message = str(exc or "").strip()
    return message or DEFAULT_MESSAGE


def stream_agent_events(
    user_message: str,
    pathname: str = "/",
    history: list[dict[str, str]] | None = None,
) -> Iterator[dict[str, Any]]:
    try:
        yield _thinking_event("pending", "正在处理", "正在准备上下文...")
        first_round = yield from _stream_agent_round(user_message, pathname, history, expand_scope=False)

        payload = first_round.payload
        related_docs = first_round.related_docs

        if payload_is_unresolved(payload):
            yield _thinking_event("retry_start", "扩展检索重试", "首轮结果不充分，尝试扩大页面文档范围后重试。")
            retry_round = yield from _stream_agent_round(user_message, pathname, history, expand_scope=True)
            retry_docs = retry_round.related_docs
            if len(retry_docs) > len(related_docs) or doc_file_names(retry_docs) != doc_file_names(related_docs):
                retry_payload = retry_round.payload
                if not payload_is_unresolved(retry_payload):
                    payload = retry_payload
            yield _thinking_event("retry_done", "重试完成", "扩展文档后的重试已完成。")

        yield {"type": "final", "payload": payload}
    except Exception as exc:
        yield {"type": "error", "message": _error_message_for_exception(exc)}
        yield {"type": "final", "payload": {"message": DEFAULT_MESSAGE}}


def run_agent(
    user_message: str,
    pathname: str = "/",
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    try:
        resolved = _execute_agent_round(user_message, pathname, history, expand_scope=False)
        payload = resolved.payload
        related_docs = resolved.related_docs

        if payload_is_unresolved(payload):
            retry_resolved = _execute_agent_round(user_message, pathname, history, expand_scope=True)
            retry_docs = retry_resolved.related_docs
            if len(retry_docs) > len(related_docs) or doc_file_names(retry_docs) != doc_file_names(related_docs):
                retry_payload = retry_resolved.payload
                if not payload_is_unresolved(retry_payload):
                    return retry_payload

        return payload
    except Exception as exc:
        message = _error_message_for_exception(exc)
        return {"message": message if "Missing" in message or "missing" in message else DEFAULT_MESSAGE}


__all__ = ["DEFAULT_MESSAGE", "run_agent", "stream_agent_events"]
