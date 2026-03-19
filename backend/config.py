# 后端配置：知识库路径、LLM、CORS 等
import os
from pathlib import Path

from dotenv import load_dotenv

# 当前 backend 目录、项目根目录
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
# 从 backend 目录的 .env 加载环境变量（不覆盖已有系统环境变量）
load_dotenv(BACKEND_DIR / ".env")

def _resolve_env_path(value: str | None) -> Path | None:
    if not value:
        return None
    raw_path = Path(value).expanduser()
    return raw_path if raw_path.is_absolute() else (PROJECT_ROOT / raw_path).resolve()


def _iter_reference_dir_candidates():
    explicit_references_dir = _resolve_env_path(os.environ.get("WIDGET_KNOWLEDGE_DIR"))
    if explicit_references_dir:
        yield explicit_references_dir

    explicit_skill_root = _resolve_env_path(os.environ.get("WIDGET_KNOWLEDGE_SKILL_DIR"))
    if explicit_skill_root:
        yield explicit_skill_root / "references"

    explicit_skills_dir = _resolve_env_path(os.environ.get("WIDGET_SKILLS_DIR"))
    if explicit_skills_dir:
        yield explicit_skills_dir / "widget-knowledge-system" / "references"

    default_skill_roots = (
        PROJECT_ROOT / ".opencode" / "skills" / "widget-knowledge-system",
        PROJECT_ROOT / "skills" / "widget-knowledge-system",
        PROJECT_ROOT / ".codex" / "skills" / "widget-knowledge-system",
        PROJECT_ROOT / ".claude" / "skills" / "widget-knowledge-system",
    )
    for skill_root in default_skill_roots:
        yield skill_root / "references"

    yield PROJECT_ROOT / "knowledge"


def _resolve_references_dir() -> str:
    seen: set[str] = set()
    for candidate in _iter_reference_dir_candidates():
        candidate_str = str(candidate)
        if candidate_str in seen:
            continue
        seen.add(candidate_str)
        if candidate.exists():
            return candidate_str

    return str(PROJECT_ROOT / "knowledge")


# 知识库目录：优先显式配置，其次自动探测常见 skill 目录，最后回退到 knowledge
REFERENCES_DIR = _resolve_references_dir()

# 路由表文件名（与 SKILL 一致）
ROUTES_FILENAME = "routes.md"
# 若不存在 routes.md 则尝试 system.md（与现有 knowledge 兼容）
if not (Path(REFERENCES_DIR) / ROUTES_FILENAME).exists():
    _alt = Path(REFERENCES_DIR) / "system.md"
    if _alt.exists():
        ROUTES_FILENAME = "system.md"

# NVIDIA API（OpenAI 兼容）
NVIDIA_BASE_URL = os.environ.get("OPENAI_API_BASE", "")
NVIDIA_API_KEY = os.environ.get("OPENAI_API_KEY", "")
MODEL_NAME = os.environ.get("OPENAI_MODEL_NAME", "")

# CORS：允许的前端来源，逗号分隔
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*").strip().split(",") if os.environ.get("CORS_ORIGINS") else ["*"]

# 服务端口
PORT = int(os.environ.get("PORT", "4096"))
