import json
from pathlib import Path

from src.products.digital_listing import build_listing_copy


AGENT_ROOT = Path(__file__).resolve().parents[2]


def test_mvp_has_ten_distinct_valid_products_and_five_advertised():
    spec = json.loads(
        (AGENT_ROOT / "experiments" / "etsy-digital-mvp.json").read_text()
    )
    products = spec["products"]
    product_ids = {product["product_id"] for product in products}
    advertised = set(spec["campaign"]["advertised_product_ids"])
    assert len(products) == 10
    assert len(product_ids) == 10
    assert len({product["source"] for product in products}) == 10
    assert len(advertised) == 5
    assert advertised < product_ids

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
