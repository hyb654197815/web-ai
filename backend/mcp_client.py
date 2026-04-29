import json
import os
import queue
import re
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field, create_model

from config import PROJECT_ROOT, REFERENCES_DIR


@dataclass(frozen=True)
class McpServerConfig:
    name: str
    command: str
    args: tuple[str, ...] = ()
    cwd: str | None = None
    env: tuple[tuple[str, str], ...] = ()
    type: str = "stdio"
    url: str | None = None
    headers: tuple[tuple[str, str], ...] = ()
    enabled: bool = True
    timeout_seconds: float = 8.0


class EmptyMcpToolInput(BaseModel):
    pass


class McpConnectionError(RuntimeError):
    pass


def _env_flag(name: str, default: bool = True) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off", "disabled"}


def _coerce_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on", "enabled"}:
            return True
        if normalized in {"0", "false", "no", "off", "disabled"}:
            return False
    return default


def _resolve_path(value: str | None, *, default_base: Path = PROJECT_ROOT) -> str | None:
    if not value:
        return None
    rendered = _render_placeholders(value)
    path = Path(rendered).expanduser()
    return str(path if path.is_absolute() else (default_base / path).resolve())


def _render_placeholders(value: str) -> str:
    return (
        str(value or "")
        .replace("${PROJECT_ROOT}", str(PROJECT_ROOT))
        .replace("${REFERENCES_DIR}", str(REFERENCES_DIR))
    )


def _default_webgenerate_root() -> Path:
    references = Path(REFERENCES_DIR)
    if references.name.lower() == "webaidocs":
        return references.parent
    return PROJECT_ROOT


def _default_webgenerate_server() -> McpServerConfig | None:
    if not _env_flag("AGENT_MCP_WEBGENERATE", True):
        return None

    root = _default_webgenerate_root()
    if not (root / "webAIDocs").exists():
        return None

    script = PROJECT_ROOT / "scripts" / "webGenerate.js"
    if not script.exists():
        return None

    return McpServerConfig(
        name="webGenerate",
        command=os.environ.get("AGENT_MCP_WEBGENERATE_COMMAND", "node"),
        args=(str(script), "MCP", "--root", str(root)),
        cwd=str(root),
        enabled=True,
        timeout_seconds=float(os.environ.get("AGENT_MCP_TIMEOUT_SECONDS", "8") or "8"),
    )


def _candidate_config_paths() -> list[Path]:
    explicit = os.environ.get("AGENT_MCP_CONFIG")
    if explicit:
        return [Path(_render_placeholders(explicit)).expanduser()]
    return [
        PROJECT_ROOT / "mcp.json",
        PROJECT_ROOT / ".webgenerate" / "mcp.json",
        PROJECT_ROOT / "backend" / "mcp.json",
    ]


