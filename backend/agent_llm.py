from collections.abc import Iterator
from typing import Any

from agent_prompts import build_system_prompt
from agent_settings import AGENT_MAX_RETRIES, AGENT_TEMPERATURE
from config import MODEL_NAME, NVIDIA_API_KEY, NVIDIA_BASE_URL


def create_llm(streaming: bool):
    try:
        from langchain_openai import ChatOpenAI
    except ImportError as exc:
        raise ImportError("Missing langchain dependency. Please run `pip install -r backend/requirements.txt`.") from exc

    if not (NVIDIA_API_KEY or "").strip():
        raise RuntimeError("Missing API key: set NVIDIA_API_KEY or OPENAI_API_KEY in backend/.env.")

    return ChatOpenAI(
        model=MODEL_NAME,
        api_key=NVIDIA_API_KEY,
        base_url=NVIDIA_BASE_URL,
        temperature=AGENT_TEMPERATURE,
        max_retries=AGENT_MAX_RETRIES,
        streaming=streaming,
    )


def build_messages(user_prompt: str) -> list[Any]:
    try:
        from langchain_core.messages import HumanMessage, SystemMessage
    except ImportError as exc:
        raise ImportError("Missing langchain dependency. Please run `pip install -r backend/requirements.txt`.") from exc

    return [SystemMessage(content=build_system_prompt()), HumanMessage(content=user_prompt)]


def content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                if isinstance(item.get("text"), str):
                    parts.append(item["text"])
                elif isinstance(item.get("content"), str):
                    parts.append(item["content"])
        return "".join(parts)
    return str(content)


def invoke_model(messages: list[Any], streaming: bool) -> str:
    llm = create_llm(streaming=streaming)
    if streaming:
        return "".join(content_to_text(getattr(chunk, "content", chunk)) for chunk in llm.stream(messages)).strip()
    return content_to_text(getattr(llm.invoke(messages), "content", "")).strip()


def stream_model_chunks(messages: list[Any]) -> Iterator[str]:
    llm = create_llm(streaming=True)
    for chunk in llm.stream(messages):
        text = content_to_text(getattr(chunk, "content", chunk))
        if text:
            yield text
