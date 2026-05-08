# LangChain Agent backend REST API：与前端 Agent 对接
import json
import os
import re
import time
import uuid
from collections.abc import Iterator
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from agent_admin import load_admin_config, probe_model, public_admin_config, save_admin_config, select_model_config, update_model_status
from agent_runtime import run_agent, stream_agent_events
from billing import get_billing_usage, record_model_usage, usage_from_response_bytes
from auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    bootstrap_admin_password,
    create_access_token,
    create_api_key,
    create_refresh_token,
    delete_api_key,
    exchange_api_key_for_token,
    get_admin_username,
    is_default_admin_password,
    list_api_keys,
    resolve_token_api_key,
    update_api_key,
    verify_access_token,
    verify_admin_credentials,
    verify_admin_token,
    verify_api_key_dependency,
    verify_token,
)
from config import CORS_ORIGINS, ENABLE_ADMIN_BACKEND, PORT, PROJECT_ROOT, REFERENCES_DIR
from database import write_json_config
from mcp_client import inspect_mcp_server, load_all_mcp_servers, mcp_server_from_payload
from request_logger import abuse_detector, get_recent_logs, log_api_key_event, log_request, log_security_event, request_stats

app = FastAPI(
    title="便携式前端 AI Agent 后端",
    description="基于 LangChain Agent 的前端站点 Agent 服务，支持路由跳转、站内问答与当前页操作。",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allow_headers=["*"],
)


# ==================== 中间件 ====================


@app.middleware("http")
async def logging_middleware(request: Request, call_next):
    """请求日志和监控中间件"""
    start_time = time.time()
    ip = request.client.host

    if not ENABLE_ADMIN_BACKEND and (
        request.url.path.startswith("/admin")
        or request.url.path.startswith("/api/admin")
        or request.url.path == "/api/auth/login"
    ):
        return JSONResponse(
            status_code=404,
            content={"error": "Not Found"},
        )

    # 检查速率限制（排除健康检查和静态资源）
    if not request.url.path.startswith(("/api/health", "/admin")):
        allowed, reason = abuse_detector.check_rate_limit(ip)
        if not allowed:
            log_security_event("rate_limit_exceeded", {"ip": ip, "reason": reason})
            return JSONResponse(
                status_code=429,
                content={"error": "Too many requests", "detail": reason}
            )

        # 检测可疑模式
        if abuse_detector.detect_suspicious_pattern(request):
            log_security_event("suspicious_pattern", {
                "ip": ip,
                "path": request.url.path,
                "user_agent": request.headers.get("user-agent", "")
            })

    # 处理请求
    response = None
    error = None
    try:
        response = await call_next(request)
    except Exception as e:
        error = str(e)
        response = JSONResponse(
            status_code=500,
            content={"error": "Internal server error"}
        )

    # 记录日志
    response_time = time.time() - start_time
    api_key = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer sk-"):
        api_key = auth_header.replace("Bearer ", "")

    log_request(
        request,
        response.status_code if response else 500,
        response_time,
        api_key=api_key,
        error=error
    )

    return response

ADMIN_HTML_PATH = PROJECT_ROOT / "backend" / "admin.html"
ADMIN_SCRIPT_PATH = PROJECT_ROOT / "dist" / "agent-admin.iife.js"


def ensure_admin_backend_enabled() -> None:
    if not ENABLE_ADMIN_BACKEND:
        raise HTTPException(status_code=404, detail="Admin backend is disabled")


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000, description="用户输入")
    sessionId: str | None = Field(None, description="会话 ID，可选")
    context: dict | None = Field(None, description="上下文，如 pathname")


class SessionMessageRequest(BaseModel):
    message: str | None = Field(None, max_length=2000, description="用户输入，可选")
    parts: list[dict] | None = Field(None, description="兼容 OpenCode 格式的消息片段")
    context: dict | None = Field(None, description="上下文，如 pathname")


