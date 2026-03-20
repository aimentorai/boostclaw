# -*- coding: utf-8 -*-
from __future__ import annotations

import pytest
from click.testing import CliRunner

from copaw.config.config import AgentProfileConfig, ChannelConfig, Config

try:
    from copaw.cli.channels_cmd import channels_group
except Exception as exc:  # pragma: no cover - environment-dependent import
    channels_group = None
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None

pytestmark = pytest.mark.skipif(
    channels_group is None,
    reason=f"channels CLI import failed in this environment: {_IMPORT_ERROR}",
)


def test_channels_list_renders_masked_secret(monkeypatch) -> None:
    agent_config = AgentProfileConfig(
        id="default",
        name="Default Agent",
        workspace_dir="/tmp/default",
        channels=ChannelConfig(),
    )
    agent_config.channels.discord.enabled = True
    agent_config.channels.discord.bot_prefix = "[BOT]"
    agent_config.channels.discord.bot_token = "abcd12345678"

    monkeypatch.setattr(
        "copaw.cli.channels_cmd.load_agent_config",
        lambda _agent_id: agent_config,
    )

    result = CliRunner().invoke(channels_group, ["list"])

    assert result.exit_code == 0
    assert "Channels for agent: default" in result.output
    assert "Discord" in result.output
    assert "abcd****" in result.output
    assert "abcd12345678" not in result.output


def test_channels_install_creates_template_in_custom_dir(tmp_path, monkeypatch) -> None:
    custom_channels_dir = tmp_path / "custom_channels"
    monkeypatch.setattr(
        "copaw.cli.channels_cmd.CUSTOM_CHANNELS_DIR",
        custom_channels_dir,
    )

    result = CliRunner().invoke(channels_group, ["install", "my_channel"])

    created = custom_channels_dir / "my_channel.py"
    assert result.exit_code == 0
    assert created.exists()
    assert "class CustomChannel" in created.read_text(encoding="utf-8")
    assert "Created" in result.output


def test_channels_add_builtin_persists_default_config(tmp_path, monkeypatch) -> None:
    config_path = tmp_path / "config.json"
    saved: dict[str, Config] = {}

    monkeypatch.setattr(
        "copaw.cli.channels_cmd.get_config_path",
        lambda: config_path,
    )
    monkeypatch.setattr(
        "copaw.cli.channels_cmd.save_config",
        lambda config, path: saved.setdefault("config", config),
    )
    monkeypatch.setattr(
        "copaw.cli.channels_cmd.BUILTIN_CHANNEL_KEYS",
        {"dingtalk", "console"},
    )

    result = CliRunner().invoke(
        channels_group,
        ["add", "dingtalk", "--no-configure"],
    )

    assert result.exit_code == 0
    assert "Added 'dingtalk' to config" in result.output
    assert saved["config"].channels.dingtalk.enabled is False
    assert saved["config"].channels.dingtalk.bot_prefix == ""


def test_channels_remove_custom_module_and_config(tmp_path, monkeypatch) -> None:
    custom_channels_dir = tmp_path / "custom_channels"
    custom_channels_dir.mkdir()
    (custom_channels_dir / "my_channel.py").write_text("# test", encoding="utf-8")

    config_path = tmp_path / "config.json"
    existing = Config.model_validate(
        {
            "channels": {
                "my_channel": {
                    "enabled": False,
                    "bot_prefix": "",
                },
            },
        },
    )
    saved: dict[str, Config] = {}

    monkeypatch.setattr(
        "copaw.cli.channels_cmd.CUSTOM_CHANNELS_DIR",
        custom_channels_dir,
    )
    monkeypatch.setattr(
        "copaw.cli.channels_cmd.get_config_path",
        lambda: config_path,
    )
    monkeypatch.setattr(
        "copaw.cli.channels_cmd.load_config",
        lambda path: existing,
    )
    monkeypatch.setattr(
        "copaw.cli.channels_cmd.save_config",
        lambda config, path: saved.setdefault("config", config),
    )
    monkeypatch.setattr(
        "copaw.cli.channels_cmd.BUILTIN_CHANNEL_KEYS",
        {"dingtalk", "console"},
    )
    config_path.write_text("{}", encoding="utf-8")

    result = CliRunner().invoke(channels_group, ["remove", "my_channel"])

    assert result.exit_code == 0
    assert not (custom_channels_dir / "my_channel.py").exists()
    assert "Removed channel 'my_channel'" in result.output
    saved_channels = saved["config"].model_dump().get("channels", {})
    assert "my_channel" not in saved_channels


