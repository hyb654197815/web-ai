# LangChain Agent backend REST API：与前端 Agent 对接
import json
import os
import re
import uuid
from collections.abc import Iterator
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent_runtime import run_agent, stream_agent_events
from config import CORS_ORIGINS, MODEL_NAME, NVIDIA_API_KEY, NVIDIA_BASE_URL, PORT, REFERENCES_DIR

app = FastAPI(
    title="便携式前端 AI Agent 后端",
    description="基于 LangChain Agent 的前端站点 Agent 服务，支持路由跳转、站内问答与当前页操作。",
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


def _page_agent_llm_enabled() -> bool:
    return bool((NVIDIA_BASE_URL or "").strip() and (MODEL_NAME or "").strip() and (NVIDIA_API_KEY or "").strip())


def _page_agent_proxy_base_url() -> str:
    return str(NVIDIA_BASE_URL or "").rstrip("/")


def _build_proxy_request_body(raw_body: bytes) -> bytes:
    if not raw_body:
        return raw_body

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        return raw_body

    if isinstance(payload, dict):
        payload["model"] = MODEL_NAME
        return json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return raw_body


def _build_page_agent_proxy_headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "User-Agent": "OpenAI/Python 1.0",
    }


def _is_plain_object(value: Any) -> bool:
    return isinstance(value, dict)


def _is_page_agent_macro_payload(value: Any) -> bool:
    return _is_plain_object(value) and (
        isinstance(value.get("action"), dict)
        or isinstance(value.get("evaluation_previous_goal"), str)
        or isinstance(value.get("memory"), str)
        or isinstance(value.get("next_goal"), str)
    )


PAGE_AGENT_TOOL_NAMES = {
    "done",
    "wait",
    "ask_user",
    "click_element_by_index",
    "input_text",
    "select_dropdown_option",
    "scroll",
    "scroll_horizontally",
    "execute_javascript",
}


def _coerce_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y", "success", "成功"}:
            return True
        if normalized in {"false", "0", "no", "n", "fail", "failed", "失败"}:
            return False
    return default


def _coerce_number(value: Any, default: float) -> float:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            return float(value.strip())
        except ValueError:
            return default
    return default


def _coerce_index(value: Any, default: int = 0) -> int:
    return max(0, int(_coerce_number(value, default)))


def _first_text(value: Any, keys: tuple[str, ...]) -> str:
    if isinstance(value, str):
        return value.strip()
    if not isinstance(value, dict):
        return ""
    for key in keys:
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return ""


def _extract_loose_string_field(source: str, field_name: str) -> str:
    if not isinstance(source, str):
        return ""

    match = re.search(rf"""["']{re.escape(field_name)}["']\s*:\s*["']""", source, flags=re.IGNORECASE)
    if not match:
        return ""

    end = len(source)
    while end > match.end() and source[end - 1].isspace():
        end -= 1
    while end > match.end() and source[end - 1] == "}":
        end -= 1
        while end > match.end() and source[end - 1].isspace():
            end -= 1
    if end > match.end() and source[end - 1] in {"'", '"'}:
        end -= 1

    return (
        source[match.end() : end]
        .replace(r"\"", '"')
        .replace(r"\n", "\n")
        .replace(r"\r", "\r")
        .replace(r"\t", "\t")
        .strip()
    )