def _page_agent_llm_enabled(model_config: dict[str, Any] | None = None) -> bool:
    selected = model_config or select_model_config()
    return bool(
        str((selected or {}).get("baseURL") or "").strip()
        and str((selected or {}).get("model") or (selected or {}).get("name") or "").strip()
        and str((selected or {}).get("apiKey") or "").strip()
    )


def _page_agent_proxy_base_url(model_config: dict[str, Any] | None = None) -> str:
    selected = model_config or select_model_config()
    return str((selected or {}).get("baseURL") or "").rstrip("/")


def _anthropic_messages_url(model_config: dict[str, Any] | None = None) -> str:
    base_url = _page_agent_proxy_base_url(model_config) or "https://api.anthropic.com"
    if base_url.endswith("/v1"):
        base_url = base_url[:-3]
    return f"{base_url}/v1/messages"


def _model_provider(model_config: dict[str, Any] | None = None) -> str:
    selected = model_config or select_model_config()
    return str((selected or {}).get("provider") or "OpenAI Compatible").strip()


def _is_official_openai_base_url(model_config: dict[str, Any] | None = None) -> bool:
    selected = model_config or select_model_config()
    base_url = str((selected or {}).get("baseURL") or "").strip()
    if not base_url:
        return False
    try:
        hostname = (urlparse(base_url).hostname or "").lower()
    except Exception:
        return False
    return hostname.endswith("openai.com")


def _build_proxy_request_body(raw_body: bytes, model_config: dict[str, Any] | None = None) -> bytes:
    if not raw_body:
        return raw_body

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        return raw_body

    if isinstance(payload, dict):
        selected = model_config or select_model_config()
        payload["model"] = str((selected or {}).get("model") or (selected or {}).get("name") or "").strip()

        # PageAgent 会在某些步骤里发送命名版 tool_choice：
        # { "type": "function", "function": { "name": "AgentOutput" } }
        # 一些 OpenAI-compatible 服务并不接受这个结构，只接受 "required"/"auto"。
        # 这里的代理端只服务 PageAgent，并且当前请求通常只有一个 AgentOutput 工具，
        # 因此把命名工具选择降级成 required 不会改变行为，但能显著提升兼容性。
        tool_choice = payload.get("tool_choice")
        tools = payload.get("tools")
        if (
            isinstance(tool_choice, dict)
            and str(tool_choice.get("type") or "").strip() == "function"
            and isinstance(tool_choice.get("function"), dict)
            and isinstance(tools, list)
            and len(tools) <= 1
        ):
            payload["tool_choice"] = "required"

        # 某些 OpenAI-compatible 服务并不支持 GPT 专属扩展字段，
        # 例如 verbosity / reasoning_effort。对非 OpenAI 官方域名统一裁掉。
        if not _is_official_openai_base_url(selected):
            payload.pop("verbosity", None)
            payload.pop("reasoning_effort", None)
            payload.pop("parallel_tool_calls", None)

        return json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return raw_body


def _build_page_agent_proxy_headers(model_config: dict[str, Any] | None = None) -> dict[str, str]:
    selected = model_config or select_model_config()
    provider = _model_provider(selected)
    if provider == "Anthropic":
        return {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-api-key": str((selected or {}).get("apiKey") or "").strip(),
            "anthropic-version": "2023-06-01",
        }
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {str((selected or {}).get('apiKey') or '').strip()}",
        "User-Agent": "OpenAI/Python 1.0",
    }


