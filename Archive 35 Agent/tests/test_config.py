"""Tests for the config module."""

import pytest
from pydantic import ValidationError

from src.config import Settings, get_settings


def test_default_settings():
    """Settings should load with all defaults when no env is set."""
    settings = Settings(
        _env_file=None,  # Don't read any .env file
    )
    assert settings.daily_budget_usd == 5.00
    assert settings.log_level == "INFO"
    assert settings.db_path == "data/archive35.db"


def test_override_via_kwargs():
    """Settings can be overridden via constructor kwargs."""
    settings = Settings(
        _env_file=None,
        daily_budget_usd=10.0,
        log_level="DEBUG",
        db_path="/tmp/test.db",
    )
    assert settings.daily_budget_usd == 10.0
    assert settings.log_level == "DEBUG"
    assert settings.db_path == "/tmp/test.db"


def test_invalid_log_level():
    """Invalid log level should raise ValidationError."""
    with pytest.raises(ValidationError, match="log_level"):
        Settings(_env_file=None, log_level="INVALID")


def test_log_level_case_insensitive():
    """Log level should accept lowercase and normalize to uppercase."""
    settings = Settings(_env_file=None, log_level="debug")
    assert settings.log_level == "DEBUG"


def test_negative_budget_rejected():
    """Negative daily budget should fail validation."""
    with pytest.raises(ValidationError):
        Settings(_env_file=None, daily_budget_usd=-1.0)


def test_has_anthropic_key_false_by_default():
    """has_anthropic_key should return False when not configured."""
    settings = Settings(_env_file=None)
    assert settings.has_anthropic_key() is False


def test_has_anthropic_key_true_when_set():
    """has_anthropic_key should return True when a real key is set."""
    settings = Settings(_env_file=None, anthropic_api_key="sk-ant-real-key-here")
    assert settings.has_anthropic_key() is True


def test_has_anthropic_key_false_for_placeholder():
    """has_anthropic_key should return False for the placeholder value."""
    settings = Settings(_env_file=None, anthropic_api_key="sk-ant-...")
    assert settings.has_anthropic_key() is False


def test_get_settings_helper():
    """get_settings() should return a valid Settings instance."""
    settings = get_settings(daily_budget_usd="3.50", log_level="WARNING")
    assert settings.daily_budget_usd == 3.50
    assert settings.log_level == "WARNING"


def test_db_path_resolved():
    """db_path_resolved should return a Path object."""
    settings = Settings(_env_file=None, db_path="data/test.db")
    assert settings.db_path_resolved.name == "test.db"
