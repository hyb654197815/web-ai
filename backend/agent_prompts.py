import os
import re
from functools import lru_cache
from pathlib import Path

from agent_settings import OUT_OF_SCOPE_MESSAGE
from config import BACKEND_DIR, PROJECT_ROOT

PROMPT_FILENAMES = {
    "system": "agent-system.txt",
    "user": "agent-user.txt",
}


def _resolve_prompt_dir() -> Path:
    raw = os.environ.get("AGENT_PROMPTS_DIR")
    if not raw:
        return BACKEND_DIR / "prompts"

    path = Path(raw).expanduser()
    return path if path.is_absolute() else (PROJECT_ROOT / path).resolve()


PROMPTS_DIR = _resolve_prompt_dir()


@lru_cache(maxsize=4)
def _load_prompt_template(name: str) -> str:
    filename = PROMPT_FILENAMES.get(name)
    if not filename:
        raise ValueError(f"Unknown prompt template: {name}")

    path = PROMPTS_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"Prompt template not found: {path}")
    return path.read_text(encoding="utf-8").strip()


def render_prompt_template(name: str, variables: dict[str, str]) -> str:
    rendered = _load_prompt_template(name)
    for key, value in variables.items():
        rendered = rendered.replace(f"{{{{{key}}}}}", str(value))

    unresolved = re.findall(r"{{([A-Z0-9_]+)}}", rendered)
    if unresolved:
        raise ValueError(f"Unresolved prompt variables: {', '.join(sorted(set(unresolved)))}")
    return rendered.strip()


def build_system_prompt() -> str:
    return render_prompt_template(
        "system",
        {
            "OUT_OF_SCOPE_MESSAGE": OUT_OF_SCOPE_MESSAGE,
        },
    )


def build_user_prompt(
    *,
    current_page: str,
    session_history_section: str,
    routes_snapshot: str,
    related_docs_section: str,
    user_request: str,
) -> str:
    return render_prompt_template(
        "user",
        {
            "CURRENT_PAGE": current_page,
            "SESSION_HISTORY_SECTION": session_history_section,
            "ROUTES_SNAPSHOT": routes_snapshot,
            "RELATED_DOCS_SECTION": related_docs_section,
            "USER_REQUEST": user_request,
        },
    )