def _read_json_file(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _iter_custom_server_items(payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    raw_servers = payload.get("mcpServers", payload.get("servers", {}))
    if isinstance(raw_servers, dict):
        return [(str(name), value) for name, value in raw_servers.items() if isinstance(value, dict)]
    if isinstance(raw_servers, list):
        items: list[tuple[str, dict[str, Any]]] = []
        for item in raw_servers:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if name:
                items.append((name, item))
        return items
    return []


def _coerce_string_tuple(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(_render_placeholders(str(item)) for item in value)


def _coerce_env(value: Any) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, dict):
        return ()
    return tuple((str(key), _render_placeholders(str(item))) for key, item in value.items())


def _coerce_headers(value: Any) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, dict):
        return ()
    return tuple((str(key), _render_placeholders(str(item))) for key, item in value.items())


def _server_from_json(name: str, payload: dict[str, Any]) -> McpServerConfig | None:
    command = str(payload.get("command") or "").strip()
    transport_type = str(payload.get("type") or ("streamable_http" if payload.get("url") else "stdio")).strip().lower() or "stdio"
    url = str(payload.get("url") or "").strip()
    disabled = _coerce_bool(payload.get("disabled"), False)
    enabled = _coerce_bool(payload.get("enabled"), not disabled)

    try:
        timeout_seconds = float(payload.get("timeoutSeconds", payload.get("timeout_seconds", 8)) or 8)
    except (TypeError, ValueError):
        timeout_seconds = 8.0

    if transport_type in {"streamable_http", "http", "sse"}:
        return McpServerConfig(
            name=name,
            command="",
            type=transport_type,
            url=_render_placeholders(url),
            headers=_coerce_headers(payload.get("headers")),
            enabled=bool(enabled),
            timeout_seconds=max(1.0, timeout_seconds),
        )

    if not command:
        return McpServerConfig(name=name, command="", enabled=enabled)

    return McpServerConfig(
        name=name,
        command=_render_placeholders(command),
        args=_coerce_string_tuple(payload.get("args", [])),
        cwd=_resolve_path(payload.get("cwd")),
        env=_coerce_env(payload.get("env")),
        type="stdio",
        enabled=bool(enabled),
        timeout_seconds=max(1.0, timeout_seconds),
    )


def mcp_server_from_payload(name: str, payload: dict[str, Any]) -> McpServerConfig | None:
    return _server_from_json(name, payload)


def load_mcp_servers() -> tuple[McpServerConfig, ...]:
    return tuple(server for server in load_all_mcp_servers() if server.enabled and (server.command or server.url))


def load_all_mcp_servers() -> tuple[McpServerConfig, ...]:
    if not _env_flag("AGENT_MCP_ENABLED", True):
        return ()

    servers: dict[str, McpServerConfig] = {}
    default_server = _default_webgenerate_server()
    if default_server:
        servers[default_server.name] = default_server

    for config_path in _candidate_config_paths():
        if not config_path.exists():
            continue
        payload = _read_json_file(config_path)
        for name, raw_server in _iter_custom_server_items(payload):
            server = _server_from_json(name, raw_server)
            if server:
                servers[name] = server
        break

    return tuple(servers.values())


class McpStdioClient:
    def __init__(self, config: McpServerConfig):
        self.config = config
        self._request_id = 0
        self._process: subprocess.Popen[str] | None = None
        self._queue: queue.Queue[str] = queue.Queue()
        self._reader_thread: threading.Thread | None = None

    def __enter__(self) -> "McpStdioClient":
        env = os.environ.copy()
        env.update(dict(self.config.env))
        try:
            self._process = subprocess.Popen(
                [self.config.command, *self.config.args],
                cwd=self.config.cwd or str(PROJECT_ROOT),
                env=env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
        except Exception as exc:
            raise McpConnectionError(f"failed to start MCP server {self.config.name}: {exc}") from exc

        self._reader_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader_thread.start()
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        process = self._process
        if not process:
            return
        try:
            if process.stdin:
                process.stdin.close()
        except Exception:
            pass
        try:
            process.terminate()
            process.wait(timeout=1)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass

    def _read_stdout(self) -> None:
        process = self._process
        if not process or not process.stdout:
            return
        for line in process.stdout:
            if line.strip():
                self._queue.put(line)

    def initialize(self) -> None:
        self.request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "portable-ai-agent-backend", "version": "1.0.0"},
            },
        )
        self.notify("notifications/initialized", {})

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        self._request_id += 1
        request_id = self._request_id
        self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}})

        deadline = time.monotonic() + self.config.timeout_seconds
        while time.monotonic() < deadline:
            remaining = max(0.05, deadline - time.monotonic())
            try:
                line = self._queue.get(timeout=remaining)
            except queue.Empty:
                break
            try:
                message = json.loads(line)
            except Exception:
                continue
            if message.get("id") != request_id:
                continue
            if message.get("error"):
                error = message["error"]
                raise McpConnectionError(str(error.get("message") or error))
            return message.get("result")

        raise McpConnectionError(f"MCP server {self.config.name} timed out during {method}")

    def _send(self, payload: dict[str, Any]) -> None:
        process = self._process
        if not process or not process.stdin:
            raise McpConnectionError(f"MCP server {self.config.name} is not running")
        process.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
        process.stdin.flush()

    def list_tools(self) -> list[dict[str, Any]]:
        result = self.request("tools/list", {})
        tools = result.get("tools") if isinstance(result, dict) else None
        return [tool for tool in tools if isinstance(tool, dict)] if isinstance(tools, list) else []

    def list_resources(self) -> list[dict[str, Any]]:
        result = self.request("resources/list", {})
        resources = result.get("resources") if isinstance(result, dict) else None
        return [resource for resource in resources if isinstance(resource, dict)] if isinstance(resources, list) else []

    def list_prompts(self) -> list[dict[str, Any]]:
        result = self.request("prompts/list", {})
        prompts = result.get("prompts") if isinstance(result, dict) else None
        return [prompt for prompt in prompts if isinstance(prompt, dict)] if isinstance(prompts, list) else []

    def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        result = self.request("tools/call", {"name": name, "arguments": arguments})
        return format_mcp_tool_result(result)


