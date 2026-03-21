# -*- coding: utf-8 -*-
from __future__ import annotations

from types import SimpleNamespace

from click.testing import CliRunner

from copaw.cli.skills_cmd import skills_group


class _FakeSkillService:
    def __init__(self, _working_dir):
        self.enabled: list[str] = []
        self.disabled: list[str] = []

    def list_all_skills(self):
        return [
            SimpleNamespace(name="reader", source="builtin"),
            SimpleNamespace(name="search", source="workspace"),
        ]

    def enable_skill(self, name: str) -> bool:
        self.enabled.append(name)
        return True

    def disable_skill(self, name: str) -> bool:
        self.disabled.append(name)
        return True


def test_skills_list_shows_enabled_and_disabled(monkeypatch) -> None:
    monkeypatch.setattr(
        "copaw.cli.skills_cmd._get_agent_workspace",
        lambda _agent_id: "/tmp/default",
    )
    monkeypatch.setattr(
        "copaw.cli.skills_cmd.SkillService",
        _FakeSkillService,
    )
    monkeypatch.setattr(
        "copaw.cli.skills_cmd.list_available_skills",
        lambda _working_dir: ["reader"],
    )

    result = CliRunner().invoke(skills_group, ["list"])

    assert result.exit_code == 0
    assert "Skills for agent: default" in result.output
    assert "reader" in result.output
    assert "search" in result.output
    assert "enabled" in result.output
    assert "disabled" in result.output


def test_skills_config_applies_enable_disable_changes(monkeypatch) -> None:
    service = _FakeSkillService("/tmp/default")

    monkeypatch.setattr(
        "copaw.cli.skills_cmd._get_agent_workspace",
        lambda _agent_id: "/tmp/default",
    )
    monkeypatch.setattr(
        "copaw.cli.skills_cmd.SkillService",
        lambda _working_dir: service,
    )
    monkeypatch.setattr(
        "copaw.cli.skills_cmd.list_available_skills",
        lambda _working_dir: ["reader"],
    )
    monkeypatch.setattr(
        "copaw.cli.skills_cmd.prompt_checkbox",
        lambda *_args, **_kwargs: ["search"],
    )
    monkeypatch.setattr(
        "copaw.cli.skills_cmd.prompt_confirm",
        lambda *_args, **_kwargs: True,
    )

    result = CliRunner().invoke(skills_group, ["config", "--agent-id", "abc123"])

    assert result.exit_code == 0
    assert "Configuring skills for agent: abc123" in result.output
    assert "Enabled: search" in result.output
    assert "Disabled: reader" in result.output
    assert service.enabled == ["search"]
    assert service.disabled == ["reader"]

