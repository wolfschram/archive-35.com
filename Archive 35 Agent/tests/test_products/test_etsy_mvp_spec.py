import json
from pathlib import Path

from src.products.digital_listing import build_listing_copy


AGENT_ROOT = Path(__file__).resolve().parents[2]


def test_mvp_has_five_distinct_valid_products():
    spec = json.loads(
        (AGENT_ROOT / "experiments" / "etsy-digital-mvp.json").read_text()
    )
    products = spec["products"]
    assert len(products) == 5
    assert len({product["product_id"] for product in products}) == 5
    assert len({product["location"] for product in products}) == 5

    for product in products:
        assert (AGENT_ROOT / product["source"]).resolve().is_file()
        listing = build_listing_copy(
            product_id=product["product_id"],
            artwork_title=product["artwork_title"],
            location=product["location"],
            price_usd=spec["price_usd"],
            tags=product["tags"],
            etsy_title=product["etsy_title"],
        )
        assert listing["price"] == 12
        assert len(listing["tags"]) == 13
