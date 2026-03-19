import os
import re

DEFAULT_MESSAGE = "暂时无法提供答案。"
OUT_OF_SCOPE_MESSAGE = "我主要负责平台内页面导航、站内操作问答，以及表单填写指引。"

ALLOWED_ACTIONS = {"navigate"}
NAV_INTENT_KEYWORDS = ("跳转", "进入", "打开", "前往", "去", "导航", "切换到", "访问", "navigate", "go to")
GUIDE_INTENT_KEYWORDS = ("如何", "怎么", "步骤", "指引", "引导", "填写", "表单", "说明", "介绍", "帮助")
DISALLOWED_RESPONSE_PATTERNS = (
    re.compile(r"<script", flags=re.IGNORECASE),
    re.compile(r"javascript\s*:", flags=re.IGNORECASE),
    re.compile(r"document\.queryselector", flags=re.IGNORECASE),
    re.compile(r"dispatchEvent\s*\(", flags=re.IGNORECASE),
    re.compile(r"requestSubmit\s*\(", flags=re.IGNORECASE),
    re.compile(r"\bform\.submit\s*\(", flags=re.IGNORECASE),
)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


AGENT_TEMPERATURE = _env_float("AGENT_TEMPERATURE", 0.15)
AGENT_MAX_RETRIES = _env_int("AGENT_MAX_RETRIES", 1)
AGENT_MAX_ROUTE_LINES = _env_int("AGENT_MAX_ROUTE_LINES", 120)
AGENT_MAX_HISTORY_LINES = _env_int("AGENT_MAX_HISTORY_LINES", 10)
AGENT_MAX_RELATED_DOCS = _env_int("AGENT_MAX_RELATED_DOCS", 4)
AGENT_MAX_DOC_CHARS = _env_int("AGENT_MAX_DOC_CHARS", 2400)
AGENT_MAX_MESSAGE_CHARS = _env_int("AGENT_MAX_MESSAGE_CHARS", 1800)
STREAM_THINKING_FLUSH_CHARS = _env_int("STREAM_THINKING_FLUSH_CHARS", 80)
STREAM_MAX_THINKING_EVENTS = _env_int("STREAM_MAX_THINKING_EVENTS", 120)

AGENT_HISTORY_ITEM_CHARS = 260
EXPANDED_SCOPE_EXTRA_DOCS = 2
THINKING_SUMMARY_LIMIT = 320
STREAM_THINKING_SUMMARY_LIMIT = 1200
MODEL_DONE_SUMMARY_LIMIT = 220
