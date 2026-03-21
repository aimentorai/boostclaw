# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from typing import Any, cast

from click.testing import CliRunner

from copaw.cli.chats_cmd import chats_group
from copaw.cli.cron_cmd import cron_group


class _FakeResponse:
    def __init__(self, payload, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _FakeClientCtx:
    def __init__(self, record: dict, responses: dict[str, _FakeResponse]):
        self._record = record
        self._responses = responses

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def get(self, path: str, **kwargs):
        self._record["get"] = (path, kwargs)
        return self._responses["get"]

    def post(self, path: str, **kwargs):
        self._record["post"] = (path, kwargs)
        return self._responses["post"]


def test_cron_list_uses_base_url_and_agent_header(monkeypatch) -> None:
    record: dict = {}

    def _client(base_url: str):
        record["base_url"] = base_url
        return _FakeClientCtx(record, {"get": _FakeResponse({"jobs": []})})

    monkeypatch.setattr("copaw.cli.cron_cmd.client", _client)
    monkeypatch.setattr("copaw.cli.cron_cmd.print_json", lambda payload: None)

    result = CliRunner().invoke(
        cast(Any, cron_group),
        ["list", "--base-url", "http://127.0.0.1:9999/", "--agent-id", "abc123"],
    )

    assert result.exit_code == 0
    assert record["base_url"] == "http://127.0.0.1:9999"
    path, kwargs = record["get"]
    assert path == "/cron/jobs"
    assert kwargs["headers"]["X-Agent-Id"] == "abc123"


def test_cron_create_inline_payload_posts_expected_fields(monkeypatch) -> None:
    record: dict = {}

    def _client(base_url: str):
        record["base_url"] = base_url
        return _FakeClientCtx(record, {"post": _FakeResponse({"id": "job-1"})})

    monkeypatch.setattr("copaw.cli.cron_cmd.client", _client)
    monkeypatch.setattr("copaw.cli.cron_cmd.print_json", lambda payload: None)

    result = CliRunner().invoke(
        cast(Any, cron_group),
        [
            "create",
            "--type",
            "text",
            "--name",
            "Daily",
            "--cron",
            "0 9 * * *",
            "--channel",
            "console",
            "--target-user",
            "u1",
            "--target-session",
            "s1",
            "--text",
            "hello",
            "--timezone",
            "UTC",
            "--base-url",
            "http://127.0.0.1:8088",
            "--agent-id",
            "agent-x",
        ],
    )

    assert result.exit_code == 0
    path, kwargs = record["post"]
    assert path == "/cron/jobs"
    assert kwargs["headers"]["X-Agent-Id"] == "agent-x"
    payload = kwargs["json"]
    assert payload["task_type"] == "text"
    assert payload["name"] == "Daily"
    assert payload["text"] == "hello"
    assert payload["schedule"]["timezone"] == "UTC"


def test_chats_list_passes_filters_and_agent_header(monkeypatch) -> None:
    record: dict = {}

    def _client(base_url: str):
        record["base_url"] = base_url
        return _FakeClientCtx(record, {"get": _FakeResponse([])})

    monkeypatch.setattr("copaw.cli.chats_cmd.client", _client)
    monkeypatch.setattr("copaw.cli.chats_cmd.print_json", lambda payload: None)

    result = CliRunner().invoke(
        cast(Any, chats_group),
        [
            "list",
            "--user-id",
            "alice",
            "--channel",
            "discord",
            "--base-url",
            "http://127.0.0.1:9000/",
            "--agent-id",
            "xyz789",
        ],
    )

    assert result.exit_code == 0
    assert record["base_url"] == "http://127.0.0.1:9000"
    path, kwargs = record["get"]
    assert path == "/chats"
    assert kwargs["params"] == {"user_id": "alice", "channel": "discord"}
    assert kwargs["headers"]["X-Agent-Id"] == "xyz789"


def test_chats_create_from_file_posts_payload(monkeypatch, tmp_path) -> None:
    record: dict = {}
    spec_path = tmp_path / "chat.json"
    spec = {
        "id": "",
        "name": "FromFile",
        "session_id": "discord:alice",
        "user_id": "alice",
        "channel": "discord",
        "meta": {},
    }
    spec_path.write_text(json.dumps(spec), encoding="utf-8")

    def _client(base_url: str):
        record["base_url"] = base_url
        return _FakeClientCtx(record, {"post": _FakeResponse({"id": "chat-1"})})

    monkeypatch.setattr("copaw.cli.chats_cmd.client", _client)
    monkeypatch.setattr("copaw.cli.chats_cmd.print_json", lambda payload: None)

    result = CliRunner().invoke(
        cast(Any, chats_group),
        ["create", "-f", str(spec_path), "--agent-id", "agent-z"],
    )

    assert result.exit_code == 0
    path, kwargs = record["post"]
    assert path == "/chats"
    assert kwargs["headers"]["X-Agent-Id"] == "agent-z"
    assert kwargs["json"] == spec