class McpHttpClient:
    def __init__(self, config: McpServerConfig):
        self.config = config
        self._request_id = 0
        self._session_id: str | None = None

    def __enter__(self) -> "McpHttpClient":
        if not self.config.url:
            raise McpConnectionError(f"MCP server {self.config.name} is missing url")
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def initialize(self) -> None:
        self.request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "portable-ai-agent-backend", "version": "1.0.0"},
            },
        )
        self.notify("notifications/initialized", {})

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self._post({"jsonrpc": "2.0", "method": method, "params": params}, expect_response=False)

    def request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        self._request_id += 1
        request_id = self._request_id
        message = self._post({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}})
        if message.get("error"):
            error = message["error"]
            raise McpConnectionError(str(error.get("message") or error))
        return message.get("result")

    def _post(self, payload: dict[str, Any], *, expect_response: bool = True) -> dict[str, Any]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **dict(self.config.headers),
        }
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
        request = Request(
            self.config.url or "",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers=headers,
        )
        try:
            with urlopen(request, timeout=self.config.timeout_seconds) as response:
                session_id = response.headers.get("Mcp-Session-Id")
                if session_id:
                    self._session_id = session_id
                if not expect_response:
                    return {}
                body = response.read().decode("utf-8", errors="ignore")
                return self._parse_response(body, response.headers.get("Content-Type", ""))
        except Exception as exc:
            raise McpConnectionError(f"HTTP MCP request failed: {exc}") from exc

    def _parse_response(self, body: str, content_type: str) -> dict[str, Any]:
        if "text/event-stream" in str(content_type).lower() or body.lstrip().startswith("event:"):
            for line in body.splitlines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                parsed = json.loads(data)
                if isinstance(parsed, dict):
                    return parsed
            raise McpConnectionError("empty MCP event stream response")
        parsed = json.loads(body or "{}")
        if not isinstance(parsed, dict):
            raise McpConnectionError("invalid MCP HTTP response")
        return parsed

    def list_tools(self) -> list[dict[str, Any]]:
        result = self.request("tools/list", {})
        tools = result.get("tools") if isinstance(result, dict) else None
        return [tool for tool in tools if isinstance(tool, dict)] if isinstance(tools, list) else []

    def list_resources(self) -> list[dict[str, Any]]:
        result = self.request("resources/list", {})
        resources = result.get("resources") if isinstance(result, dict) else None
        return [resource for resource in resources if isinstance(resource, dict)] if isinstance(resources, list) else []

    def list_prompts(self) -> list[dict[str, Any]]:
        result = self.request("prompts/list", {})
        prompts = result.get("prompts") if isinstance(result, dict) else None
        return [prompt for prompt in prompts if isinstance(prompt, dict)] if isinstance(prompts, list) else []

    def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        result = self.request("tools/call", {"name": name, "arguments": arguments})
        return format_mcp_tool_result(result)


def open_mcp_client(server: McpServerConfig) -> McpStdioClient | McpHttpClient:
    if server.type in {"streamable_http", "http", "sse"}:
        return McpHttpClient(server)
    return McpStdioClient(server)


def inspect_mcp_server(server: McpServerConfig) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "name": server.name,
        "enabled": server.enabled,
        "type": server.type,
        "url": server.url,
        "command": server.command,
        "args": list(server.args),
        "cwd": server.cwd,
        "env": dict(server.env),
        "headers": dict(server.headers),
        "timeoutSeconds": server.timeout_seconds,
        "status": "disabled" if not server.enabled else "unknown",
        "toolsCount": 0,
        "resourcesCount": 0,
        "promptsCount": 0,
        "error": "",
    }

    if not server.enabled:
        return summary
    if server.type in {"streamable_http", "http", "sse"} and not server.url:
        summary["status"] = "unavailable"
        summary["error"] = "missing url"
        return summary
    if server.type == "stdio" and not server.command:
        summary["status"] = "unavailable"
        summary["error"] = "missing command"
        return summary

    try:
        with open_mcp_client(server) as client:
            client.initialize()
            summary["toolsCount"] = len(client.list_tools())
            try:
                summary["resourcesCount"] = len(client.list_resources())
            except Exception:
                summary["resourcesCount"] = 0
            try:
                summary["promptsCount"] = len(client.list_prompts())
            except Exception:
                summary["promptsCount"] = 0
            summary["status"] = "available"
    except Exception as exc:
        summary["status"] = "unavailable"
        summary["error"] = str(exc)
    return summary


