# 请求日志监控系统
import json
import logging
import threading
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Request

from config import PROJECT_ROOT

# 日志配置
LOG_DIR = PROJECT_ROOT / "logs"
LOG_DIR.mkdir(exist_ok=True)

REQUEST_LOG_FILE = LOG_DIR / "requests.log"
SECURITY_LOG_FILE = LOG_DIR / "security.log"

# 配置日志格式
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(REQUEST_LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)

logger = logging.getLogger(__name__)
security_logger = logging.getLogger("security")
security_logger.addHandler(logging.FileHandler(SECURITY_LOG_FILE, encoding="utf-8"))


# ==================== 请求统计 ====================


class RequestStats:
    """请求统计"""

    def __init__(self):
        self.stats = defaultdict(lambda: {
            "total": 0,
            "success": 0,
            "failed": 0,
            "by_endpoint": defaultdict(int),
            "by_ip": defaultdict(int),
            "by_api_key": defaultdict(int),
        })
        self.lock = threading.Lock()

    def record(
        self,
        endpoint: str,
        ip: str,
        api_key: str | None,
        status_code: int,
        response_time: float,
    ):
        """记录请求"""
        with self.lock:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            stats = self.stats[today]

            stats["total"] += 1
            if 200 <= status_code < 400:
                stats["success"] += 1
            else:
                stats["failed"] += 1

            stats["by_endpoint"][endpoint] += 1
            stats["by_ip"][ip] += 1
            if api_key:
                stats["by_api_key"][api_key[:10]] += 1

    def get_stats(self, date: str | None = None) -> dict:
        """获取统计数据"""
        with self.lock:
            if date:
                return dict(self.stats.get(date, {}))
            # 返回最近7天的数据
            result = {}
            for i in range(7):
                date_str = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
                if date_str in self.stats:
                    result[date_str] = dict(self.stats[date_str])
            return result


request_stats = RequestStats()


def is_ai_runtime_request(path: str) -> bool:
    """仅识别真正的 AI 调用链路请求，用于统计面板。"""
    normalized = str(path or "").strip()
    if not normalized.startswith("/api/"):
        return False

    if normalized in {
        "/api/chat",
        "/api/chat/stream",
        "/api/session",
        "/api/page-agent/chat/completions",
    }:
        return True

    return normalized.startswith("/api/session/") and normalized.endswith("/message")


# ==================== 异常检测 ====================


class AbuseDetector:
    """滥用检测"""

    def __init__(self):
        self.request_history = defaultdict(list)  # IP -> [timestamps]
        self.blocked_ips = set()
        self.suspicious_patterns = defaultdict(int)  # pattern -> count
        self.lock = threading.Lock()

        # 配置
        self.max_requests_per_minute = 60
        self.max_requests_per_hour = 500
        self.block_duration_minutes = 30

    def check_rate_limit(self, ip: str) -> tuple[bool, str]:
        """检查速率限制"""
        with self.lock:
            # 检查是否已被封禁
            if ip in self.blocked_ips:
                return False, "IP is blocked due to excessive requests"

            now = datetime.now(timezone.utc)
            self.request_history[ip].append(now)

            # 清理旧记录（保留最近1小时）
            cutoff = now - timedelta(hours=1)
            self.request_history[ip] = [
                ts for ts in self.request_history[ip] if ts > cutoff
            ]

            # 检查1分钟内的请求数
            one_minute_ago = now - timedelta(minutes=1)
            recent_requests = [
                ts for ts in self.request_history[ip] if ts > one_minute_ago
            ]

            if len(recent_requests) > self.max_requests_per_minute:
                self.blocked_ips.add(ip)
                security_logger.warning(
                    f"IP {ip} blocked: {len(recent_requests)} requests in 1 minute"
                )
                return False, f"Rate limit exceeded: {len(recent_requests)} requests/minute"

            # 检查1小时内的请求数
            if len(self.request_history[ip]) > self.max_requests_per_hour:
                self.blocked_ips.add(ip)
                security_logger.warning(
                    f"IP {ip} blocked: {len(self.request_history[ip])} requests in 1 hour"
                )
                return False, f"Rate limit exceeded: {len(self.request_history[ip])} requests/hour"

            return True, ""

    def detect_suspicious_pattern(self, request: Request) -> bool:
        """检测可疑请求模式"""
        suspicious = False

        # 检测可疑 User-Agent
        user_agent = request.headers.get("user-agent", "").lower()
        if not user_agent or any(
            bot in user_agent for bot in ["bot", "crawler", "spider", "scraper"]
        ):
            suspicious = True
            self.suspicious_patterns["suspicious_user_agent"] += 1

        # 检测可疑路径
        path = request.url.path
        if any(pattern in path for pattern in ["../", "..\\", "<script", "eval("]):
            suspicious = True
            self.suspicious_patterns["suspicious_path"] += 1
            security_logger.warning(f"Suspicious path detected: {path} from {request.client.host}")

        return suspicious

    def unblock_ip(self, ip: str):
        """解封 IP"""
        with self.lock:
            self.blocked_ips.discard(ip)
            security_logger.info(f"IP {ip} unblocked")

    def get_blocked_ips(self) -> list[str]:
        """获取被封禁的 IP 列表"""
        with self.lock:
            return list(self.blocked_ips)

    def get_suspicious_stats(self) -> dict:
        """获取可疑请求统计"""
        with self.lock:
            return dict(self.suspicious_patterns)