def _openai_content_to_anthropic(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                if isinstance(item.get("text"), str):
                    parts.append(item["text"])
                elif isinstance(item.get("content"), str):
                    parts.append(item["content"])
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return "" if content is None else str(content)


def _build_anthropic_request_body(raw_body: bytes, model_config: dict[str, Any]) -> bytes:
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception:
        payload = {}

    messages = payload.get("messages") if isinstance(payload, dict) else []
    system_parts: list[str] = []
    anthropic_messages: list[dict[str, str]] = []
    if isinstance(messages, list):
        for message in messages:
            if not isinstance(message, dict):
                continue
            role = str(message.get("role") or "user")
            content = _openai_content_to_anthropic(message.get("content"))
            if role == "system":
                if content:
                    system_parts.append(content)
                continue
            anthropic_messages.append({"role": "assistant" if role == "assistant" else "user", "content": content})

    body: dict[str, Any] = {
        "model": str(model_config.get("model") or model_config.get("name") or "").strip(),
        "max_tokens": int(payload.get("max_tokens") or payload.get("max_completion_tokens") or 1024) if isinstance(payload, dict) else 1024,
        "messages": anthropic_messages or [{"role": "user", "content": ""}],
    }
    if system_parts:
        body["system"] = "\n\n".join(system_parts)
    if isinstance(payload, dict) and isinstance(payload.get("temperature"), (int, float)):
        body["temperature"] = payload["temperature"]
    return json.dumps(body, ensure_ascii=False).encode("utf-8")


def _normalize_anthropic_response(content: bytes) -> bytes:
    try:
        payload = json.loads(content.decode("utf-8"))
    except Exception:
        return content

    text_parts: list[str] = []
    for item in payload.get("content", []) if isinstance(payload, dict) else []:
        if isinstance(item, dict) and item.get("type") == "text":
            text_parts.append(str(item.get("text") or ""))
    text = "\n".join(part for part in text_parts if part)
    openai_payload = {
        "id": payload.get("id", "anthropic-message") if isinstance(payload, dict) else "anthropic-message",
        "object": "chat.completion",
        "usage": payload.get("usage", {}) if isinstance(payload, dict) else {},
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
    }
    return json.dumps(openai_payload, ensure_ascii=False).encode("utf-8")


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


# ==================== 认证接口 ====================


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=1, max_length=100)


class TokenRequest(BaseModel):
    api_key: str = Field(..., min_length=1, description="API Key")


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1, description="刷新 Token")


class BootstrapAdminPasswordRequest(BaseModel):
    username: str | None = Field(None, min_length=1, max_length=50)
    new_password: str = Field(..., min_length=8, max_length=100)
    confirm_password: str = Field(..., min_length=8, max_length=100)


@app.get("/api/auth/bootstrap-status")
def auth_bootstrap_status():
    """获取管理员初始化状态"""
    ensure_admin_backend_enabled()
    return {
        "admin_backend_enabled": True,
        "requires_password_setup": is_default_admin_password(),
        "username": get_admin_username(),
    }


@app.post("/api/auth/bootstrap-admin-password")
def setup_admin_password(body: BootstrapAdminPasswordRequest):
    """首次启动时设置管理员密码"""
    ensure_admin_backend_enabled()
    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=400, detail="Password confirmation does not match")

    result = bootstrap_admin_password(body.new_password, body.username)
    log_security_event("admin_password_bootstrapped", {"username": result["username"]})
    return {
        "success": True,
        "username": result["username"],
    }


@app.post("/api/auth/login")
def login(body: LoginRequest):
    """管理员登录"""
    ensure_admin_backend_enabled()
    if is_default_admin_password():
        raise HTTPException(status_code=403, detail="Default admin password must be changed before admin login")
    if not verify_admin_credentials(body.username, body.password):
        log_security_event("login_failed", {"username": body.username})
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = create_access_token(data={"sub": body.username, "role": "admin"})
    refresh_token = create_refresh_token(data={"sub": body.username, "role": "admin"})

    log_security_event("login_success", {"username": body.username})

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


@app.post("/api/auth/token")
def get_token(body: TokenRequest):
    """使用 API Key 换取 Token"""
    try:
        result = exchange_api_key_for_token(body.api_key)
        log_api_key_event("token_exchanged", body.api_key)
        return result
    except HTTPException as e:
        log_security_event("token_exchange_failed", {"api_key": body.api_key[:10]})
        raise e


