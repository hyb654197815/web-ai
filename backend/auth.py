# JWT Token 认证和 API Key 管理
import hashlib
import json
import os
import re
import secrets
import threading
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from dotenv import dotenv_values
from jwt import ExpiredSignatureError, InvalidTokenError
from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import PROJECT_ROOT
from database import read_api_keys, write_api_keys

# JWT 配置
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", secrets.token_urlsafe(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

# 管理员配置
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin123"
BACKEND_ENV_FILE = PROJECT_ROOT / "backend" / ".env"
_RUNTIME_ADMIN_SETTINGS: dict[str, str | None] = {"username": None, "password": None}

# API Key 存储文件
API_KEYS_FILE = PROJECT_ROOT / "api-keys.json"
_API_KEYS_LOCK = threading.Lock()

security = HTTPBearer()


class ApiKeyRateLimiter:
    """按 API Key 维度执行服务端限流。"""

    def __init__(self):
        self.request_history = defaultdict(list)
        self.lock = threading.Lock()

    def check(self, key_id: str, limit_per_minute: int) -> None:
        if not key_id or limit_per_minute <= 0:
            return

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(minutes=1)

        with self.lock:
            history = [ts for ts in self.request_history[key_id] if ts > cutoff]
            if len(history) >= limit_per_minute:
                raise HTTPException(
                    status_code=429,
                    detail=f"API key rate limit exceeded ({limit_per_minute}/minute)",
                )
            history.append(now)
            self.request_history[key_id] = history


api_key_rate_limiter = ApiKeyRateLimiter()


def _hash_password(password: str) -> str:
    """密码哈希"""
    return hashlib.sha256(password.encode()).hexdigest()


def _read_backend_env_values() -> dict[str, str]:
    try:
        payload = dotenv_values(BACKEND_ENV_FILE)
    except Exception:
        return {}

    normalized: dict[str, str] = {}
    for key, value in payload.items():
        if value is None:
            continue
        normalized[str(key)] = str(value).strip()
    return normalized


def _get_admin_setting(name: str, default: str) -> str:
    runtime_value = _RUNTIME_ADMIN_SETTINGS.get(name)
    if isinstance(runtime_value, str) and runtime_value.strip():
        return runtime_value.strip()

    env_key = f"ADMIN_{name.upper()}"
    file_values = _read_backend_env_values()
    file_value = str(file_values.get(env_key) or "").strip()
    if file_value:
        return file_value

    os_value = str(os.environ.get(env_key) or "").strip()
    if os_value:
        return os_value

    return default


def get_admin_username() -> str:
    return _get_admin_setting("username", DEFAULT_ADMIN_USERNAME)


def get_admin_password() -> str:
    return _get_admin_setting("password", DEFAULT_ADMIN_PASSWORD)


def _persist_backend_env(updates: dict[str, str]) -> None:
    pattern = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=")
    lines = []
    if BACKEND_ENV_FILE.exists():
        try:
            lines = BACKEND_ENV_FILE.read_text(encoding="utf-8").splitlines()
        except Exception:
            lines = []

    pending = {key: str(value).strip() for key, value in updates.items() if str(value).strip()}
    if not pending:
        return

    rendered: list[str] = []
    handled: set[str] = set()
    for line in lines:
        match = pattern.match(line)
        if match:
            key = match.group(1)
            if key in pending:
                rendered.append(f"{key}={pending[key]}")
                handled.add(key)
                continue
        rendered.append(line)

    for key, value in pending.items():
        if key in handled:
            continue
        if rendered and rendered[-1].strip():
            rendered.append("")
        rendered.append(f"{key}={value}")

    BACKEND_ENV_FILE.write_text("\n".join(rendered).rstrip() + "\n", encoding="utf-8")


def bootstrap_admin_password(new_password: str, username: str | None = None) -> dict[str, str]:
    password = str(new_password or "").strip()
    next_username = str(username or get_admin_username() or DEFAULT_ADMIN_USERNAME).strip() or DEFAULT_ADMIN_USERNAME

    if not is_default_admin_password():
        raise HTTPException(status_code=409, detail="Admin password has already been configured")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Admin password must be at least 8 characters")
    if password == DEFAULT_ADMIN_PASSWORD:
        raise HTTPException(status_code=400, detail="Admin password must be different from the default password")

    _persist_backend_env({
        "ADMIN_USERNAME": next_username,
        "ADMIN_PASSWORD": password,
    })
    _RUNTIME_ADMIN_SETTINGS["username"] = next_username
    _RUNTIME_ADMIN_SETTINGS["password"] = password
    os.environ["ADMIN_USERNAME"] = next_username
    os.environ["ADMIN_PASSWORD"] = password

    return {"username": next_username}