def _normalize_page_agent_string_action(value: str) -> Any:
    source = value.strip()
    if not source:
        return value

    parsed = _parse_json_like(source)
    if isinstance(parsed, dict):
        return _normalize_page_agent_action(parsed)

    tool_name = next(
        (name for name in PAGE_AGENT_TOOL_NAMES if re.search(rf"""["']?{re.escape(name)}["']?\s*:""", source, flags=re.IGNORECASE)),
        "",
    )
    if not tool_name:
        return value

    if tool_name == "done":
        success_match = re.search(
            r"""["']success["']\s*:\s*("?)(true|false|1|0|yes|no|success|fail|成功|失败)\1""",
            source,
            flags=re.IGNORECASE,
        )
        return {
            "done": {
                "text": _extract_loose_string_field(source, "text") or source,
                "success": _coerce_bool(success_match.group(2) if success_match else None, True),
            }
        }

    if tool_name == "ask_user":
        return {
            "ask_user": {
                "question": _extract_loose_string_field(source, "question") or _extract_loose_string_field(source, "text")
            }
        }

    if tool_name == "wait":
        seconds_match = re.search(r"""["']seconds["']\s*:\s*("?)(\d+(?:\.\d+)?)\1""", source, flags=re.IGNORECASE)
        return {"wait": _normalize_page_agent_tool_input("wait", {"seconds": seconds_match.group(2) if seconds_match else None})}

    return value


def _normalize_page_agent_tool_input(tool_name: str, value: Any) -> Any:
    raw = value if isinstance(value, dict) else {}

    if tool_name == "done":
        text = _first_text(value, ("text", "message", "content", "answer", "summary", "data"))
        return {
            "text": text or ("" if value is None else str(value)),
            "success": _coerce_bool(raw.get("success"), True),
        }

    if tool_name == "wait":
        return {"seconds": min(10, max(1, _coerce_number(raw.get("seconds", value), 1)))}

    if tool_name == "ask_user":
        question = _first_text(value, ("question", "text", "message", "content"))
        return {"question": question or "请补充当前页操作需要的信息"}

    if tool_name == "click_element_by_index":
        return {"index": _coerce_index(raw.get("index", raw.get("element_index", raw.get("elementIndex", value))))}

    if tool_name in {"input_text", "select_dropdown_option"}:
        return {
            "index": _coerce_index(raw.get("index", raw.get("element_index", raw.get("elementIndex")))),
            "text": _first_text(value, ("text", "value", "content", "option", "message")),
        }

    if tool_name == "scroll":
        output: dict[str, Any] = {
            "down": _coerce_bool(raw.get("down"), True),
            "num_pages": min(10, max(0, _coerce_number(raw.get("num_pages", raw.get("numPages")), 0.1))),
        }
        if raw.get("pixels") is not None:
            output["pixels"] = _coerce_index(raw.get("pixels"))
        if raw.get("index") is not None:
            output["index"] = _coerce_index(raw.get("index"))
        return output

    if tool_name == "scroll_horizontally":
        output = {
            "right": _coerce_bool(raw.get("right"), True),
            "pixels": _coerce_index(raw.get("pixels"), 300),
        }
        if raw.get("index") is not None:
            output["index"] = _coerce_index(raw.get("index"))
        return output

    if tool_name == "execute_javascript":
        return {"script": _first_text(value, ("script", "code", "javascript", "text", "content"))}

    return value


