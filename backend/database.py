import json
import os
import threading
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    delete,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.engine import Engine

from config import PROJECT_ROOT

DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "agent.sqlite3"


def _normalize_database_url(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return f"sqlite:///{DEFAULT_DATABASE_PATH.as_posix()}"
    if raw.startswith("sqlite:///") and not raw.startswith("sqlite:////"):
        db_path = Path(raw.removeprefix("sqlite:///")).expanduser()
        if not db_path.is_absolute():
            db_path = (PROJECT_ROOT / db_path).resolve()
        return f"sqlite:///{db_path.as_posix()}"
    return raw


DATABASE_URL = _normalize_database_url(os.environ.get("AGENT_DATABASE_URL") or os.environ.get("DATABASE_URL"))

metadata = MetaData()

admin_configs = Table(
    "agent_admin_configs",
    metadata,
    Column("key", String(100), primary_key=True),
    Column("value_json", Text, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

api_keys = Table(
    "agent_api_keys",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("key", String(160), nullable=False, unique=True),
    Column("name", String(100), nullable=False),
    Column("description", Text, nullable=False, default=""),
    Column("created_at", String(64), nullable=False),
    Column("expires_at", String(64), nullable=True),
    Column("enabled", Boolean, nullable=False, default=True),
    Column("rate_limit", Integer, nullable=False, default=100),
    Column("total_requests", Integer, nullable=False, default=0),
    Column("last_used_at", String(64), nullable=True),
)

token_usage = Table(
    "agent_token_usage",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("request_id", String(64), nullable=False),
    Column("api_key_id", String(64), nullable=True),
    Column("api_key_prefix", String(32), nullable=True),
    Column("model_id", String(160), nullable=True),
    Column("model_name", String(200), nullable=True),
    Column("provider", String(80), nullable=True),
    Column("endpoint", String(240), nullable=False),
    Column("request_type", String(80), nullable=False, default="chat.completions"),
    Column("status_code", Integer, nullable=False, default=0),
    Column("input_tokens", Integer, nullable=False, default=0),
    Column("output_tokens", Integer, nullable=False, default=0),
    Column("cache_write_tokens", Integer, nullable=False, default=0),
    Column("cache_read_tokens", Integer, nullable=False, default=0),
    Column("total_tokens", Integer, nullable=False, default=0),
    Column("cost", Float, nullable=False, default=0.0),
    Column("duration_ms", Float, nullable=False, default=0.0),
    Column("ip", String(80), nullable=True),
    Column("user_agent", Text, nullable=True),
    Column("error", Text, nullable=True),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

Index("idx_agent_token_usage_created_at", token_usage.c.created_at)
Index("idx_agent_token_usage_api_key", token_usage.c.api_key_id)
Index("idx_agent_token_usage_model", token_usage.c.model_id)

_ENGINE: Engine | None = None
_INIT_LOCK = threading.Lock()


def _json_default(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    return str(value)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _engine_kwargs(url: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"future": True, "pool_pre_ping": True}
    if url.startswith("sqlite:///"):
        db_path = Path(url.removeprefix("sqlite:///"))
        db_path.parent.mkdir(parents=True, exist_ok=True)
        kwargs["connect_args"] = {"check_same_thread": False}
    return kwargs


def get_engine() -> Engine:
    global _ENGINE
    if _ENGINE is None:
        with _INIT_LOCK:
            if _ENGINE is None:
                _ENGINE = create_engine(DATABASE_URL, **_engine_kwargs(DATABASE_URL))
                metadata.create_all(_ENGINE)
    return _ENGINE


def _read_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def read_json_config(config_key: str, legacy_path: Path | None = None) -> dict[str, Any]:
    engine = get_engine()
    with engine.begin() as conn:
        row = conn.execute(
            select(admin_configs.c.value_json).where(admin_configs.c.key == config_key)
        ).first()
        if row:
            try:
                payload = json.loads(row.value_json)
                return payload if isinstance(payload, dict) else {}
            except Exception:
                return {}

        legacy_payload = _read_json_file(legacy_path) if legacy_path else {}
        if legacy_payload:
            conn.execute(
                insert(admin_configs).values(
                    key=config_key,
                    value_json=json.dumps(legacy_payload, ensure_ascii=False, default=_json_default),
                    updated_at=_now(),
                )
            )
        return legacy_payload


def write_json_config(config_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    engine = get_engine()
    rendered = json.dumps(payload if isinstance(payload, dict) else {}, ensure_ascii=False, default=_json_default)
    now = _now()
    with engine.begin() as conn:
        result = conn.execute(
            update(admin_configs)
            .where(admin_configs.c.key == config_key)
            .values(value_json=rendered, updated_at=now)
        )
        if result.rowcount == 0:
            conn.execute(insert(admin_configs).values(key=config_key, value_json=rendered, updated_at=now))
    return payload


def _normalize_api_key_row(row: Any) -> dict[str, Any]:
    mapping = row._mapping if hasattr(row, "_mapping") else row
    return {
        "id": mapping["id"],
        "key": mapping["key"],
        "name": mapping["name"],
        "description": mapping["description"] or "",
        "created_at": mapping["created_at"],
        "expires_at": mapping["expires_at"],
        "enabled": bool(mapping["enabled"]),
        "rate_limit": int(mapping["rate_limit"] or 100),
        "total_requests": int(mapping["total_requests"] or 0),
        "last_used_at": mapping["last_used_at"],
    }


def read_api_keys(legacy_path: Path | None = None) -> dict[str, Any]:
    engine = get_engine()
    with engine.begin() as conn:
        rows = conn.execute(select(api_keys).order_by(api_keys.c.created_at.asc())).all()
        if rows:
            return {"keys": [_normalize_api_key_row(row) for row in rows]}

        legacy_payload = _read_json_file(legacy_path) if legacy_path else {}
        legacy_keys = legacy_payload.get("keys") if isinstance(legacy_payload.get("keys"), list) else []
        if legacy_keys:
            for item in legacy_keys:
                if not isinstance(item, dict) or not str(item.get("key") or "").strip():
                    continue
                conn.execute(
                    insert(api_keys).values(
                        id=str(item.get("id") or item.get("key") or "")[:64],
                        key=str(item.get("key") or ""),
                        name=str(item.get("name") or "API Key"),
                        description=str(item.get("description") or ""),
                        created_at=str(item.get("created_at") or _now().isoformat()),
                        expires_at=item.get("expires_at"),
                        enabled=bool(item.get("enabled", True)),
                        rate_limit=max(1, int(item.get("rate_limit") or 100)),
                        total_requests=max(0, int(item.get("total_requests") or 0)),
                        last_used_at=item.get("last_used_at"),
                    )
                )
        return {"keys": [_normalize_api_key_row(row) for row in conn.execute(select(api_keys)).all()]}


def write_api_keys(payload: dict[str, Any]) -> None:
    items = payload.get("keys") if isinstance(payload.get("keys"), list) else []
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(delete(api_keys))
        for item in items:
            if not isinstance(item, dict) or not str(item.get("key") or "").strip():
                continue
            conn.execute(
                insert(api_keys).values(
                    id=str(item.get("id") or item.get("key") or "")[:64],
                    key=str(item.get("key") or ""),
                    name=str(item.get("name") or "API Key"),
                    description=str(item.get("description") or ""),
                    created_at=str(item.get("created_at") or _now().isoformat()),
                    expires_at=item.get("expires_at"),
                    enabled=bool(item.get("enabled", True)),
                    rate_limit=max(1, int(item.get("rate_limit") or 100)),
                    total_requests=max(0, int(item.get("total_requests") or 0)),
                    last_used_at=item.get("last_used_at"),
                )
            )


def record_token_usage(record: dict[str, Any]) -> None:
    engine = get_engine()
    payload = {
        "request_id": str(record.get("request_id") or ""),
        "api_key_id": str(record.get("api_key_id") or "") or None,
        "api_key_prefix": str(record.get("api_key_prefix") or "") or None,
        "model_id": str(record.get("model_id") or "") or None,
        "model_name": str(record.get("model_name") or "") or None,
        "provider": str(record.get("provider") or "") or None,
        "endpoint": str(record.get("endpoint") or ""),
        "request_type": str(record.get("request_type") or "chat.completions"),
        "status_code": int(record.get("status_code") or 0),
        "input_tokens": max(0, int(record.get("input_tokens") or 0)),
        "output_tokens": max(0, int(record.get("output_tokens") or 0)),
        "cache_write_tokens": max(0, int(record.get("cache_write_tokens") or 0)),
        "cache_read_tokens": max(0, int(record.get("cache_read_tokens") or 0)),
        "total_tokens": max(0, int(record.get("total_tokens") or 0)),
        "cost": float(record.get("cost") or 0),
        "duration_ms": float(record.get("duration_ms") or 0),
        "ip": str(record.get("ip") or "")[:80] or None,
        "user_agent": str(record.get("user_agent") or "")[:1000] or None,
        "error": str(record.get("error") or "")[:2000] or None,
        "created_at": record.get("created_at") if isinstance(record.get("created_at"), datetime) else _now(),
    }
    with engine.begin() as conn:
        conn.execute(insert(token_usage).values(**payload))


def query_token_usage(*, since: datetime, api_key_id: str | None = None, limit: int = 100, offset: int = 0) -> dict[str, Any]:
    engine = get_engine()
    filters = [token_usage.c.created_at >= since]
    if api_key_id:
        filters.append(token_usage.c.api_key_id == api_key_id)

    summary_columns = [
        func.count().label("total_requests"),
        func.coalesce(func.sum(token_usage.c.input_tokens), 0).label("input_tokens"),
        func.coalesce(func.sum(token_usage.c.output_tokens), 0).label("output_tokens"),
        func.coalesce(func.sum(token_usage.c.cache_write_tokens), 0).label("cache_write_tokens"),
        func.coalesce(func.sum(token_usage.c.cache_read_tokens), 0).label("cache_read_tokens"),
        func.coalesce(func.sum(token_usage.c.total_tokens), 0).label("total_tokens"),
        func.coalesce(func.sum(token_usage.c.cost), 0).label("total_cost"),
        func.coalesce(func.avg(token_usage.c.duration_ms), 0).label("avg_duration_ms"),
    ]

    with engine.begin() as conn:
        summary_row = conn.execute(select(*summary_columns).where(*filters)).first()
        total_rows = conn.execute(select(func.count()).select_from(token_usage).where(*filters)).scalar_one()
        rows = conn.execute(
            select(token_usage)
            .where(*filters)
            .order_by(token_usage.c.created_at.desc())
            .limit(max(1, min(500, limit)))
            .offset(max(0, offset))
        ).all()

    summary = dict(summary_row._mapping) if summary_row else {}
    records = []
    for row in rows:
        item = dict(row._mapping)
        created_at = item.get("created_at")
        if isinstance(created_at, datetime):
            item["created_at"] = created_at.isoformat()
        records.append(item)
    return {"summary": summary, "total": int(total_rows or 0), "records": records}
