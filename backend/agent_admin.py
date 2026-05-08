import json
import threading
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from config import PROJECT_ROOT
from database import read_json_config, write_json_config

ADMIN_CONFIG_PATH = PROJECT_ROOT / "agent-admin.json"
_CONFIG_LOCK = threading.Lock()
_MODEL_CURSOR = 0
SUPPORTED_MODEL_PROVIDERS = {"OpenAI Compatible", "Anthropic"}


def _default_config() -> dict[str, Any]:
    return {
        "loadBalancing": {"enabled": True, "strategy": "round_robin"},
        "models": [],
    }


def _read_config_file() -> dict[str, Any]:
    return read_json_config("agent_admin", ADMIN_CONFIG_PATH)


def _model_id(index: int, model: dict[str, Any]) -> str:
    candidate = str(model.get("id") or "").strip()
    if candidate:
        return candidate
    name = str(model.get("model") or model.get("name") or f"model-{index + 1}").strip()
    return name.lower().replace("/", "-").replace(" ", "-") or f"model-{index + 1}"


def _normalize_model(index: int, raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    model_name = str(raw.get("model") or raw.get("name") or "").strip()
    if not model_name:
        return None
    provider = str(raw.get("provider") or "OpenAI Compatible").strip()
    if provider not in SUPPORTED_MODEL_PROVIDERS:
        provider = "OpenAI Compatible"
    return {
        "id": _model_id(index, raw),
        "name": str(raw.get("name") or model_name).strip(),
        "model": model_name,
        "provider": provider,
        "baseURL": str(raw.get("baseURL") or raw.get("base_url") or "").strip(),
        "apiKey": str(raw.get("apiKey") or raw.get("api_key") or "").strip(),
        "enabled": bool(raw.get("enabled", True)),
        "weight": max(1, int(raw.get("weight") or 1)),
        "status": str(raw.get("status") or "unknown").strip() or "unknown",
        "latencyMs": raw.get("latencyMs"),
        "lastCheckedAt": raw.get("lastCheckedAt"),
        "lastError": str(raw.get("lastError") or "").strip(),
        "input_price": _normalize_price(raw.get("input_price")),
        "output_price": _normalize_price(raw.get("output_price")),
        "cache_write_price": _normalize_price(raw.get("cache_write_price")),
        "cache_read_price": _normalize_price(raw.get("cache_read_price")),
    }


def _normalize_price(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return 0.0


def normalize_admin_config(raw: dict[str, Any] | None) -> dict[str, Any]:
    base = _default_config()
    payload = raw if isinstance(raw, dict) else {}
    raw_lb = payload.get("loadBalancing") if isinstance(payload.get("loadBalancing"), dict) else {}
    load_balancing = {
        "enabled": bool(raw_lb.get("enabled", base["loadBalancing"]["enabled"])),
        "strategy": str(raw_lb.get("strategy") or base["loadBalancing"]["strategy"]).strip() or "round_robin",
    }

    raw_models = payload.get("models")
    models = []
    if isinstance(raw_models, list):
        for index, item in enumerate(raw_models):
            model = _normalize_model(index, item)
            if model:
                models.append(model)
    return {"loadBalancing": load_balancing, "models": models}


def load_admin_config() -> dict[str, Any]:
    with _CONFIG_LOCK:
        return normalize_admin_config(_read_config_file())


def save_admin_config(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_admin_config(payload)
    with _CONFIG_LOCK:
        write_json_config("agent_admin", normalized)
    return normalized


def public_admin_config(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    return normalize_admin_config(payload or load_admin_config())


def _available_models(config: dict[str, Any], exclude_ids: set[str] | None = None) -> list[dict[str, Any]]:
    excluded = exclude_ids or set()
    models = [model for model in config.get("models", []) if model.get("enabled")]
    available = [model for model in models if str(model.get("status") or "").lower() != "unavailable"]
    candidates = available or models
    return [model for model in candidates if str(model.get("id") or "") not in excluded]


def select_model_config(exclude_ids: set[str] | None = None) -> dict[str, Any] | None:
    global _MODEL_CURSOR
    config = load_admin_config()
    models = _available_models(config, exclude_ids=exclude_ids)
    if not models:
        return None

    if not config.get("loadBalancing", {}).get("enabled", True):
        return models[0]

    weighted: list[dict[str, Any]] = []
    for model in models:
        weighted.extend([model] * max(1, int(model.get("weight") or 1)))

    selected = weighted[_MODEL_CURSOR % len(weighted)]
    _MODEL_CURSOR = (_MODEL_CURSOR + 1) % max(1, len(weighted))
    return selected


def update_model_status(model_id: str, status: dict[str, Any]) -> dict[str, Any]:
    config = load_admin_config()
    for model in config["models"]:
        if model.get("id") != model_id:
            continue
        model.update(status)
        break
    return save_admin_config(config)


def probe_model(model: dict[str, Any]) -> dict[str, Any]:
    import time

    provider = str(model.get("provider") or "OpenAI Compatible").strip()
    base_url = str(model.get("baseURL") or "").rstrip("/")
    api_key = str(model.get("apiKey") or "")
    model_name = str(model.get("model") or model.get("name") or "").strip()
    started = time.perf_counter()

    if provider not in SUPPORTED_MODEL_PROVIDERS:
        return {"status": "unavailable", "latencyMs": None, "lastError": "unsupported provider"}
    if not api_key or not model_name:
        return {"status": "unavailable", "latencyMs": None, "lastError": "missing apiKey or model"}

    if provider == "Anthropic":
        if base_url.endswith("/v1"):
            base_url = base_url[:-3]
        request = Request(
            f"{base_url or 'https://api.anthropic.com'}/v1/messages",
            data=json.dumps(
                {
                    "model": model_name,
                    "max_tokens": 8,
                    "messages": [{"role": "user", "content": "ping"}],
                }
            ).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
        )
        try:
            with urlopen(request, timeout=12):
                latency_ms = int((time.perf_counter() - started) * 1000)
                return {"status": "available", "latencyMs": latency_ms, "lastError": ""}
        except HTTPError as exc:
            return {"status": "unavailable", "latencyMs": None, "lastError": f"HTTP {exc.code}"}
        except URLError as exc:
            return {"status": "unavailable", "latencyMs": None, "lastError": str(exc.reason)}
        except Exception as exc:
            return {"status": "unavailable", "latencyMs": None, "lastError": str(exc)}

    if not base_url:
        return {"status": "unavailable", "latencyMs": None, "lastError": "missing baseURL"}

    request = Request(
        f"{base_url}/models",
        method="GET",
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
    )

    try:
        with urlopen(request, timeout=8) as response:
            body = response.read().decode("utf-8", errors="ignore")
            latency_ms = int((time.perf_counter() - started) * 1000)
            payload = json.loads(body) if body else {}
            items = payload.get("data") if isinstance(payload, dict) else None
            if isinstance(items, list) and items:
                known = {str(item.get("id") or item.get("name") or "") for item in items if isinstance(item, dict)}
                if model_name not in known:
                    return {
                        "status": "unknown",
                        "latencyMs": latency_ms,
                        "lastError": "model endpoint reachable, model id not listed",
                    }
            return {"status": "available", "latencyMs": latency_ms, "lastError": ""}
    except HTTPError as exc:
        return {"status": "unavailable", "latencyMs": None, "lastError": f"HTTP {exc.code}"}
    except URLError as exc:
        return {"status": "unavailable", "latencyMs": None, "lastError": str(exc.reason)}
    except Exception as exc:
        return {"status": "unavailable", "latencyMs": None, "lastError": str(exc)}
