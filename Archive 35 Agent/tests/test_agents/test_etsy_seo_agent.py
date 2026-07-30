"""Tests for the current Etsy buyer-friendly SEO audit."""

from src.agents.etsy_seo_agent import (
    analyze_description,
    analyze_tags,
    analyze_title,
    load_listings,
    run_analysis,
)


def test_audit_loads_the_seventeen_controlled_downloads():
    listings = load_listings()
    assert len(listings) == 17
    assert all(row["_folder"].startswith("A35-DIG-") for row in listings)


def test_current_titles_follow_etsy_buyer_friendly_guidance():
    for listing in load_listings():
        result = analyze_title(listing)
        assert result["score"] == 100
        assert result["word_count"] <= 15
        assert result["has_item_term"]


def test_title_audit_rejects_keyword_stuffing_and_sale_language():
    result = analyze_title({
        "title": (
            "SALE Wall Art | Wall Art | Perfect Gift | Free Shipping | "
            "Printable Wall Art Digital Download Beautiful Home Decor"
        )
    })
    assert result["score"] < 70
    assert result["issues"]


def test_tags_are_not_penalized_for_irrelevant_seasonal_terms():
    tags = [f"relevant tag {index}" for index in range(13)]
    result = analyze_tags({"tags": tags})
    assert result["score"] == 100
    assert result["suggested_tags"] == []


def test_current_download_descriptions_cover_buyer_critical_details():
    assert all(
        analyze_description(listing)["score"] == 100
        for listing in load_listings()
    )


def test_report_records_scope_and_official_guidance():
    report = run_analysis()
    assert report["catalog_scope"] == "controlled_digital_downloads"
    assert report["summary"]["titles_buyer_friendly"] == 17
    assert report["summary"]["descriptions_buyer_complete"] == 17
    assert report["summary"]["overall_score"] == 100