@app.post("/api/auth/refresh")
def refresh_token(body: RefreshTokenRequest):
    """刷新 Token"""
    try:
        payload = verify_token(body.refresh_token, "refresh")
        if payload.get("role") == "admin":
            ensure_admin_backend_enabled()
            if is_default_admin_password():
                raise HTTPException(status_code=403, detail="Default admin password must be changed before admin login")
        else:
            resolve_token_api_key(payload, enforce_rate_limit=False, update_usage=False)
        token_payload = {
            "sub": payload["sub"],
            "role": payload.get("role", "user"),
        }
        if payload.get("key_id"):
            token_payload["key_id"] = payload.get("key_id")
        if payload.get("api_key"):
            token_payload["api_key"] = payload.get("api_key")
        access_token = create_access_token(data=token_payload)
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }
    except HTTPException as e:
        log_security_event("token_refresh_failed", {})
        raise e


# ==================== API Key 管理接口 ====================


class CreateAPIKeyRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="API Key 名称")
    description: str = Field("", max_length=500, description="描述")
    expires_days: int | None = Field(None, ge=1, le=365, description="有效期（天）")
    rate_limit: int = Field(100, ge=1, le=1000, description="速率限制（每分钟）")


class UpdateAPIKeyRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)
    enabled: bool | None = None
    rate_limit: int | None = Field(None, ge=1, le=1000)
    expires_days: int | None = Field(None, ge=1, le=365)


@app.post("/api/admin/api-keys")
def create_api_key_endpoint(
    body: CreateAPIKeyRequest,
    _: dict = Depends(verify_admin_token)
):
    """创建新的 API Key（需要管理员权限）"""
    ensure_admin_backend_enabled()
    key_data = create_api_key(
        name=body.name,
        description=body.description,
        expires_days=body.expires_days,
        rate_limit=body.rate_limit,
    )
    log_api_key_event("created", key_data["key"], {"name": body.name})
    return key_data


@app.get("/api/admin/api-keys")
def list_api_keys_endpoint(_: dict = Depends(verify_admin_token)):
    """列出所有 API Keys（需要管理员权限）"""
    ensure_admin_backend_enabled()
    return {"keys": list_api_keys(include_key=True)}


@app.put("/api/admin/api-keys/{api_key}")
def update_api_key_endpoint(
    api_key: str,
    body: UpdateAPIKeyRequest,
    _: dict = Depends(verify_admin_token)
):
    """更新 API Key（需要管理员权限）"""
    ensure_admin_backend_enabled()
    updated = update_api_key(
        api_key=api_key,
        name=body.name,
        description=body.description,
        enabled=body.enabled,
        rate_limit=body.rate_limit,
        expires_days=body.expires_days,
    )
    log_api_key_event("updated", api_key, body.dict(exclude_none=True))
    return updated


@app.delete("/api/admin/api-keys/{api_key}")
def delete_api_key_endpoint(
    api_key: str,
    _: dict = Depends(verify_admin_token)
):
    """删除 API Key（需要管理员权限）"""
    ensure_admin_backend_enabled()
    success = delete_api_key(api_key)
    if not success:
        raise HTTPException(status_code=404, detail="API key not found")
    log_api_key_event("deleted", api_key)
    return {"success": True}


# ==================== 日志和监控接口 ====================


@app.get("/api/admin/logs")
def get_logs(
    log_type: str = Query("request", pattern="^(request|security)$"),
    limit: int = Query(100, ge=1, le=1000),
    _: dict = Depends(verify_admin_token)
):
    """获取日志（需要管理员权限）"""
    ensure_admin_backend_enabled()
    return {"logs": get_recent_logs(log_type, limit)}


