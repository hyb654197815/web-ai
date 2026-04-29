from langchain_openai import ChatOpenAI

from agent_settings import AGENT_MAX_RETRIES, AGENT_TEMPERATURE
from agent_admin import select_model_config


def create_llm(*, streaming: bool):
    selected_model = select_model_config()
    api_key = str((selected_model or {}).get("apiKey") or "").strip()
    model_name = str((selected_model or {}).get("model") or (selected_model or {}).get("name") or "").strip()
    base_url = str((selected_model or {}).get("baseURL") or "").strip()
    provider = str((selected_model or {}).get("provider") or "OpenAI Compatible").strip()

    if not api_key:
        raise RuntimeError("Missing API key: configure a model in agent-admin.json.")
    if not model_name:
        raise RuntimeError("Missing model name: configure a model in agent-admin.json.")

    if provider == "Anthropic":
        try:
            from langchain_anthropic import ChatAnthropic
        except ImportError as exc:
            raise RuntimeError("Anthropic provider requires langchain-anthropic in backend/requirements.txt.") from exc

        return ChatAnthropic(
            model=model_name,
            api_key=api_key,
            base_url=base_url or None,
            temperature=AGENT_TEMPERATURE,
            max_retries=AGENT_MAX_RETRIES,
            streaming=streaming,
        )

    return ChatOpenAI(
        model=model_name,
        api_key=api_key,
        base_url=base_url or None,
        temperature=AGENT_TEMPERATURE,
        max_retries=AGENT_MAX_RETRIES,
        streaming=streaming,
        use_responses_api=False,
    )
