#!/usr/bin/env python3
"""
Etsy Stats Monitor for Archive-35
Tracks shop stats and generates weekly summary reports.

If Etsy API is not configured, pulls what data is available from
local listing exports and the agent dashboard /health endpoint.

Output: Weekly summary saved to data/weekly_stats/ and optionally
emailed via the notification system.
"""
import json
import logging
import os
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

AGENT_BASE = Path(__file__).resolve().parents[2]  # Archive 35 Agent
BASE = AGENT_BASE.parents[0]  # archive-35 root
DB_PATH = AGENT_BASE / "data" / "archive35.db"
STATS_DIR = AGENT_BASE / "data" / "weekly_stats"
ETSY_EXPORT = BASE / "06_Automation" / "etsy-export"
CATALOG_FILE = BASE / "data" / "licensing-catalog.json"

STATS_DIR.mkdir(parents=True, exist_ok=True)


def _load_env() -> dict:
    """Load .env file."""
    env = {}
    env_path = AGENT_BASE / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    env.update(os.environ)
    return env


def _check_etsy_api() -> bool:
    """Check if Etsy API credentials are configured."""
    env = _load_env()
    api_key = env.get("ETSY_API_KEY", "")
    return bool(api_key and len(api_key) > 5)


def _get_db_stats() -> dict:
    """Pull stats from the local SQLite database."""
    stats = {
        "audit_log_entries_7d": 0,
        "etsy_actions_7d": 0,
        "total_photos": 0,
        "content_pending": 0,
        "content_approved": 0,
    }

    if not DB_PATH.exists():
        return stats

    try:
        conn = sqlite3.connect(str(DB_PATH))
        cursor = conn.cursor()
        seven_days_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

        # Total audit log entries in last 7 days
        try:
            cursor.execute(
                "SELECT COUNT(*) FROM audit_log WHERE timestamp >= ?",
                (seven_days_ago,)
            )
            stats["audit_log_entries_7d"] = cursor.fetchone()[0]
        except sqlite3.OperationalError:
            pass

        # Etsy-related actions in last 7 days
        try:
            cursor.execute(
                "SELECT COUNT(*) FROM audit_log WHERE component LIKE '%etsy%' AND timestamp >= ?",
                (seven_days_ago,)
            )
            stats["etsy_actions_7d"] = cursor.fetchone()[0]
        except sqlite3.OperationalError:
            pass

        # Total photos
        try:
            cursor.execute("SELECT COUNT(*) FROM photos")
            stats["total_photos"] = cursor.fetchone()[0]
        except sqlite3.OperationalError:
            pass

        # Content status
        try:
            cursor.execute("SELECT status, COUNT(*) FROM content GROUP BY status")
            for status, count in cursor.fetchall():
                if status == "pending":
                    stats["content_pending"] = count
                elif status == "approved":
                    stats["content_approved"] = count
        except sqlite3.OperationalError:
            pass

        conn.close()
    except Exception as e:
        logger.error(f"Database error: {e}")

    return stats


def _get_listing_stats() -> dict:
    """Get stats from local listing exports."""
    stats = {
        "total_exported_listings": 0,
        "listings_by_collection": {},
        "avg_tags_per_listing": 0,
        "avg_title_length": 0,
    }

    if not ETSY_EXPORT.exists():
        return stats

    tag_counts = []
    title_lengths = []
    collections = {}

    for folder in ETSY_EXPORT.iterdir():
        if not folder.is_dir():
            continue
        listing_file = folder / "listing.json"
        if listing_file.exists():
            stats["total_exported_listings"] += 1
            try:
                with open(listing_file) as f:
                    data = json.load(f)
                tags = data.get("tags", [])
                tag_counts.append(len(tags))
                title_lengths.append(len(data.get("title", "")))
                gallery = data.get("gallery_name", "uncategorized")
                collections[gallery] = collections.get(gallery, 0) + 1
            except Exception:
                pass

    if tag_counts:
        stats["avg_tags_per_listing"] = round(sum(tag_counts) / len(tag_counts), 1)
    if title_lengths:
        stats["avg_title_length"] = round(sum(title_lengths) / len(title_lengths), 1)
    stats["listings_by_collection"] = collections

    return stats


def _get_catalog_stats() -> dict:
    """Get stats from the licensing catalog."""
    stats = {
        "total_catalog_images": 0,
        "classifications": {},
        "total_licenses_sold": 0,
        "avg_starting_price": 0,
    }

    if not CATALOG_FILE.exists():
        return stats

    try:
        with open(CATALOG_FILE) as f:
            catalog = json.load(f)
        images = catalog.get("images", [])
        stats["total_catalog_images"] = len(images)

        prices = []
        for img in images:
            classification = img.get("classification", "STANDARD")
            stats["classifications"][classification] = stats["classifications"].get(classification, 0) + 1
            stats["total_licenses_sold"] += img.get("license_count", 0)
            prices.append(img.get("starting_price", 0))

        if prices:
            stats["avg_starting_price"] = round(sum(prices) / len(prices), 2)
    except Exception as e:
        logger.error(f"Catalog error: {e}")

    return stats


def _get_seo_summary() -> dict:
    """Get summary from latest SEO report if available."""
    seo_report_path = AGENT_BASE / "data" / "etsy_seo_report.json"
    if not seo_report_path.exists():
        return {"available": False}

    try:
        with open(seo_report_path) as f:
            report = json.load(f)
        return {
            "available": True,
            "overall_score": report.get("summary", {}).get("overall_score", 0),
            "total_analyzed": report.get("total_listings", 0),
            "generated_at": report.get("generated_at", ""),
        }
    except Exception:
        return {"available": False}