def format_mcp_tool_result(result: Any) -> str:
    if not isinstance(result, dict):
        return "" if result is None else str(result)

    parts: list[str] = []
    content = result.get("content")
    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
            elif item.get("text") is not None:
                parts.append(str(item.get("text")))

    text = "\n".join(part for part in parts if part).strip()
    if not text:
        text = json.dumps(result, ensure_ascii=False)
    if result.get("isError"):
        return f"MCP tool returned an error:\n{text}"
    return text


def _tool_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "_", value).strip("_")
    return cleaned or "tool"


def _json_schema_type_to_python(schema: dict[str, Any]) -> Any:
    raw_type = schema.get("type")
    if raw_type == "string":
        return str
    if raw_type == "integer":
        return int
    if raw_type == "number":
        return float
    if raw_type == "boolean":
        return bool
    if raw_type == "array":
        return list
    if raw_type == "object":
        return dict
    return Any


def _args_schema_for_tool(server_name: str, tool_info: dict[str, Any]) -> type[BaseModel]:
    input_schema = tool_info.get("inputSchema") if isinstance(tool_info.get("inputSchema"), dict) else {}
    properties = input_schema.get("properties") if isinstance(input_schema.get("properties"), dict) else {}
    required = set(input_schema.get("required") if isinstance(input_schema.get("required"), list) else [])
    if not properties:
        return EmptyMcpToolInput

    fields: dict[str, tuple[Any, Any]] = {}
    for prop_name, prop_schema in properties.items():
        if not isinstance(prop_schema, dict):
            prop_schema = {}
        python_type = _json_schema_type_to_python(prop_schema)
        description = str(prop_schema.get("description") or "")
        if prop_name in required:
            fields[str(prop_name)] = (python_type, Field(..., description=description))
        else:
            fields[str(prop_name)] = (python_type | None, Field(None, description=description))

    model_name = f"Mcp{_tool_name(server_name).title()}{_tool_name(str(tool_info.get('name') or '')).title()}Input"
    return create_model(model_name, **fields)


def _discover_server_tools(server: McpServerConfig) -> list[dict[str, Any]]:
    try:
        with open_mcp_client(server) as client:
            client.initialize()
            return client.list_tools()
    except Exception:
        return []


def _call_mcp_tool(server: McpServerConfig, remote_tool_name: str, arguments: dict[str, Any]) -> str:
    try:
        with open_mcp_client(server) as client:
            client.initialize()
            return client.call_tool(remote_tool_name, arguments)
    except Exception as exc:
        return f"MCP tool call failed: {exc}"


def build_mcp_langchain_tools() -> list[StructuredTool]:
    tools: list[StructuredTool] = []
    for server in load_mcp_servers():
        for remote_tool in _discover_server_tools(server):
            remote_name = str(remote_tool.get("name") or "").strip()
            if not remote_name:
                continue
            exposed_name = f"mcp_{_tool_name(server.name)}_{_tool_name(remote_name)}"
            description = str(remote_tool.get("description") or f"MCP tool {remote_name} from {server.name}.")
            args_schema = _args_schema_for_tool(server.name, remote_tool)

            def make_runner(bound_server: McpServerConfig, bound_remote_name: str):
                def runner(**kwargs: Any) -> str:
                    return _call_mcp_tool(bound_server, bound_remote_name, kwargs)

                return runner

            runner = make_runner(server, remote_name)

            runner.__name__ = exposed_name
            tools.append(
                StructuredTool.from_function(
                    func=runner,
                    name=exposed_name,
                    description=f"[MCP:{server.name}] {description}",
                    args_schema=args_schema,
                )
            )
    return tools
