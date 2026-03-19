from functools import lru_cache
from pathlib import Path

from config import REFERENCES_DIR, ROUTES_FILENAME


def _clean_filename(filename: str) -> str:
    candidate = str(filename or "").strip().replace("\\", "/")
    if not candidate:
        return ""
    candidate = candidate.split("/")[-1]
    if not candidate.endswith(".md"):
        return ""
    if ".." in candidate:
        return ""
    return candidate


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


@lru_cache(maxsize=1)
def read_routes_doc() -> str:
    base = Path(REFERENCES_DIR)
    primary = _read_text(base / ROUTES_FILENAME)
    if primary:
        return primary
    return _read_text(base / "system.md")


@lru_cache(maxsize=256)
def read_page_doc(filename: str) -> str:
    safe = _clean_filename(filename)
    if not safe:
        return ""
    return _read_text(Path(REFERENCES_DIR) / safe)


def list_page_docs() -> list[str]:
    base = Path(REFERENCES_DIR)
    if not base.exists():
        return []
    docs = [item.name for item in base.glob("page-*.md") if item.is_file()]
    docs.sort()
    return docs
