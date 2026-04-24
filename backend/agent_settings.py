import os
import re

DEFAULT_MESSAGE = "暂时无法提供答案。"
OUT_OF_SCOPE_MESSAGE = "我主要负责平台内页面导航、站内操作问答，以及页面表单操作。"

ALLOWED_ACTIONS = {"navigate", "form"}
NAV_INTENT_KEYWORDS = ("跳转", "进入", "打开", "前往", "去", "导航", "切换到", "访问", "navigate", "go to")
GUIDE_INTENT_KEYWORDS = ("如何", "怎么", "步骤", "指引", "引导", "填写", "表单", "说明", "介绍", "帮助")
FORM_INTENT_KEYWORDS = (
    "点击",
    "输入",
    "填写",
    "填入",
    "选择",
    "勾选",
    "提交",
    "确认",
    "保存",
    "新增",
    "添加",
    "创建",
    "新建",
    "修改",
    "编辑",
    "搜索",
    "查询",
    "筛选",
    "重置",
    "上传",
    "导入",
    "删除",
    "帮我",
    "替我",
    "执行",
    "操作",
)
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
AGENT_ROUTE_SEARCH_LIMIT = _env_int("AGENT_ROUTE_SEARCH_LIMIT", 6)
AGENT_MAX_PAGE_DOC_CHARS = _env_int("AGENT_MAX_PAGE_DOC_CHARS", 6000)
AGENT_MAX_MESSAGE_CHARS = _env_int("AGENT_MAX_MESSAGE_CHARS", 1800)
STREAM_THINKING_SUMMARY_LIMIT = _env_int("STREAM_THINKING_SUMMARY_LIMIT", 1200)
STREAM_MAX_TOOL_PREVIEW_CHARS = _env_int("STREAM_MAX_TOOL_PREVIEW_CHARS", 500)
