"""Archive-35 configuration module.

Loads all environment variables with type validation using pydantic-settings.
Fails fast with clear error messages on missing required values.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Claude API ──
    anthropic_api_key: str = Field(
        default="",
        description="Anthropic API key for Claude vision and content generation",
    )

    # ── Telegram Bot ──
    telegram_bot_token: str = Field(
        default="",
        description="Telegram bot token from BotFather",
    )
    telegram_chat_id: str = Field(
        default="",
        description="Telegram chat ID for approval messages",
    )

    # ── Late API (social posting) ──
    late_api_key: str = Field(
        default="",
        description="Late API key for social media posting",
    )

    # ── Etsy (Phase 2) ──
    etsy_api_key: str = Field(default="", description="Etsy API key")
    etsy_api_secret: str = Field(default="", description="Etsy API secret")

    # ── Shopify (Phase 2) ──
    shopify_store_url: str = Field(default="", description="Shopify store URL")
    shopify_api_key: str = Field(default="", description="Shopify API key")
    shopify_api_secret: str = Field(default="", description="Shopify API secret")

    # ── Printful ──
    printful_api_key: str = Field(default="", description="Printful API key")

    # ── Mockup Service (Phase 2/3) ──
    mockup_service_url: str = Field(
        default="http://localhost:8036",
        description="Mockup Compositing Service URL",
    )
    mockup_output_dir: str = Field(
        default="mockups/social",
        description="Directory for generated social mockups (relative to repo root)",
    )
    daily_mockup_posts: int = Field(
        default=1,
        description="Max mockup posts per platform per day",
        ge=0,
        le=5,
    )

    # ── General ──
    daily_budget_usd: float = Field(
        default=5.00,
        description="Maximum daily spend in USD across all APIs",
        ge=0,
    )
    photo_import_dir: str = Field(
        default="../photography",
        description="Directory to scan for new photos (relative to Agent root)",
    )
    log_level: str = Field(
        default="INFO",
        description="Logging level (DEBUG, INFO, WARNING, ERROR)",
    )
    db_path: str = Field(
        default="data/archive35.db",
        description="Path to SQLite database file",
    )

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """Ensure log level is valid."""
        valid = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        upper = v.upper()
        if upper not in valid:
            raise ValueError(f"log_level must be one of {valid}, got '{v}'")
        return upper

    @property
    def db_path_resolved(self) -> Path:
        """Return resolved Path object for the database."""
        return Path(self.db_path)

    def has_anthropic_key(self) -> bool:
        """Check if Anthropic API key is configured."""
        return bool(self.anthropic_api_key and self.anthropic_api_key != "sk-ant-...")

    def has_telegram_config(self) -> bool:
        """Check if Telegram bot is configured."""
        return bool(self.telegram_bot_token and self.telegram_chat_id)

    def has_late_api_key(self) -> bool:
        """Check if Late API key is configured."""
        return bool(self.late_api_key)


def get_settings(**overrides: str) -> Settings:
    """Create a Settings instance with optional overrides.

    Args:
        **overrides: Key-value pairs to override env/defaults.

    Returns:
        Validated Settings instance.

    Raises:
        ValidationError: If any value fails validation.
    """
    return Settings(**overrides)