def _parse_json_like(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except Exception:
        return value


def _normalize_page_agent_action(value: Any) -> Any:
    if isinstance(value, str):
        normalized_string_action = _normalize_page_agent_string_action(value)
        if normalized_string_action != value:
            return normalized_string_action

    action = _parse_json_like(value)
    if not isinstance(action, dict):
        return action

    explicit_name = ""
    for key in ("name", "tool", "tool_name", "action"):
        candidate = action.get(key)
        if isinstance(candidate, str) and candidate.strip():
            explicit_name = candidate.strip()
            break

    if explicit_name in PAGE_AGENT_TOOL_NAMES:
        explicit_input = (
            action.get("input")
            if "input" in action
            else action.get("arguments")
            if "arguments" in action
            else action.get("args")
            if "args" in action
            else action.get("params")
            if "params" in action
            else action.get("parameters")
            if "parameters" in action
            else action.get("value")
            if "value" in action
            else action.get("text")
            if "text" in action
            else action.get("message")
            if "message" in action
            else {}
        )
        return {explicit_name: _normalize_page_agent_tool_input(explicit_name, explicit_input)}

    for tool_name in action:
        if tool_name in PAGE_AGENT_TOOL_NAMES:
            return {tool_name: _normalize_page_agent_tool_input(tool_name, action.get(tool_name))}

    return action


def _normalize_page_agent_macro_payload(value: Any) -> Any:
    if not isinstance(value, dict):
        return value

    output = dict(value)
    if output.get("action") is not None:
        output["action"] = _normalize_page_agent_action(output.get("action"))
        return output

    explicit_action = _normalize_page_agent_action(output)
    if isinstance(explicit_action, dict) and any(key in PAGE_AGENT_TOOL_NAMES for key in explicit_action):
        return {"action": explicit_action}
    return output


def _extract_json_object_segments(text: str) -> list[dict[str, Any]]:
    source = str(text or "").strip()
    if not source:
        return []

    decoder = json.JSONDecoder()
    segments: list[dict[str, Any]] = []
    index = 0
    length = len(source)

    while index < length:
        while index < length and source[index].isspace():
            index += 1
        if index >= length:
            break
        if source[index] != "{":
            next_index = source.find("{", index + 1)
            if next_index < 0:
                break
            index = next_index
            continue
        try:
            parsed, end = decoder.raw_decode(source, index)
        except Exception:
            next_index = source.find("{", index + 1)
            if next_index < 0:
                break
            index = next_index
            continue
        if isinstance(parsed, dict):
            segments.append(parsed)
        index = end

    return segments


def _normalize_page_agent_json_text(value: Any) -> Any:
    if not isinstance(value, str):
        return value

    source = value.strip()
    if not source:
        return value

    for _ in range(2):
        try:
            parsed = json.loads(source)
        except Exception:
            break
        if isinstance(parsed, dict):
            return json.dumps(_normalize_page_agent_macro_payload(parsed), ensure_ascii=False)
        if isinstance(parsed, str) and parsed.strip() and parsed.strip() != source:
            source = parsed.strip()
            continue
        break

    segments = _extract_json_object_segments(source)
    if not segments:
        return value

    fallback: dict[str, Any] | None = None
    for segment in segments:
        if _is_page_agent_macro_payload(segment):
            return json.dumps(_normalize_page_agent_macro_payload(segment), ensure_ascii=False)
        if fallback is None or bool(segment):
            fallback = segment

    if fallback is not None:
        return json.dumps(_normalize_page_agent_macro_payload(fallback), ensure_ascii=False)
    return value


def _repair_page_agent_response_payload(payload: Any) -> tuple[Any, bool]:
    if not (_is_plain_object(payload) and isinstance(payload.get("choices"), list)):
        return payload, False

    changed = False
    for choice in payload["choices"]:
        if not _is_plain_object(choice):
            continue

        for message in (choice.get("message"), choice.get("delta")):
            if not _is_plain_object(message):
                continue

            content = message.get("content")
            if isinstance(content, str):
                normalized_content = _normalize_page_agent_json_text(content)
                if normalized_content != content:
                    message["content"] = normalized_content
                    changed = True

            tool_calls = message.get("tool_calls")
            if not isinstance(tool_calls, list):
                continue

            for tool_call in tool_calls:
                if not _is_plain_object(tool_call):
                    continue
                function = tool_call.get("function")
                if not _is_plain_object(function):
                    continue
                arguments = function.get("arguments")
                if not isinstance(arguments, str):
                    continue

                normalized_arguments = _normalize_page_agent_json_text(arguments)
                function_name = function.get("name")
                if isinstance(function_name, str) and function_name.strip() in PAGE_AGENT_TOOL_NAMES:
                    tool_name = function_name.strip()
                    parsed_arguments = _parse_json_like(normalized_arguments)
                    function["name"] = "AgentOutput"
                    function["arguments"] = json.dumps(
                        {"action": {tool_name: _normalize_page_agent_tool_input(tool_name, parsed_arguments)}},
                        ensure_ascii=False,
                    )
                    changed = True
                    continue

                if normalized_arguments != arguments:
                    function["arguments"] = normalized_arguments
                    changed = True

    return payload, changed


def _normalize_page_agent_proxy_response(content: bytes, content_type: str) -> bytes:
    if "application/json" not in str(content_type or "").lower():
        return content

    try:
        payload = json.loads(content.decode("utf-8"))
    except Exception:
        return content

    repaired_payload, changed = _repair_page_agent_response_payload(payload)
    if not changed:
        return content

    return json.dumps(repaired_payload, ensure_ascii=False).encode("utf-8")


@app.get("/api/health")
def health():
    return {"status": "ok", "knowledge_dir": REFERENCES_DIR}


@app.get("/api/page-agent/config")
def page_agent_config() -> dict[str, Any]:
    return {
        "enabled": _page_agent_llm_enabled(),
        "model": str(MODEL_NAME or "").strip(),
    }


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


def _encode_sse(event_name: str, payload: dict[str, Any]) -> str:
    data = json.dumps(payload, ensure_ascii=False)
    return f"event: {event_name}\ndata: {data}\n\n"


def _stream_chat_events(body: ChatRequest, pathname: str, session_id: str) -> Iterator[str]:
    event_iter = stream_agent_events(body.message, pathname=pathname, session_id=session_id)

    try:
        for event in event_iter:
            event_name = str(event.get("type") or "message")
            payload = {key: value for key, value in event.items() if key != "type"}
            payload["sessionId"] = session_id

            if event_name == "final" and isinstance(payload.get("payload"), dict):
                payload["payload"]["sessionId"] = session_id

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


def _build_streaming_response(body: ChatRequest, pathname: str, session_id: str) -> StreamingResponse:
    return StreamingResponse(
        _stream_chat_events(body, pathname, session_id=session_id),
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

    if stream:
        return _build_streaming_response(body, pathname, session_id=session_id)

    result = run_agent(body.message, pathname=pathname, session_id=session_id)
    result["sessionId"] = session_id
    return result


@app.post("/api/page-agent/chat/completions", response_model=None)
async def page_agent_chat_completions(request: Request) -> Response:
    if not _page_agent_llm_enabled():
        raise HTTPException(status_code=503, detail="PageAgent LLM is not configured on server")

    upstream_request = UrlRequest(
        f"{_page_agent_proxy_base_url()}/chat/completions",
        data=_build_proxy_request_body(await request.body()),
        method="POST",
        headers=_build_page_agent_proxy_headers(),
    )

    try:
        with urlopen(upstream_request, timeout=120) as upstream_response:
            content = upstream_response.read()
            content_type = upstream_response.headers.get("Content-Type", "application/json")
            content = _normalize_page_agent_proxy_response(content, content_type)
            return Response(content=content, status_code=upstream_response.status, media_type=content_type.split(";")[0])
    except HTTPError as exc:
        content = exc.read()
        content_type = exc.headers.get("Content-Type", "application/json") if exc.headers else "application/json"
        content = _normalize_page_agent_proxy_response(content, content_type)
        return Response(content=content, status_code=exc.code, media_type=content_type.split(";")[0])
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Upstream LLM request failed: {exc.reason}") from exc


@app.post("/api/chat/stream", response_model=None)
def chat_stream(body: ChatRequest) -> StreamingResponse:
    pathname = _resolve_pathname(body)
    session_id = _resolve_or_create_session_id(body.sessionId)
    return _build_streaming_response(body, pathname, session_id=session_id)


@app.post("/api/session", response_model=None)
def create_session() -> dict[str, str]:
    session_id = _resolve_or_create_session_id(None)
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

    if stream:
        return _build_streaming_response(chat_body, pathname, session_id=session_id)

    result = run_agent(message, pathname=pathname, session_id=session_id)
    result["sessionId"] = session_id
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
