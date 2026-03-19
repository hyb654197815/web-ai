# LangChain 后端 REST API：与前端 Agent 对接
import json
import os
import threading
import uuid
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent_runtime import DEFAULT_MESSAGE, run_agent, stream_agent_events
from config import CORS_ORIGINS, PORT, REFERENCES_DIR

app = FastAPI(
    title="便携式前端 AI Agent 后端",
    description="基于 LangChain 的前端站点 Agent 服务，仅支持路由跳转与站内操作问答。",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000, description="用户输入")
    sessionId: str | None = Field(None, description="会话 ID，可选")
    context: dict | None = Field(None, description="上下文，如 pathname")


class SessionMessageRequest(BaseModel):
    message: str | None = Field(None, max_length=2000, description="用户输入，可选")
    parts: list[dict] | None = Field(None, description="兼容 OpenCode 格式的消息片段")
    context: dict | None = Field(None, description="上下文，如 pathname")


class ChatResponse(BaseModel):
    action: str | None = None
    params: dict | None = None
    message: str = ""
    sessionId: str | None = None


MAX_SESSION_HISTORY = 24
_SESSION_LOCK = threading.Lock()
_SESSION_HISTORY: dict[str, list[dict[str, str]]] = {}


@app.get("/api/health")
def health():
    return {"status": "ok", "knowledge_dir": REFERENCES_DIR}


def _normalize_path_candidate(value: str | None) -> str:
    candidate = str(value or "").strip()
    if not candidate:
        return "/"

    if candidate.startswith("http://") or candidate.startswith("https://"):
        parsed = urlparse(candidate)
        if parsed.fragment:
            fragment = parsed.fragment
            if fragment.startswith("!/"):
                fragment = fragment[1:]
            if fragment.startswith("/"):
                candidate = fragment
            else:
                candidate = parsed.path or "/"
        else:
            candidate = parsed.path or "/"

    if candidate.startswith("#!/"):
        candidate = candidate[2:]
    elif candidate.startswith("#"):
        candidate = candidate[1:]

    if not candidate.startswith("/"):
        return "/"

    for sep in ("?", "#"):
        idx = candidate.find(sep)
        if idx >= 0:
            candidate = candidate[:idx]

    candidate = candidate.strip() or "/"
    return candidate if candidate.startswith("/") else "/"


def _resolve_pathname(body: ChatRequest | SessionMessageRequest) -> str:
    if not isinstance(body.context, dict):
        return "/"

    for key in ("pathname", "route", "currentPath"):
        value = body.context.get(key)
        if isinstance(value, str):
            normalized = _normalize_path_candidate(value)
            if normalized != "/":
                return normalized

    for key in ("hash", "href"):
        value = body.context.get(key)
        if isinstance(value, str):
            normalized = _normalize_path_candidate(value)
            if normalized != "/":
                return normalized

    pathname = body.context.get("pathname")
    if isinstance(pathname, str):
        return _normalize_path_candidate(pathname)
    return "/"


def _extract_message_from_parts(parts: list[dict] | None) -> str:
    if not isinstance(parts, list):
        return ""
    for part in parts:
        if not isinstance(part, dict):
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
    return ""


def _resolve_message_or_raise(message: str | None, parts: list[dict] | None = None) -> str:
    candidate = ""
    if isinstance(message, str) and message.strip():
        candidate = message.strip()
    if not candidate:
        candidate = _extract_message_from_parts(parts)
    if not candidate:
        raise HTTPException(status_code=422, detail="message is required")
    if len(candidate) > 2000:
        raise HTTPException(status_code=422, detail="message is too long (max 2000)")
    return candidate


def _resolve_or_create_session_id(session_id: str | None) -> str:
    candidate = str(session_id or "").strip()
    if candidate:
        return candidate
    return uuid.uuid4().hex


def _get_session_history_snapshot(session_id: str) -> list[dict[str, str]]:
    with _SESSION_LOCK:
        return list(_SESSION_HISTORY.get(session_id, []))


