def truncate(text: str, limit: int) -> str:
    value = str(text or "").strip()
    return value if len(value) <= limit else f"{value[:limit]}..."
