from types import SimpleNamespace

import pytest

from src.telegram import bot


def test_main_starts_polling_with_configured_token(monkeypatch):
    settings = SimpleNamespace(
        has_telegram_config=lambda: True,
        log_level="INFO",
        telegram_bot_token="123456:test-token",
    )
    seen = []

    async def fake_start_polling(token):
        seen.append(token)

    monkeypatch.setattr(bot, "get_settings", lambda: settings)
    monkeypatch.setattr(bot, "start_polling", fake_start_polling)

    bot.main()

    assert seen == ["123456:test-token"]


def test_main_fails_fast_when_telegram_is_not_configured(monkeypatch):
    settings = SimpleNamespace(has_telegram_config=lambda: False)
    monkeypatch.setattr(bot, "get_settings", lambda: settings)

    with pytest.raises(RuntimeError, match="must both be configured"):
        bot.main()
