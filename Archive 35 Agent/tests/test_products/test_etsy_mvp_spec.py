import json
from pathlib import Path

from src.products.digital_listing import build_listing_copy


AGENT_ROOT = Path(__file__).resolve().parents[2]


def test_mvp_has_fifteen_distinct_valid_products_and_five_advertised():
    spec = json.loads(
        (AGENT_ROOT / "experiments" / "etsy-digital-mvp.json").read_text()
    )
    products = spec["products"]
    product_ids = {product["product_id"] for product in products}
    advertised = set(spec["campaign"]["advertised_product_ids"])
    assert len(products) == 15
    assert len(product_ids) == 15
    assert len({product["source"] for product in products}) == 15
    assert len({product["web_slug"] for product in products}) == 15
    assert len({product["web_image"] for product in products}) == 15
    assert len({product["etsy_listing_id"] for product in products}) == 15
    assert len({product["etsy_listing_slug"] for product in products}) == 15
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


def test_printables_sale_is_limited_to_the_twelve_digital_products():
    spec = json.loads(
        (AGENT_ROOT / "experiments" / "etsy-digital-mvp.json").read_text()
    )
    evidence = json.loads(
        (
            AGENT_ROOT
            / "experiments"
            / "etsy-printables-sale-evidence.json"
        ).read_text()
    )
    expected = {
        product["product_id"]
        for product in spec["products"]
        if product.get("sale_included", True)
    }
    expected.update(spec["campaign"]["advertised_bundle_product_ids"])
    included = {item["sku"] for item in evidence["included_listings"]}
    organic = {
        item["sku"] for item in evidence["organic_expansion_not_in_sale"]
    }

    assert evidence["sale_name"] == "PRINTABLE25"
    assert evidence["discount_percent"] == 25
    assert evidence["listing_scope"] == "selected_listings"
    assert evidence["starts_on"] == "2026-07-30"
    assert evidence["ends_on"] == "2026-08-06"
    assert evidence["included_section"]["listing_count"] == 12
    assert included == expected
    assert len(included) == 12
    assert len(organic) == 5
    assert included.isdisjoint(organic)
    assert included | organic == {
        product["product_id"] for product in spec["products"]
    } | set(spec["campaign"]["advertised_bundle_product_ids"])
    assert all(
        item["sale_price_usd"] == item["base_price_usd"] * 0.75
        for item in evidence["included_listings"]
    )
    assert evidence["excluded_sections"] == [
        {"name": "Metal & Acrylic Prints", "listing_count": 28}
    ]
