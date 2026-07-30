from unittest.mock import patch

from src.integrations.etsy import (
    create_digital_listing,
    create_listing,
    find_listing_by_sku,
    get_receipts,
    upload_listing_file_from_path,
    update_listing,
)


def test_create_download_listing_omits_physical_profiles():
    with (
        patch("src.integrations.etsy.get_credentials", return_value={"shop_id": "35"}),
        patch("src.integrations.etsy.get_photography_taxonomy_id", return_value=99),
        patch("src.integrations.etsy.get_or_create_no_returns_policy_id", return_value=7),
        patch("src.integrations.etsy._api_request", return_value={"listing_id": 123}) as request,
    ):
        result = create_listing(
            "Title", "Description", 12, ["wall art"], listing_type="download"
        )

    assert result["listing_id"] == 123
    payload = request.call_args.kwargs["data"]
    assert request.call_args.kwargs["content_type"] == (
        "application/x-www-form-urlencoded"
    )
    assert payload["type"] == "download"
    assert "shipping_profile_id" not in payload
    assert "readiness_state_id" not in payload


def test_complete_digital_listing_stays_draft_by_default(tmp_path):
    files = [tmp_path / f"delivery-{number}.jpg" for number in range(2)]
    previews = [tmp_path / "preview.jpg"]
    for path in files + previews:
        path.write_bytes(b"jpeg")

    with (
        patch(
            "src.integrations.etsy.create_listing",
            return_value={"listing_id": 456},
        ) as create,
        patch(
            "src.integrations.etsy.upload_listing_image_from_file",
            return_value={"listing_image_id": 1},
        ) as image_upload,
        patch(
            "src.integrations.etsy.upload_listing_file_from_path",
            return_value={"listing_file_id": 2},
        ) as file_upload,
        patch(
            "src.integrations.etsy.get_listing_inventory",
            side_effect=[
                {"products": [{"offerings": [{}]}]},
                {"products": [{
                    "sku": "A35-DIG-ANT-0001",
                    "offerings": [{}],
                }]},
            ],
        ),
        patch(
            "src.integrations.etsy.update_listing_inventory",
            return_value={},
        ) as inventory_update,
        patch("src.integrations.etsy.update_listing") as update,
    ):
        result = create_digital_listing(
            title="Crimson Passage",
            description="Digital download",
            price=12,
            tags=["antelope canyon"],
            sku="A35-DIG-ANT-0001",
            delivery_files=[str(path) for path in files],
            image_paths=[str(path) for path in previews],
        )

    assert result["status"] == "draft"
    assert create.call_args.kwargs["when_made"] == "2020_2026"
    inventory_payload = inventory_update.call_args.args[1]
    assert inventory_payload["products"][0]["sku"] == "A35-DIG-ANT-0001"
    assert inventory_payload["products"][0]["offerings"][0]["price"] == 12
    assert image_upload.call_count == 1
    assert file_upload.call_count == 2
    update.assert_not_called()


def test_digital_listing_rejects_missing_sku_readback(tmp_path):
    delivery = tmp_path / "delivery.jpg"
    preview = tmp_path / "preview.jpg"
    delivery.write_bytes(b"jpeg")
    preview.write_bytes(b"jpeg")
    with (
        patch("src.integrations.etsy.create_listing", return_value={"listing_id": 456}),
        patch("src.integrations.etsy.upload_listing_image_from_file", return_value={}),
        patch("src.integrations.etsy.upload_listing_file_from_path", return_value={}),
        patch(
            "src.integrations.etsy.get_listing_inventory",
            side_effect=[
                {"products": [{"offerings": [{}]}]},
                {"products": [{"sku": "", "offerings": [{}]}]},
            ],
        ),
        patch("src.integrations.etsy.update_listing_inventory", return_value={}),
    ):
        result = create_digital_listing(
            title="Title",
            description="Digital download",
            price=12,
            tags=["wall art"],
            sku="A35-DIG-TEST",
            delivery_files=[str(delivery)],
            image_paths=[str(preview)],
        )
    assert result["status"] == "unverified_draft"
    assert result["error"] == "Draft SKU inventory readback failed"


def test_digital_listing_rejects_more_than_five_files():
    result = create_digital_listing(
        title="Title",
        description="Description",
        price=12,
        tags=[],
        sku="A35-DIG-TEST",
        delivery_files=["x"] * 6,
        image_paths=["preview.jpg"],
    )
    assert "between 1 and 5" in result["error"]


def test_zip_delivery_upload_uses_zip_content_type(tmp_path):
    archive = tmp_path / "bundle.zip"
    archive.write_bytes(b"zip")
    with (
        patch("src.integrations.etsy.ensure_valid_token", return_value={"valid": True}),
        patch("src.integrations.etsy._rate_limit"),
        patch(
            "src.integrations.etsy.get_credentials",
            return_value={"shop_id": "35", "api_key": "key", "access_token": "token"},
        ),
        patch("src.integrations.etsy.urllib.request.urlopen") as urlopen,
    ):
        urlopen.return_value.__enter__.return_value.read.return_value = b"{}"
        upload_listing_file_from_path(456, str(archive))
    body = urlopen.call_args.args[0].data
    assert b"Content-Type: application/zip" in body


def test_paid_receipt_filter_reaches_etsy_api():
    with (
        patch("src.integrations.etsy.get_credentials", return_value={"shop_id": "35"}),
        patch("src.integrations.etsy._api_request", return_value={}) as request,
    ):
        get_receipts(was_paid=True, limit=100)
    assert "was_paid=true" in request.call_args.args[0]


def test_duplicate_lookup_falls_back_to_sku_marker_in_description():
    with patch(
        "src.integrations.etsy.get_listings",
        return_value={"results": [{
            "listing_id": 456,
            "description": "Digital item\n\nSKU: A35-DIG-ANT-0001",
            "skus": [],
        }]},
    ):
        found = find_listing_by_sku("A35-DIG-ANT-0001")
    assert found["listing_id"] == 456


def test_listing_update_uses_form_encoding():
    with (
        patch("src.integrations.etsy.get_credentials", return_value={"shop_id": "35"}),
        patch("src.integrations.etsy._api_request", return_value={}) as request,
    ):
        update_listing(456, {"state": "active"})
    assert request.call_args.kwargs["content_type"] == (
        "application/x-www-form-urlencoded"
    )
