#!/usr/bin/env python3
"""Write the authoritative combined Etsy + Stripe revenue report."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import httpx


AGENT = Path(__file__).resolve().parents[1]
ROOT = AGENT.parent
sys.path.insert(0, str(AGENT))

from src.agents.stripe_revenue import (  # noqa: E402
    collect_stripe_printable_revenue,
    combine_revenue_reports,
)


def load_env(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text().splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument(
        "--output",
        type=Path,
        default=AGENT / "data/revenue-operator-latest.json",
    )
    args = parser.parse_args()
    if not 1 <= args.days <= 365:
        raise SystemExit("--days must be between 1 and 365")

    secret_key = load_env(ROOT / ".env").get("STRIPE_SECRET_KEY", "")
    stripe = collect_stripe_printable_revenue(secret_key, days=args.days)
    response = httpx.get(
        "http://localhost:8035/etsy/revenue/report",
        params={"days": args.days},
        timeout=30,
    )
    response.raise_for_status()
    report = combine_revenue_reports(response.json(), stripe)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
