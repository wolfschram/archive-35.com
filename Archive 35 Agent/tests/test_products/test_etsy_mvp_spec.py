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
    assert len({product["web_slug"] for product in products}) == 10
    assert len({product["web_image"] for product in products}) == 10
    assert len({product["etsy_listing_id"] for product in products}) == 10
    assert len({product["etsy_listing_slug"] for product in products}) == 10
    assert len(advertised) == 5
    assert advertised < product_ids

    for product in products:
        assert (AGENT_ROOT / product["source"]).resolve().is_file()
        assert (
            AGENT_ROOT.parent / "images" / "printables" / product["web_image"]
        ).is_file()
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


def test_current_ad_evidence_matches_the_approved_campaign_scope():
    spec = json.loads(
        (AGENT_ROOT / "experiments" / "etsy-digital-mvp.json").read_text()
    )
    evidence = json.loads(
        (AGENT_ROOT / "experiments" / "etsy-ads-launch-evidence.json").read_text()
    )
    approved = set(spec["campaign"]["advertised_product_ids"])
    approved.update(spec["campaign"]["advertised_bundle_product_ids"])
    observed = {
        item["sku"] for item in evidence["current_approved_advertised_listings"]
    }

    assert approved == observed
    assert len(observed) == 7
    assert evidence["latest_observation"]["advertised_listing_count"] == 7
    assert evidence["latest_observation"]["daily_budget_usd"] == 1.0
