import json

import pytest

from src.products.digital_listing import build_listing_copy, write_listing_plan


def test_listing_copy_is_digital_clear_and_etsy_compliant():
    listing = build_listing_copy(
        product_id="A35-DIG-ANT-0001",
        artwork_title="Crimson Passage Through Stone",
        location="Antelope Canyon, Arizona, USA",
        price_usd=12,
    )

    assert listing["type"] == "download"
    assert listing["description"].startswith("DIGITAL DOWNLOAD — NO PHYSICAL ITEM")
    assert "not AI-generated" in listing["description"]
    assert len(listing["tags"]) == 13
    assert all(len(tag) <= 20 for tag in listing["tags"])
    assert len(listing["title"]) <= 140


def test_listing_plan_resolves_manifest_files(tmp_path):
    package = tmp_path / "A35-DIG-TEST"
    package.mkdir()
    (package / "one.jpg").write_bytes(b"jpg")
    (package / "manifest.json").write_text(json.dumps({
        "delivery_files": [{"filename": "one.jpg"}],
    }))

    destination = write_listing_plan(
        package,
        {"title": "Test", "price": 12},
    )
    saved = json.loads(destination.read_text())
    assert saved["delivery_files"] == [str(package.resolve() / "one.jpg")]


def test_listing_rejects_invalid_tag_set():
    with pytest.raises(ValueError):
        build_listing_copy(
            product_id="A35-DIG-TEST",
            artwork_title="Test",
            location="Test",
            price_usd=12,
            tags=["only one"],
        )


def test_listing_accepts_subject_specific_title_and_tags():
    tags = [f"tag {number}" for number in range(13)]
    listing = build_listing_copy(
        product_id="A35-DIG-ICE-0001",
        artwork_title="Vestrahorn's Reflection in Still Waters",
        location="Iceland",
        price_usd=12,
        tags=tags,
        etsy_title="Iceland Mountain Printable Wall Art, Nordic Landscape Digital Download",
    )
    assert listing["title"].startswith("Iceland Mountain")
    assert listing["tags"] == tags
