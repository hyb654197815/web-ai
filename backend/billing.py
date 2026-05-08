import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Request

from database import query_token_usage, record_token_usage


def _to_int(value: Any) -> int:
    if isinstance(value, bool) or value is None:
        return 0
    if isinstance(value, (int, float)):
        return max(0, int(value))
    if isinstance(value, str):
        try:
            return max(0, int(float(value.strip())))
        except ValueError:
            return 0
    return 0


def _price(value: Any) -> float:
    try:
        return max(0.0, float(value or 0))
    except (TypeError, ValueError):
        return 0.0


def _extract_usage(payload: Any) -> dict[str, int]:
    usage = payload.get("usage") if isinstance(payload, dict) else {}
    if not isinstance(usage, dict):
        usage = {}

    prompt_details = usage.get("prompt_tokens_details") if isinstance(usage.get("prompt_tokens_details"), dict) else {}
    completion_details = usage.get("completion_tokens_details") if isinstance(usage.get("completion_tokens_details"), dict) else {}
    cache_read = _to_int(
        prompt_details.get("cached_tokens")
        or prompt_details.get("cache_read_tokens")
        or prompt_details.get("cache_read_input_tokens")
        or usage.get("cache_read_tokens")
        or usage.get("cache_read_input_tokens")
        or usage.get("cached_tokens")
    )
    cache_write = _to_int(
        prompt_details.get("cache_creation_input_tokens")
        or prompt_details.get("cache_write_tokens")
        or usage.get("cache_write_tokens")
        or usage.get("cache_creation_input_tokens")
    )
    input_tokens = _to_int(usage.get("prompt_tokens") or usage.get("input_tokens"))
    output_tokens = _to_int(usage.get("completion_tokens") or usage.get("output_tokens"))
    if not output_tokens:
        output_tokens = _to_int(completion_details.get("accepted_prediction_tokens"))
    total_tokens = _to_int(usage.get("total_tokens"))
    if not total_tokens:
        total_tokens = input_tokens + output_tokens + cache_write
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_write_tokens": cache_write,
        "cache_read_tokens": cache_read,
        "total_tokens": total_tokens,
    }


def usage_from_response_bytes(content: bytes) -> dict[str, int]:
    if not content:
        return _extract_usage({})
    try:
        payload = json.loads(content.decode("utf-8"))
    except Exception:
        return _extract_usage({})
    return _extract_usage(payload)


def calculate_cost(model_config: dict[str, Any] | None, usage: dict[str, int]) -> float:
    model = model_config or {}
    standard_input_tokens = max(
        0,
        _to_int(usage.get("input_tokens"))
        - _to_int(usage.get("cache_write_tokens"))
        - _to_int(usage.get("cache_read_tokens")),
    )
    cost = (
        _price(model.get("input_price")) * standard_input_tokens
        + _price(model.get("output_price")) * _to_int(usage.get("output_tokens"))
        + _price(model.get("cache_write_price")) * _to_int(usage.get("cache_write_tokens"))
        + _price(model.get("cache_read_price")) * _to_int(usage.get("cache_read_tokens"))
    )
    return round(cost / 1_000_000, 8)


def api_key_identity(token_data: dict[str, Any] | None) -> tuple[str | None, str | None]:
    if not isinstance(token_data, dict) or token_data.get("role") == "admin":
        return None, None
    key_id = str(token_data.get("key_id") or "").strip() or None
    prefix = str(token_data.get("api_key") or "").strip() or None
    return key_id, prefix


def record_model_usage(
    *,
    request: Request,
    token_data: dict[str, Any] | None,
    model_config: dict[str, Any] | None,
    endpoint: str,
    status_code: int,
    usage: dict[str, int],
    started_at: float,
    error: str | None = None,
) -> None:
    key_id, key_prefix = api_key_identity(token_data)
    model = model_config or {}
    duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
    record_token_usage(
        {
            "request_id": uuid.uuid4().hex,
            "api_key_id": key_id,
            "api_key_prefix": key_prefix,
            "model_id": str(model.get("id") or "") or None,
            "model_name": str(model.get("model") or model.get("name") or "") or None,
            "provider": str(model.get("provider") or "") or None,
            "endpoint": endpoint,
            "request_type": "stream" if endpoint.endswith("/stream") else "chat.completions",
            "status_code": status_code,
            **usage,
            "cost": calculate_cost(model, usage),
            "duration_ms": duration_ms,
            "ip": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent", ""),
            "error": error,
            "created_at": datetime.now(timezone.utc),
        }
    )


def _range_start(range_value: str) -> datetime:
    normalized = str(range_value or "7d").strip().lower()
    days = 7
    if normalized in {"today", "1d"}:
        days = 1
    elif normalized.endswith("d"):
        try:
            days = max(1, min(365, int(normalized[:-1])))
        except ValueError:
            days = 7
    return datetime.now(timezone.utc) - timedelta(days=days)


def get_billing_usage(range_value: str = "7d", api_key_id: str | None = None, page: int = 1, page_size: int = 20) -> dict[str, Any]:
    size = max(1, min(100, int(page_size or 20)))
    current_page = max(1, int(page or 1))
    result = query_token_usage(
        since=_range_start(range_value),
        api_key_id=str(api_key_id or "").strip() or None,
        limit=size,
        offset=(current_page - 1) * size,
    )
    summary = result["summary"]
    return {
        "summary": {
            "total_requests": int(summary.get("total_requests") or 0),
            "input_tokens": int(summary.get("input_tokens") or 0),
            "output_tokens": int(summary.get("output_tokens") or 0),
            "cache_write_tokens": int(summary.get("cache_write_tokens") or 0),
            "cache_read_tokens": int(summary.get("cache_read_tokens") or 0),
            "total_tokens": int(summary.get("total_tokens") or 0),
            "total_cost": float(summary.get("total_cost") or 0),
            "avg_duration_ms": float(summary.get("avg_duration_ms") or 0),
        },
        "records": result["records"],
        "pagination": {
            "page": current_page,
            "page_size": size,
            "total": result["total"],
        },
    }