@app.get("/api/admin/stats")
def get_stats(_: dict = Depends(verify_admin_token)):
    """获取统计数据（需要管理员权限）"""
    ensure_admin_backend_enabled()
    return {
        "request_stats": request_stats.get_stats(),
        "blocked_ips": abuse_detector.get_blocked_ips(),
        "suspicious_stats": abuse_detector.get_suspicious_stats(),
    }


@app.get("/api/admin/billing/usage")
def get_billing_usage_endpoint(
    range: str = Query("7d", description="统计范围，如 1d、7d、30d"),
    api_key_id: str | None = Query(None, description="API Key 内部 ID"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _: dict = Depends(verify_admin_token),
):
    """获取 token 计费统计与明细（需要管理员权限）"""
    ensure_admin_backend_enabled()
    return get_billing_usage(range, api_key_id=api_key_id, page=page, page_size=page_size)


@app.post("/api/admin/unblock-ip")
def unblock_ip(
    ip: str = Query(..., description="要解封的 IP"),
    _: dict = Depends(verify_admin_token)
):
    """解封 IP（需要管理员权限）"""
    ensure_admin_backend_enabled()
    abuse_detector.unblock_ip(ip)
    log_security_event("ip_unblocked", {"ip": ip})
    return {"success": True}


# ==================== 原有接口（保持不变）====================


@app.get("/admin", response_class=FileResponse)
@app.get("/admin/", response_class=FileResponse)
def agent_admin_page() -> FileResponse:
    """管理后台首页（模型配置）"""
    ensure_admin_backend_enabled()
    if not ADMIN_HTML_PATH.exists():
        raise HTTPException(status_code=404, detail="Agent admin HTML is missing")
    return FileResponse(
        ADMIN_HTML_PATH,
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/admin/agent-admin.iife.js", response_class=FileResponse)
def agent_admin_script() -> FileResponse:
    ensure_admin_backend_enabled()
    if not ADMIN_SCRIPT_PATH.exists():
        raise HTTPException(status_code=404, detail="Run npm run build before opening Agent admin")
    return FileResponse(
        ADMIN_SCRIPT_PATH,
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/page-agent/config")
def page_agent_config() -> dict[str, Any]:
    selected = select_model_config()
    return {
        "enabled": _page_agent_llm_enabled(selected),
        "model": str((selected or {}).get("model") or (selected or {}).get("name") or "").strip(),
    }


def _admin_mcp_servers() -> list[dict[str, Any]]:
    return [inspect_mcp_server(server) for server in load_all_mcp_servers()]


def _save_mcp_servers_from_payload(payload: dict[str, Any]) -> None:
    servers = payload.get("mcpServers")
    if not isinstance(servers, list):
        return

    rendered: dict[str, Any] = {}
    for server in servers:
        if not isinstance(server, dict):
            continue
        name = str(server.get("name") or "").strip()
        if not name:
            continue
        transport_type = str(server.get("type") or ("streamable_http" if server.get("url") else "stdio")).strip().lower() or "stdio"
        rendered_server: dict[str, Any] = {
            "enabled": bool(server.get("enabled", True)),
            "type": transport_type,
            "timeoutSeconds": float(server.get("timeoutSeconds") or server.get("timeout_seconds") or 8),
        }
        if transport_type in {"streamable_http", "http", "sse"}:
            rendered_server["url"] = str(server.get("url") or "").strip()
            if isinstance(server.get("headers"), dict):
                rendered_server["headers"] = server["headers"]
        else:
            rendered_server.update(
                {
                    "command": str(server.get("command") or "").strip(),
                    "args": server.get("args") if isinstance(server.get("args"), list) else [],
                    "cwd": str(server.get("cwd") or "").strip(),
                    "env": server.get("env") if isinstance(server.get("env"), dict) else {},
                }
            )
        rendered[name] = rendered_server

    write_json_config("mcp_servers", {"mcpServers": rendered})


@app.get("/api/admin/config")
def admin_config(_: dict = Depends(verify_admin_token)) -> dict[str, Any]:
    """获取管理配置（需要管理员权限）"""
    ensure_admin_backend_enabled()
    return {
        **public_admin_config(),
        "mcpServers": _admin_mcp_servers(),
    }


@app.post("/api/admin/config")
async def save_admin_config_endpoint(
    request: Request,
    _: dict = Depends(verify_admin_token)
) -> dict[str, Any]:
    """保存管理配置（需要管理员权限）"""
    ensure_admin_backend_enabled()
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=422, detail="invalid JSON body") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="body must be an object")

    _save_mcp_servers_from_payload(payload)
    saved = save_admin_config(payload)
    return {
        **public_admin_config(saved),
        "mcpServers": _admin_mcp_servers(),
    }


@app.post("/api/admin/models/probe")
async def admin_probe_model(
    request: Request,
    _: dict = Depends(verify_admin_token)
) -> dict[str, Any]:
    """探测模型（需要管理员权限）"""
    ensure_admin_backend_enabled()
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=422, detail="invalid JSON body") from exc
    model = payload.get("model") if isinstance(payload, dict) else None
    if not isinstance(model, dict):
        raise HTTPException(status_code=422, detail="model is required")

    api_key = str(model.get("apiKey") or "")
    model_id = str(model.get("id") or "").strip()
    if "*" in api_key and model_id:
        for saved_model in load_admin_config().get("models", []):
            if isinstance(saved_model, dict) and str(saved_model.get("id") or "").strip() == model_id:
                model = {**model, "apiKey": saved_model.get("apiKey") or ""}
                break

    result = probe_model(model)
    if model_id:
        from datetime import datetime, timezone

        update_model_status(model_id, {**result, "lastCheckedAt": datetime.now(timezone.utc).isoformat()})
    return result


