#!/usr/bin/env python3
"""Publish one fully verified Etsy draft after reserving its listing fee."""

from __future__ import annotations

import json
import sys
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_ROOT))

from src.agents.etsy_demand import record_experiment_cost, revenue_report
from src.db import get_initialized_connection
from src.integrations.etsy import (
    get_listing,
    get_listing_files,
    get_listing_images,
    update_listing,
)


def _price(listing: dict) -> float:
    value = listing.get("price", {})
    return float(value.get("amount", 0)) / float(value.get("divisor", 100))


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: publish_etsy_digital.py PACKAGE_DIR")
    package = Path(sys.argv[1]).resolve()
    local = json.loads((package / "listing.json").read_text())
    state_path = package / "etsy-state.json"
    state = json.loads(state_path.read_text())
    listing_id = int(state["listing_id"])
    remote = get_listing(listing_id)
    images = get_listing_images(listing_id)
    files = get_listing_files(listing_id)
    remote_type = remote.get("type", remote.get("listing_type"))
    checks = {
        "state": remote.get("state") == "draft",
        "type": remote_type == "download",
        "title": remote.get("title") == local["title"],
        "price": round(_price(remote), 2) == round(float(local["price"]), 2),
        "tags": set(remote.get("tags", [])) == set(local["tags"]),
        "sku": local["sku"] in remote.get("skus", []),
        "section": remote.get("shop_section_id") == local.get("shop_section_id"),
        "images": len(images.get("results", [])) == 5,
        "files": len(files.get("results", [])) == 5,
    }
    if not all(checks.values()):
        raise SystemExit(f"Publication preflight failed: {checks}")

    conn = get_initialized_connection(AGENT_ROOT / "data" / "archive35.db")
    reference = f"etsy-listing-fee:{listing_id}"
    try:
        existing = conn.execute(
            "SELECT 1 FROM etsy_experiment_costs WHERE external_reference = ?",
            (reference,),
        ).fetchone()
        if not existing:
            record_experiment_cost(
                conn, 0.20, category="etsy_listing_fee_reserve",
                note=f"Publication fee reserve for {local['sku']}",
                external_reference=reference,
            )
        result = update_listing(listing_id, {"state": "active"})
        if "error" in result:
            raise SystemExit(f"Publication failed; fee remains reserved: {result}")
        confirmed = get_listing(listing_id)
        if confirmed.get("state") != "active":
            raise SystemExit("Publication response was not confirmed active")
        state.update({
            "status": "active",
            "published": True,
            "publication_verified": True,
        })
        state_path.write_text(json.dumps(state, indent=2) + "\n")
        print(json.dumps({
            "listing_id": listing_id,
            "state": "active",
            "url": confirmed.get("url"),
            "budget": revenue_report(conn),
        }, indent=2))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