abuse_detector = AbuseDetector()


# ==================== 日志记录 ====================


def log_request(
    request: Request,
    response_status: int,
    response_time: float,
    api_key: str | None = None,
    error: str | None = None,
):
    """记录请求日志"""
    ip = request.client.host
    method = request.method
    path = request.url.path
    origin = request.headers.get("origin", "unknown")
    referer = request.headers.get("referer", "unknown")
    user_agent = request.headers.get("user-agent", "unknown")

    log_data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ip": ip,
        "method": method,
        "path": path,
        "status": response_status,
        "response_time_ms": round(response_time * 1000, 2),
        "origin": origin,
        "referer": referer,
        "user_agent": user_agent[:100],
        "api_key": api_key[:10] if api_key else None,
        "error": error,
    }

    # 记录到日志
    if error:
        logger.error(f"Request failed: {json.dumps(log_data, ensure_ascii=False)}")
    else:
        logger.info(f"Request: {json.dumps(log_data, ensure_ascii=False)}")

    # 统计面板只跟踪 AI 调用链路，不把管理端、静态资源和探活请求混进来
    if is_ai_runtime_request(path):
        request_stats.record(path, ip, api_key, response_status, response_time)


def log_security_event(event_type: str, details: dict[str, Any]):
    """记录安全事件"""
    log_data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": event_type,
        "details": details,
    }
    security_logger.warning(f"Security event: {json.dumps(log_data, ensure_ascii=False)}")


def log_api_key_event(event_type: str, api_key: str, details: dict[str, Any] | None = None):
    """记录 API Key 相关事件"""
    log_data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": event_type,
        "api_key": api_key[:10] if api_key else None,
        "details": details or {},
    }
    security_logger.info(f"API Key event: {json.dumps(log_data, ensure_ascii=False)}")


# ==================== 日志查询 ====================


def get_recent_logs(log_type: str = "request", limit: int = 100) -> list[dict]:
    """获取最近的日志"""
    log_file = REQUEST_LOG_FILE if log_type == "request" else SECURITY_LOG_FILE

    if not log_file.exists():
        return []

    logs = []
    try:
        with open(log_file, "r", encoding="utf-8") as f:
            lines = f.readlines()
            # 只读取最后 limit 行
            for line in lines[-limit:]:
                try:
                    # 解析日志行
                    if " - " in line:
                        parts = line.split(" - ", 3)
                        if len(parts) >= 4:
                            timestamp = parts[0]
                            level = parts[2]
                            message = parts[3].strip()

                            # 尝试解析 JSON
                            if message.startswith("Request:") or message.startswith("Security event:"):
                                json_str = message.split(":", 1)[1].strip()
                                log_data = json.loads(json_str)
                                log_data["level"] = level
                                logs.append(log_data)
                except Exception:
                    continue
    except Exception as e:
        logger.error(f"Failed to read logs: {e}")

    return logs


__all__ = [
    "request_stats",
    "abuse_detector",
    "log_request",
    "log_security_event",
    "log_api_key_event",
    "get_recent_logs",
    "is_ai_runtime_request",
]