@app.post("/api/admin/mcp/probe")
async def admin_probe_mcp(
    request: Request,
    _: dict = Depends(verify_admin_token)
) -> dict[str, Any]:
    """探测 MCP 服务器（需要管理员权限）"""
    ensure_admin_backend_enabled()
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=422, detail="invalid JSON body") from exc
    server_payload = payload.get("server") if isinstance(payload, dict) else None
    if not isinstance(server_payload, dict):
        raise HTTPException(status_code=422, detail="server is required")

    name = str(server_payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="server.name is required")

    server = mcp_server_from_payload(name, server_payload)
    if not server:
        raise HTTPException(status_code=422, detail="invalid MCP server config")
    return inspect_mcp_server(server)


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


def _empty_usage() -> dict[str, int]:
    return {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_write_tokens": 0,
        "cache_read_tokens": 0,
        "total_tokens": 0,
    }


def _stream_chat_events(
    body: ChatRequest,
    pathname: str,
    session_id: str,
    *,
    request: Request,
    token_data: dict[str, Any],
    model_config: dict[str, Any] | None,
    usage_collector: dict[str, int],
    started_at: float,
    endpoint: str,
) -> Iterator[str]:
    status_code = 200
    error_message = None
    event_iter = stream_agent_events(
        body.message,
        pathname=pathname,
        session_id=session_id,
        model_config=model_config,
        usage_collector=usage_collector,
    )

    try:
        for event in event_iter:
            event_name = str(event.get("type") or "message")
            if event_name == "error":
                status_code = 500
                error_message = str(event.get("message") or "")
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
        record_model_usage(
            request=request,
            token_data=token_data,
            model_config=model_config,
            endpoint=endpoint,
            status_code=499,
            usage=usage_collector,
            started_at=started_at,
            error="client disconnected",
        )
        return
    except Exception as exc:
        status_code = 500
        error_message = f"stream failed: {exc}"
        yield _encode_sse("error", {"message": f"stream failed: {exc}", "sessionId": session_id})

    yield _encode_sse("done", {"ok": True, "sessionId": session_id})
    record_model_usage(
        request=request,
        token_data=token_data,
        model_config=model_config,
        endpoint=endpoint,
        status_code=status_code,
        usage=usage_collector,
        started_at=started_at,
        error=error_message,
    )


