"""Prepare the managed Rowboat platform and model configuration before Hermes opens its gateway."""
import os
from pathlib import Path
import shutil
import tempfile

from ruamel.yaml import YAML
from dotenv import dotenv_values, set_key


def configure(home, env, bundle=Path("/app")):
    home = Path(home)
    profile = home / "config.yaml"
    yaml = YAML()
    cfg = yaml.load(profile) if profile.exists() else {}
    cfg = cfg or {}
    plugins = cfg.setdefault("plugins", {}).setdefault("enabled", [])
    if "rowboat-platform" not in plugins:
        plugins.append("rowboat-platform")
    shutil.copytree(bundle / "rowboat-platform", home / "plugins/rowboat-platform", dirs_exist_ok=True)
    shutil.copytree(bundle / "rowboat-spaces", home / "skills/rowboat-spaces", dirs_exist_ok=True)
    servers = cfg.setdefault("mcp_servers", {})
    servers["rowboat"] = {"url": "${ROWBOAT_URL}/mcp", "headers": {"Authorization": "Bearer ${ROWBOAT_AGENT_KEY}"}}
    values = {k: env[k] for k in ("ROWBOAT_URL", "ROWBOAT_AGENT_KEY", "ROWBOAT_HOME_CHANNEL")}
    values["ROWBOAT_ALLOW_ALL_USERS"] = "true"
    if env.get("ROWBOAT_COMPOSIO_MCP_URL") and env.get("ROWBOAT_GATEWAY_KEY"):
        for key in ("ROWBOAT_COMPOSIO_MCP_URL", "ROWBOAT_GATEWAY_KEY"):
            values[key] = env[key]
        servers["composio"] = {"url": "${ROWBOAT_COMPOSIO_MCP_URL}", "headers": {"Authorization": "Bearer ${ROWBOAT_GATEWAY_KEY}"}}
    provider = env.get("ROWBOAT_LLM_PROVIDER") or "trial"
    providers = {
        "trial": ("openai", env.get("OPENAI_BASE_URL"), "OPENAI_API_KEY"),
        "openai": ("openai", "https://api.openai.com/v1", "OPENAI_API_KEY"),
        "anthropic": ("anthropic", "https://api.anthropic.com", "ANTHROPIC_API_KEY"),
        "openrouter": ("openrouter", "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY"),
        "rowboat": ("openrouter", env.get("ROWBOAT_LLM_BASE_URL"), "OPENROUTER_API_KEY"),
    }
    name, base, key = providers[provider]
    if base:
        model = cfg.get("model")
        if not isinstance(model, dict):
            model = cfg["model"] = {"default": model} if model else {}
        model.update(provider=name, base_url=base)
        if env.get("ROWBOAT_LLM_MODEL"):
            model["default"] = env["ROWBOAT_LLM_MODEL"]
        elif provider == "trial":
            model.setdefault("default", "gpt-5.4")
        if env.get(key):
            values[key] = env[key]
    display = cfg.setdefault("display", {}).setdefault("platforms", {}).setdefault("rowboat", {})
    for option, value in {"tool_progress": "off", "show_reasoning": False, "long_running_notifications": False, "busy_ack_detail": False}.items():
        display.setdefault(option, value)

    # 2026-11-27: Hermes resolves MCP secrets from its profile. Commit them before
    # enabling the platform, retaining keys and user configuration outside our entries.
    dotenv = home / ".env"
    saved = dotenv_values(dotenv, interpolate=False)
    for key, value in values.items():
        if saved.get(key) != value:
            set_key(str(dotenv), key, value)
    with tempfile.NamedTemporaryFile("w", dir=home, delete=False) as out:
        yaml.dump(cfg, out)
    os.replace(out.name, profile)


if __name__ == "__main__":
    configure(os.environ["HERMES_HOME"], os.environ)