def _record_session_turn(session_id: str, user_message: str, assistant_payload: dict[str, Any]) -> None:
    normalized_user = str(user_message or "").strip()
    if not normalized_user:
        return

    if assistant_payload.get("action") == "navigate":
        try:
            assistant_message = json.dumps(assistant_payload, ensure_ascii=False)
        except TypeError:
            assistant_message = str(assistant_payload)
    else:
        assistant_message = str(assistant_payload.get("message") or DEFAULT_MESSAGE).strip() or DEFAULT_MESSAGE

    with _SESSION_LOCK:
        history = _SESSION_HISTORY.setdefault(session_id, [])
        history.append({"role": "user", "content": normalized_user})
        history.append({"role": "assistant", "content": assistant_message})
        if len(history) > MAX_SESSION_HISTORY:
            del history[:-MAX_SESSION_HISTORY]


def _encode_sse(event_name: str, payload: dict[str, Any]) -> str:
    data = json.dumps(payload, ensure_ascii=False)
    return f"event: {event_name}\ndata: {data}\n\n"


def _stream_chat_events(body: ChatRequest, pathname: str, session_id: str, history: list[dict[str, str]]) -> Iterator[str]:
    event_iter = stream_agent_events(body.message, pathname=pathname, history=history)
    recorded = False

    try:
        for event in event_iter:
            event_name = str(event.get("type") or "message")
            payload = {key: value for key, value in event.items() if key != "type"}
            payload["sessionId"] = session_id

            if event_name == "final" and isinstance(payload.get("payload"), dict):
                payload["payload"]["sessionId"] = session_id
                if not recorded:
                    _record_session_turn(session_id, body.message, payload["payload"])
                    recorded = True

            yield _encode_sse(event_name, payload)
    except GeneratorExit:
        try:
            event_iter.close()
        except Exception:
            pass
        return
    except Exception as exc:
        yield _encode_sse("error", {"message": f"stream failed: {exc}", "sessionId": session_id})

    yield _encode_sse("done", {"ok": True, "sessionId": session_id})


def _build_streaming_response(
    body: ChatRequest,
    pathname: str,
    session_id: str,
    history: list[dict[str, str]],
) -> StreamingResponse:
    return StreamingResponse(
        _stream_chat_events(body, pathname, session_id=session_id, history=history),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/chat", response_model=None)
def chat(body: ChatRequest, stream: bool = Query(False, description="是否启用 SSE 流式输出")) -> Any:
    pathname = _resolve_pathname(body)
    session_id = _resolve_or_create_session_id(body.sessionId)
    history = _get_session_history_snapshot(session_id)

    if stream:
        return _build_streaming_response(body, pathname, session_id=session_id, history=history)

    result = run_agent(body.message, pathname=pathname, history=history)
    result["sessionId"] = session_id
    _record_session_turn(session_id, body.message, result)
    return result


@app.post("/api/chat/stream", response_model=None)
def chat_stream(body: ChatRequest) -> StreamingResponse:
    pathname = _resolve_pathname(body)
    session_id = _resolve_or_create_session_id(body.sessionId)
    history = _get_session_history_snapshot(session_id)
    return _build_streaming_response(body, pathname, session_id=session_id, history=history)


@app.post("/api/session", response_model=None)
def create_session() -> dict[str, str]:
    session_id = _resolve_or_create_session_id(None)
    with _SESSION_LOCK:
        _SESSION_HISTORY.setdefault(session_id, [])
    return {"id": session_id, "sessionId": session_id}


@app.post("/api/session/{session_id}/message", response_model=None)
def session_message(
    session_id: str,
    body: SessionMessageRequest,
    stream: bool = Query(False, description="是否启用 SSE 流式输出"),
) -> Any:
    message = _resolve_message_or_raise(body.message, body.parts)
    chat_body = ChatRequest(message=message, sessionId=session_id, context=body.context)
    pathname = _resolve_pathname(chat_body)
    history = _get_session_history_snapshot(session_id)

    if stream:
        return _build_streaming_response(chat_body, pathname, session_id=session_id, history=history)

    result = run_agent(message, pathname=pathname, history=history)
    result["sessionId"] = session_id
    _record_session_turn(session_id, message, result)
    return result


def main():
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=PORT,
        reload=os.environ.get("RELOAD", "").lower() in ("1", "true", "yes"),
    )


if __name__ == "__main__":
    main()