def _build_streaming_response(
    body: ChatRequest,
    pathname: str,
    session_id: str,
    *,
    request: Request,
    token_data: dict[str, Any],
    endpoint: str,
) -> StreamingResponse:
    selected_model = select_model_config()
    usage_collector = _empty_usage()
    started_at = time.perf_counter()
    return StreamingResponse(
        _stream_chat_events(
            body,
            pathname,
            session_id=session_id,
            request=request,
            token_data=token_data,
            model_config=selected_model,
            usage_collector=usage_collector,
            started_at=started_at,
            endpoint=endpoint,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/chat", response_model=None)
def chat(
    request: Request,
    body: ChatRequest,
    stream: bool = Query(False, description="是否启用 SSE 流式输出"),
    token_data: dict = Depends(verify_access_token)
) -> Any:
    """聊天接口（需要 Token 认证）"""
    pathname = _resolve_pathname(body)
    session_id = _resolve_or_create_session_id(body.sessionId)

    if stream:
        return _build_streaming_response(
            body,
            pathname,
            session_id=session_id,
            request=request,
            token_data=token_data,
            endpoint="/api/chat",
        )

    selected_model = select_model_config()
    usage_collector = _empty_usage()
    started_at = time.perf_counter()
    try:
        result = run_agent(
            body.message,
            pathname=pathname,
            session_id=session_id,
            model_config=selected_model,
            usage_collector=usage_collector,
        )
        result["sessionId"] = session_id
        record_model_usage(
            request=request,
            token_data=token_data,
            model_config=selected_model,
            endpoint="/api/chat",
            status_code=200,
            usage=usage_collector,
            started_at=started_at,
        )
        return result
    except Exception as exc:
        record_model_usage(
            request=request,
            token_data=token_data,
            model_config=selected_model,
            endpoint="/api/chat",
            status_code=500,
            usage=usage_collector,
            started_at=started_at,
            error=str(exc),
        )
        raise


@app.post("/api/page-agent/chat/completions", response_model=None)
async def page_agent_chat_completions(
    request: Request,
    token_data: dict = Depends(verify_access_token)
) -> Response:
    """页面代理聊天完成接口（需要 Token 认证）"""
    raw_body = await request.body()
    attempted: set[str] = set()
    last_error = ""
    started_at = time.perf_counter()

    while True:
        selected_model = select_model_config(exclude_ids=attempted)
        if not _page_agent_llm_enabled(selected_model):
            break

        model_id = str((selected_model or {}).get("id") or "").strip()
        if model_id:
            attempted.add(model_id)

        provider = _model_provider(selected_model)
        endpoint = (
            _anthropic_messages_url(selected_model)
            if provider == "Anthropic"
            else f"{_page_agent_proxy_base_url(selected_model)}/chat/completions"
        )
        request_body = (
            _build_anthropic_request_body(raw_body, selected_model or {})
            if provider == "Anthropic"
            else _build_proxy_request_body(raw_body, selected_model)
        )
        upstream_request = UrlRequest(
            endpoint,
            data=request_body,
            method="POST",
            headers=_build_page_agent_proxy_headers(selected_model),
        )

        try:
            with urlopen(upstream_request, timeout=120) as upstream_response:
                content = upstream_response.read()
                content_type = upstream_response.headers.get("Content-Type", "application/json")
                content = _normalize_anthropic_response(content) if provider == "Anthropic" else _normalize_page_agent_proxy_response(content, content_type)
                record_model_usage(
                    request=request,
                    token_data=token_data,
                    model_config=selected_model,
                    endpoint="/api/page-agent/chat/completions",
                    status_code=upstream_response.status,
                    usage=usage_from_response_bytes(content),
                    started_at=started_at,
                )
                return Response(content=content, status_code=upstream_response.status, media_type="application/json")
        except HTTPError as exc:
            content = exc.read()
            content_type = exc.headers.get("Content-Type", "application/json") if exc.headers else "application/json"
            content = _normalize_anthropic_response(content) if provider == "Anthropic" else _normalize_page_agent_proxy_response(content, content_type)
            if exc.code < 500 and exc.code not in {401, 403, 404, 408, 429}:
                record_model_usage(
                    request=request,
                    token_data=token_data,
                    model_config=selected_model,
                    endpoint="/api/page-agent/chat/completions",
                    status_code=exc.code,
                    usage=usage_from_response_bytes(content),
                    started_at=started_at,
                    error=f"HTTP {exc.code}",
                )
                return Response(content=content, status_code=exc.code, media_type=content_type.split(";")[0])
            last_error = f"HTTP {exc.code}"
        except URLError as exc:
            last_error = str(exc.reason)

        if model_id:
            from datetime import datetime, timezone

            update_model_status(
                model_id,
                {
                    "status": "unavailable",
                    "lastError": last_error,
                    "lastCheckedAt": datetime.now(timezone.utc).isoformat(),
                },
            )

    record_model_usage(
        request=request,
        token_data=token_data,
        model_config=None,
        endpoint="/api/page-agent/chat/completions",
        status_code=502,
        usage={},
        started_at=started_at,
        error=last_error or "no model configured",
    )
    raise HTTPException(status_code=502, detail=f"All configured LLM models are unavailable: {last_error or 'no model configured'}")


@app.post("/api/chat/stream", response_model=None)
def chat_stream(
    request: Request,
    body: ChatRequest,
    token_data: dict = Depends(verify_access_token)
) -> StreamingResponse:
    """流式聊天接口（需要 Token 认证）"""
    pathname = _resolve_pathname(body)
    session_id = _resolve_or_create_session_id(body.sessionId)
    return _build_streaming_response(
        body,
        pathname,
        session_id=session_id,
        request=request,
        token_data=token_data,
        endpoint="/api/chat/stream",
    )


@app.post("/api/session", response_model=None)
def create_session(token_data: dict = Depends(verify_access_token)) -> dict[str, str]:
    """创建会话（需要 Token 认证）"""
    session_id = _resolve_or_create_session_id(None)
    return {"id": session_id, "sessionId": session_id}


@app.post("/api/session/{session_id}/message", response_model=None)
def session_message(
    request: Request,
    session_id: str,
    body: SessionMessageRequest,
    stream: bool = Query(False, description="是否启用 SSE 流式输出"),
    token_data: dict = Depends(verify_access_token)
) -> Any:
    """会话消息接口（需要 Token 认证）"""
    message = _resolve_message_or_raise(body.message, body.parts)
    chat_body = ChatRequest(message=message, sessionId=session_id, context=body.context)
    pathname = _resolve_pathname(chat_body)

    if stream:
        return _build_streaming_response(
            chat_body,
            pathname,
            session_id=session_id,
            request=request,
            token_data=token_data,
            endpoint="/api/session/{session_id}/message",
        )

    selected_model = select_model_config()
    usage_collector = _empty_usage()
    started_at = time.perf_counter()
    try:
        result = run_agent(
            message,
            pathname=pathname,
            session_id=session_id,
            model_config=selected_model,
            usage_collector=usage_collector,
        )
        result["sessionId"] = session_id
        record_model_usage(
            request=request,
            token_data=token_data,
            model_config=selected_model,
            endpoint="/api/session/{session_id}/message",
            status_code=200,
            usage=usage_collector,
            started_at=started_at,
        )
        return result
    except Exception as exc:
        record_model_usage(
            request=request,
            token_data=token_data,
            model_config=selected_model,
            endpoint="/api/session/{session_id}/message",
            status_code=500,
            usage=usage_collector,
            started_at=started_at,
            error=str(exc),
        )
        raise


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