def _try_agent_health() -> dict:
    """Try to get health data from the agent API."""
    try:
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:8035/health", method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            return json.loads(resp.read())
    except Exception:
        return {"status": "unreachable"}


def generate_weekly_report() -> dict:
    """Generate the weekly stats report."""
    now = datetime.now(timezone.utc)
    week_label = now.strftime("%Y-W%V")

    report = {
        "report_type": "weekly_stats",
        "generated_at": now.isoformat(),
        "week": week_label,
        "period_start": (now - timedelta(days=7)).isoformat(),
        "period_end": now.isoformat(),
        "etsy_api_available": _check_etsy_api(),
        "agent_health": _try_agent_health(),
        "database_stats": _get_db_stats(),
        "listing_stats": _get_listing_stats(),
        "catalog_stats": _get_catalog_stats(),
        "seo_summary": _get_seo_summary(),
        "recommendations": [],
    }

    # Generate recommendations
    listing_stats = report["listing_stats"]
    catalog_stats = report["catalog_stats"]
    seo = report["seo_summary"]

    if not report["etsy_api_available"]:
        report["recommendations"].append({
            "priority": "HIGH",
            "area": "Etsy API",
            "message": "Etsy API not configured. Add ETSY_API_KEY to .env for live stats tracking.",
        })

    if listing_stats["total_exported_listings"] < 50:
        report["recommendations"].append({
            "priority": "MEDIUM",
            "area": "Listings",
            "message": f"Only {listing_stats['total_exported_listings']} listings exported. "
                       f"Consider expanding to cover more of the {catalog_stats['total_catalog_images']} catalog images.",
        })

    if seo.get("available") and seo.get("overall_score", 100) < 80:
        report["recommendations"].append({
            "priority": "HIGH",
            "area": "SEO",
            "message": f"SEO score is {seo['overall_score']}/100. Run the SEO optimizer to improve.",
        })

    if listing_stats.get("avg_title_length", 140) < 120:
        report["recommendations"].append({
            "priority": "MEDIUM",
            "area": "Titles",
            "message": f"Average title length is {listing_stats['avg_title_length']}/140 chars. Longer titles rank better.",
        })

    return report


def save_report(report: dict) -> Path:
    """Save the weekly report to disk."""
    filename = f"weekly_{report['week']}_{datetime.now().strftime('%Y%m%d')}.json"
    filepath = STATS_DIR / filename
    with open(filepath, "w") as f:
        json.dump(report, f, indent=2)
    return filepath


def send_weekly_email(report: dict) -> bool:
    """Send weekly summary email if email system is configured."""
    try:
        from src.notifications.email import send_notification
    except ImportError:
        # Try relative import
        try:
            import sys
            sys.path.insert(0, str(AGENT_BASE))
            from src.notifications.email import send_notification
        except ImportError:
            logger.warning("Email notification system not available")
            return False

    summary = report.get("database_stats", {})
    listing_stats = report.get("listing_stats", {})
    catalog_stats = report.get("catalog_stats", {})
    seo = report.get("seo_summary", {})

    body = f"""Archive-35 Etsy Weekly Stats - {report['week']}

OVERVIEW
- Exported listings: {listing_stats.get('total_exported_listings', 0)}
- Catalog images: {catalog_stats.get('total_catalog_images', 0)}
- Licenses sold (all time): {catalog_stats.get('total_licenses_sold', 0)}
- Etsy API: {'Connected' if report.get('etsy_api_available') else 'Not configured'}

STATS (Last 7 Days)
- Audit log entries: {summary.get('audit_log_entries_7d', 0)}
- Etsy-related actions: {summary.get('etsy_actions_7d', 0)}

SEO HEALTH
- Overall score: {seo.get('overall_score', 'N/A')}/100
- Avg title length: {listing_stats.get('avg_title_length', 'N/A')}/140
- Avg tags per listing: {listing_stats.get('avg_tags_per_listing', 'N/A')}/13

RECOMMENDATIONS
"""
    for rec in report.get("recommendations", []):
        body += f"- [{rec['priority']}] {rec['area']}: {rec['message']}\n"

    if not report.get("recommendations"):
        body += "- No urgent recommendations.\n"

    body += f"\nGenerated: {report['generated_at']}\n"

    try:
        return send_notification(
            subject=f"Archive-35 Weekly Etsy Report - {report['week']}",
            body=body,
        )
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False


def main():
    """Run weekly stats collection and reporting."""
    print("Generating weekly Etsy stats report...")
    report = generate_weekly_report()
    filepath = save_report(report)
    print(f"Report saved to: {filepath}")

    # Print summary
    ls = report["listing_stats"]
    cs = report["catalog_stats"]
    seo = report["seo_summary"]
    print(f"\nWeekly Summary ({report['week']}):")
    print(f"  Exported listings: {ls['total_exported_listings']}")
    print(f"  Catalog images: {cs['total_catalog_images']}")
    print(f"  Licenses sold (all time): {cs['total_licenses_sold']}")
    print(f"  Etsy API: {'Connected' if report['etsy_api_available'] else 'Not configured'}")
    print(f"  SEO score: {seo.get('overall_score', 'N/A')}/100")
    print(f"  Recommendations: {len(report.get('recommendations', []))}")

    # Try to send email (will silently fail if not configured)
    email_sent = send_weekly_email(report)
    if email_sent:
        print("  Email notification sent.")
    else:
        print("  Email notification: skipped (not configured or unavailable)")


if __name__ == "__main__":
    main()
