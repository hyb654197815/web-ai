from langchain_openai import ChatOpenAI

from agent_settings import AGENT_MAX_RETRIES, AGENT_TEMPERATURE
from config import MODEL_NAME, NVIDIA_API_KEY, NVIDIA_BASE_URL


def create_llm(*, streaming: bool) -> ChatOpenAI:
    if not (NVIDIA_API_KEY or "").strip():
        raise RuntimeError("Missing API key: set OPENAI_API_KEY in backend/.env.")
    if not (MODEL_NAME or "").strip():
        raise RuntimeError("Missing model name: set OPENAI_MODEL_NAME in backend/.env.")

    return ChatOpenAI(
        model=MODEL_NAME,
        api_key=NVIDIA_API_KEY,
        base_url=NVIDIA_BASE_URL or None,
        temperature=AGENT_TEMPERATURE,
        max_retries=AGENT_MAX_RETRIES,
        streaming=streaming,
        use_responses_api=False,
    )