def verify_admin_credentials(username: str, password: str) -> bool:
    """验证管理员账号密码"""
    return username == get_admin_username() and _hash_password(password) == _hash_password(get_admin_password())


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """创建访问 Token"""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    """创建刷新 Token"""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str, token_type: str = "access") -> dict:
    """验证 Token"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("type") != token_type:
            raise HTTPException(status_code=401, detail=f"Invalid token type, expected {token_type}")
        return payload
    except ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def verify_access_token(credentials: HTTPAuthorizationCredentials = Security(security)) -> dict:
    """验证访问 Token（用于保护接口）"""
    payload = verify_token(credentials.credentials, "access")
    resolve_token_api_key(payload, enforce_rate_limit=True, update_usage=True)
    return payload


def verify_admin_token(credentials: HTTPAuthorizationCredentials = Security(security)) -> dict:
    """验证管理员 Token"""
    if is_default_admin_password():
        raise HTTPException(status_code=403, detail="Default admin password must be changed before admin login")
    payload = verify_token(credentials.credentials, "access")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


def is_default_admin_password() -> bool:
    return get_admin_password() == DEFAULT_ADMIN_PASSWORD


def _check_api_key_expiry(key_info: dict[str, Any]) -> None:
    expires_at = key_info.get("expires_at")
    if expires_at:
        expires_dt = datetime.fromisoformat(expires_at)
        if datetime.now(timezone.utc) > expires_dt:
            raise HTTPException(status_code=401, detail="API key has expired")


def _ensure_api_key_is_active(key_info: dict[str, Any]) -> dict[str, Any]:
    if not key_info:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not key_info.get("enabled"):
        raise HTTPException(status_code=401, detail="API key is disabled")
    _check_api_key_expiry(key_info)
    return key_info


def resolve_token_api_key(
    payload: dict[str, Any],
    *,
    enforce_rate_limit: bool = False,
    update_usage: bool = False,
) -> dict[str, Any] | None:
    """校验用户 Token 仍然绑定到有效 API Key。"""
    if payload.get("role") == "admin":
        return None

    key_id = str(payload.get("key_id") or "").strip()
    if not key_id:
        raise HTTPException(status_code=401, detail="Legacy token is no longer supported, please authenticate again")

    key_info = _ensure_api_key_is_active(get_api_key_info_by_id(key_id))

    if enforce_rate_limit:
        api_key_rate_limiter.check(
            key_id,
            max(1, int(key_info.get("rate_limit") or 100)),
        )

    if update_usage:
        update_api_key_usage(str(key_info.get("key") or ""))

    return key_info


# ==================== API Key 管理 ====================


def _load_api_keys() -> dict[str, Any]:
    """加载 API Keys"""
    return read_api_keys(API_KEYS_FILE)


def _save_api_keys(data: dict[str, Any]) -> None:
    """保存 API Keys"""
    write_api_keys(data)


def _new_api_key_id() -> str:
    return f"key-{secrets.token_urlsafe(8)}"


def _ensure_api_key_ids(data: dict[str, Any]) -> bool:
    changed = False
    for key in data.get("keys", []):
        if not str(key.get("id") or "").strip():
            key["id"] = _new_api_key_id()
            changed = True
    return changed


def _load_api_keys_state(repair_ids: bool = False) -> dict[str, Any]:
    data = _load_api_keys()
    if repair_ids and _ensure_api_key_ids(data):
        _save_api_keys(data)
    return data


def _mask_api_key(api_key: str) -> str:
    value = str(api_key or "")
    if not value:
        return ""
    if len(value) <= 14:
        return value
    return f"{value[:10]}...{value[-4:]}"


def _serialize_api_key(key_data: dict[str, Any], include_secret: bool = False) -> dict[str, Any]:
    raw_key = str(key_data.get("key") or "")
    payload = {
        **key_data,
        "api_key": _mask_api_key(raw_key),
        "usage_count": key_data.get("total_requests", 0),
    }
    payload["key"] = raw_key if include_secret else payload["api_key"]
    return payload


def generate_api_key() -> str:
    """生成新的 API Key"""
    return f"sk-{secrets.token_urlsafe(32)}"


def create_api_key(
    name: str,
    description: str = "",
    expires_days: int | None = None,
    rate_limit: int = 100,
) -> dict[str, Any]:
    """创建新的 API Key"""
    with _API_KEYS_LOCK:
        data = _load_api_keys_state(repair_ids=True)

        api_key = generate_api_key()
        now = datetime.now(timezone.utc)
        expires_at = None
        if expires_days:
            expires_at = (now + timedelta(days=expires_days)).isoformat()

        key_data = {
            "id": _new_api_key_id(),
            "key": api_key,
            "name": name,
            "description": description,
            "created_at": now.isoformat(),
            "expires_at": expires_at,
            "enabled": True,
            "rate_limit": rate_limit,  # 每分钟请求限制
            "total_requests": 0,
            "last_used_at": None,
        }

        data["keys"].append(key_data)
        _save_api_keys(data)

        return key_data


def list_api_keys(include_key: bool = False) -> list[dict[str, Any]]:
    """列出所有 API Keys"""
    with _API_KEYS_LOCK:
        data = _load_api_keys_state(repair_ids=True)
        keys = data.get("keys", [])
        return [_serialize_api_key(key, include_secret=include_key) for key in keys]


def get_api_key_info(api_key: str) -> dict[str, Any] | None:
    """获取 API Key 信息"""
    with _API_KEYS_LOCK:
        data = _load_api_keys_state(repair_ids=True)
        for key in data.get("keys", []):
            if key.get("key") == api_key:
                return key
        return None


def get_api_key_info_by_id(key_id: str) -> dict[str, Any] | None:
    """按内部 ID 获取 API Key 信息"""
    candidate = str(key_id or "").strip()
    if not candidate:
        return None

    with _API_KEYS_LOCK:
        data = _load_api_keys_state(repair_ids=True)
        for key in data.get("keys", []):
            if str(key.get("id") or "").strip() == candidate:
                return key
        return None


def validate_api_key(api_key: str) -> dict[str, Any]:
    """验证 API Key 是否有效"""
    key_info = get_api_key_info(api_key)
    return _ensure_api_key_is_active(key_info)


def update_api_key_usage(api_key: str) -> None:
    """更新 API Key 使用记录"""
    with _API_KEYS_LOCK:
        data = _load_api_keys_state(repair_ids=True)
        for key in data.get("keys", []):
            if key.get("key") == api_key:
                key["total_requests"] = key.get("total_requests", 0) + 1
                key["last_used_at"] = datetime.now(timezone.utc).isoformat()
                break
        _save_api_keys(data)


def update_api_key(
    api_key: str,
    name: str | None = None,
    description: str | None = None,
    enabled: bool | None = None,
    rate_limit: int | None = None,
    expires_days: int | None = None,
) -> dict[str, Any]:
    """更新 API Key"""
    with _API_KEYS_LOCK:
        data = _load_api_keys_state(repair_ids=True)
        for key in data.get("keys", []):
            if key.get("key") == api_key:
                if name is not None:
                    key["name"] = name
                if description is not None:
                    key["description"] = description
                if enabled is not None:
                    key["enabled"] = enabled
                if rate_limit is not None:
                    key["rate_limit"] = rate_limit
                if expires_days is not None:
                    key["expires_at"] = (
                        datetime.now(timezone.utc) + timedelta(days=expires_days)
                    ).isoformat()
                _save_api_keys(data)
                return key
        raise HTTPException(status_code=404, detail="API key not found")


def delete_api_key(api_key: str) -> bool:
    """删除 API Key"""
    with _API_KEYS_LOCK:
        data = _load_api_keys_state(repair_ids=True)
        keys = data.get("keys", [])
        original_count = len(keys)
        data["keys"] = [k for k in keys if k.get("key") != api_key]

        if len(data["keys"]) < original_count:
            _save_api_keys(data)
            return True
        return False


# ==================== 认证依赖 ====================


async def get_api_key_from_request(request: Request) -> str:
    """从请求中提取 API Key（支持多种方式）"""
    # 1. 从 Header 获取
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.replace("Bearer ", "")
        # 判断是 JWT Token 还是 API Key
        if token.startswith("sk-"):
            return token

    # 2. 从 Query 获取
    api_key = request.query_params.get("api_key")
    if api_key:
        return api_key

    # 3. 从 Body 获取
    try:
        body = await request.json()
        if isinstance(body, dict) and body.get("api_key"):
            return body["api_key"]
    except Exception:
        pass

    raise HTTPException(status_code=401, detail="API key required")


async def verify_api_key_dependency(request: Request) -> dict[str, Any]:
    """验证 API Key（用于保护 AI 接口）"""
    api_key = await get_api_key_from_request(request)
    key_info = validate_api_key(api_key)
    api_key_rate_limiter.check(
        str(key_info.get("id") or ""),
        max(1, int(key_info.get("rate_limit") or 100)),
    )

    # 更新使用记录
    update_api_key_usage(api_key)

    return key_info


def exchange_api_key_for_token(api_key: str) -> dict[str, str]:
    """使用 API Key 换取 Token"""
    key_info = validate_api_key(api_key)
    key_id = str(key_info.get("id") or "").strip()

    # 创建 Token
    access_token = create_access_token(
        data={
            "sub": key_info["name"],
            "api_key": api_key[:10],  # 只存储部分 key 用于标识
            "key_id": key_id,
            "role": "user",
        }
    )

    refresh_token = create_refresh_token(
        data={
            "sub": key_info["name"],
            "api_key": api_key[:10],
            "key_id": key_id,
            "role": "user",
        }
    )

    # 更新使用记录
    update_api_key_usage(api_key)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


__all__ = [
    "ACCESS_TOKEN_EXPIRE_MINUTES",
    "bootstrap_admin_password",
    "get_admin_username",
    "verify_admin_credentials",
    "create_access_token",
    "create_refresh_token",
    "verify_token",
    "verify_access_token",
    "verify_admin_token",
    "is_default_admin_password",
    "create_api_key",
    "list_api_keys",
    "get_api_key_info",
    "get_api_key_info_by_id",
    "validate_api_key",
    "update_api_key",
    "delete_api_key",
    "verify_api_key_dependency",
    "exchange_api_key_for_token",
    "resolve_token_api_key",
]
