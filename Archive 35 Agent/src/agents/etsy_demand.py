"""Measure Etsy demand, revenue, and known contribution margin.

All collection calls are read-only. Listing publication and advertising remain
separate, approval-gated actions.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable


ETSY_PERCENT_FEES = 0.095
ETSY_PAYMENT_FIXED_FEE_USD = 0.25
ETSY_LISTING_FEE_USD = 0.20
INITIAL_AD_BUDGET_USD = 50.0
ETSY_AD_CAMPAIGN_CAP_USD = 21.0
ETSY_AD_COST_CATEGORY = "etsy_ads"
ETSY_AD_RESERVE_CATEGORY = "etsy_ads_reserve"


def _now_iso() -> str:
    """Return a stable UTC timestamp for one collection run."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _money(value: Any) -> tuple[float, str]:
    """Convert an Etsy Money object or numeric value to USD-like units."""
    if isinstance(value, dict):
        divisor = value.get("divisor", 100) or 100
        amount = float(value.get("amount", 0)) / float(divisor)
        return amount, value.get("currency_code", "USD")
    try:
        return float(value or 0), "USD"
    except (TypeError, ValueError):
        return 0.0, "USD"


def _first_sku(transaction: dict[str, Any]) -> str:
    """Return the first SKU from Etsy's string-or-list representation."""
    sku = transaction.get("sku", "")
    if isinstance(sku, list):
        return str(sku[0]) if sku else ""
    return str(sku or "")


def _receipt_timestamp(receipt: dict[str, Any], fallback: str) -> str:
    """Use Etsy's order event time so old orders do not look newly earned."""
    for field in ("paid_timestamp", "created_timestamp", "create_timestamp"):
        value = receipt.get(field)
        if value:
            return datetime.fromtimestamp(
                int(value), tz=timezone.utc,
            ).isoformat(timespec="seconds")
    return fallback


def capture_listing_snapshots(
    conn: sqlite3.Connection,
    listings: Iterable[dict[str, Any]],
    captured_at: str | None = None,
) -> int:
    """Persist an immutable point-in-time snapshot for each Etsy listing."""
    timestamp = captured_at or _now_iso()
    rows = []
    for listing in listings:
        price, currency = _money(listing.get("price"))
        rows.append((
            timestamp,
            int(listing["listing_id"]),
            str(listing.get("state", "active")),
            str(listing.get("title", "")),
            str(listing.get("type", listing.get("listing_type", "physical"))),
            price,
            currency,
            int(listing.get("views", 0) or 0),
            int(listing.get("num_favorers", 0) or 0),
            int(listing.get("quantity", 0) or 0),
            listing.get("url"),
        ))

    conn.executemany(
        """INSERT OR REPLACE INTO etsy_listing_snapshots
           (captured_at, listing_id, state, title, listing_type, price_usd,
            currency, views, favorites, quantity, url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )
    conn.commit()
    return len(rows)


def _known_cogs(
    conn: sqlite3.Connection,
    sku: str,
    quantity: int,
) -> float | None:
    """Return known product cost; digital Archive-35 SKUs have zero COGS."""
    if sku.startswith("A35-DIG-"):
        return 0.0
    if not sku:
        return None
    row = conn.execute(
        "SELECT base_cost_usd FROM sku_catalog WHERE sku = ?",
        (sku,),
    ).fetchone()
    return float(row[0]) * quantity if row else None


def capture_order_facts(
    conn: sqlite3.Connection,
    receipts: Iterable[dict[str, Any]],
    captured_at: str | None = None,
) -> int:
    """Upsert transaction-level facts without storing buyer PII."""
    timestamp = captured_at or _now_iso()
    rows = []
    for receipt in receipts:
        receipt_id = int(receipt["receipt_id"])
        ordered_at = _receipt_timestamp(receipt, timestamp)
        for index, txn in enumerate(receipt.get("transactions", [])):
            quantity = int(txn.get("quantity", 1) or 1)
            unit_price, currency = _money(txn.get("price"))
            sku = _first_sku(txn)
            transaction_id = txn.get("transaction_id")
            order_key = f"{receipt_id}:{transaction_id or index}"
            rows.append((
                order_key, receipt_id, transaction_id, txn.get("listing_id"),
                sku, quantity, unit_price * quantity, currency,
                _known_cogs(conn, sku, quantity), ordered_at,
            ))

    conn.executemany(
        """INSERT OR REPLACE INTO etsy_order_facts
           (order_key, receipt_id, transaction_id, listing_id, sku, quantity,
            gross_usd, currency, cogs_usd, captured_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )
    conn.commit()
    return len(rows)


def capture_payment_fact(
    conn: sqlite3.Connection,
    receipt_id: int,
    payment: dict[str, Any],
    captured_at: str | None = None,
) -> bool:
    """Store Etsy's posted payment totals without retaining buyer data."""
    gross, currency = _money(payment.get("amount_gross"))
    fees, fee_currency = _money(payment.get("amount_fees"))
    net, net_currency = _money(payment.get("amount_net"))
    if len({currency, fee_currency, net_currency}) != 1:
        return False
    adjusted_gross = (
        _money(payment["adjusted_gross"])[0]
        if payment.get("adjusted_gross") is not None else None
    )
    adjusted_fees = (
        _money(payment["adjusted_fees"])[0]
        if payment.get("adjusted_fees") is not None else None
    )
    adjusted_net = (
        _money(payment["adjusted_net"])[0]
        if payment.get("adjusted_net") is not None else None
    )
    conn.execute(
        """INSERT OR REPLACE INTO etsy_payment_facts
           (receipt_id, payment_id, gross_usd, fees_usd, net_usd,
            adjusted_gross_usd, adjusted_fees_usd, adjusted_net_usd,
            currency, captured_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            receipt_id, payment.get("payment_id"), gross, fees, net,
            adjusted_gross, adjusted_fees, adjusted_net, currency,
            captured_at or _now_iso(),
        ),
    )
    conn.commit()
    return True


def _budget_totals(conn: sqlite3.Connection) -> tuple[float, float, float, float]:
    """Return non-ad spend, actual ad spend, ad reserve, and committed exposure."""
    row = conn.execute(
        """SELECT
             COALESCE(SUM(CASE WHEN category NOT IN (?, ?)
                               THEN amount_usd ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN category = ?
                               THEN amount_usd ELSE 0 END), 0),
             COALESCE(SUM(CASE WHEN category = ?
                               THEN amount_usd ELSE 0 END), 0)
           FROM etsy_experiment_costs""",
        (
            ETSY_AD_COST_CATEGORY, ETSY_AD_RESERVE_CATEGORY,
            ETSY_AD_COST_CATEGORY, ETSY_AD_RESERVE_CATEGORY,
        ),
    ).fetchone()
    base, ads, reserve = map(float, row)
    return base, ads, reserve, base + max(ads, reserve)


def record_experiment_cost(
    conn: sqlite3.Connection,
    amount_usd: float,
    category: str = "etsy_ads",
    note: str = "",
    external_reference: str | None = None,
    incurred_at: str | None = None,
) -> float:
    """Record spend only when it keeps the initial experiment at or below $50."""
    amount = round(float(amount_usd), 2)
    if amount < 0:
        raise ValueError("Experiment cost cannot be negative")
    if amount > 0 and not external_reference:
        raise ValueError("Nonzero experiment costs require an idempotency reference")
    try:
        conn.execute("BEGIN IMMEDIATE")
        base, ads, reserve, committed = _budget_totals(conn)
        if category == ETSY_AD_COST_CATEGORY:
            ads += amount
        elif category == ETSY_AD_RESERVE_CATEGORY:
            reserve += amount
        else:
            base += amount
        if category in (ETSY_AD_COST_CATEGORY, ETSY_AD_RESERVE_CATEGORY):
            category_total = (
                ads if category == ETSY_AD_COST_CATEGORY else reserve
            )
            if category_total > ETSY_AD_CAMPAIGN_CAP_USD:
                current_total = category_total - amount
                remaining = round(
                    ETSY_AD_CAMPAIGN_CAP_USD - current_total, 2,
                )
                raise ValueError(
                    f"Etsy Ads campaign cap exceeded: ${remaining:.2f} remains"
                )
        prospective = base + max(ads, reserve)
        if prospective > INITIAL_AD_BUDGET_USD:
            remaining = round(INITIAL_AD_BUDGET_USD - committed, 2)
            raise ValueError(
                f"Initial Etsy budget exceeded: ${remaining:.2f} remains"
            )
        conn.execute(
            """INSERT INTO etsy_experiment_costs
               (incurred_at, category, amount_usd, note, external_reference)
               VALUES (?, ?, ?, ?, ?)""",
            (
                incurred_at or _now_iso(),
                category,
                amount,
                note,
                external_reference,
            ),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return round(prospective, 2)


def revenue_report(
    conn: sqlite3.Connection,
    days: int = 30,
) -> dict[str, Any]:
    """Return revenue, known contribution, demand deltas, and budget status."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    order_row = conn.execute(
        """SELECT COUNT(DISTINCT receipt_id), COUNT(*),
                  COALESCE(SUM(gross_usd), 0), COALESCE(SUM(cogs_usd), 0),
                  SUM(CASE WHEN cogs_usd IS NULL THEN 1 ELSE 0 END),
                  SUM(CASE WHEN currency != 'USD' THEN 1 ELSE 0 END)
           FROM etsy_order_facts WHERE captured_at >= ?""",
        (cutoff,),
    ).fetchone()
    orders = int(order_row[0] or 0)
    transactions = int(order_row[1] or 0)
    gross = float(order_row[2] or 0)
    known_cogs = float(order_row[3] or 0)
    unknown_cogs = int(order_row[4] or 0)
    non_usd = int(order_row[5] or 0)
    estimated_fees = gross * ETSY_PERCENT_FEES
    estimated_fees += orders * ETSY_PAYMENT_FIXED_FEE_USD
    estimated_fees += transactions * ETSY_LISTING_FEE_USD
    payment_row = conn.execute(
        """SELECT COUNT(*),
                  COALESCE(SUM(COALESCE(p.adjusted_fees_usd, p.fees_usd)), 0),
                  COALESCE(SUM(COALESCE(p.adjusted_net_usd, p.net_usd)), 0),
                  SUM(CASE WHEN p.currency != 'USD' THEN 1 ELSE 0 END)
           FROM etsy_payment_facts p
           WHERE p.receipt_id IN (
               SELECT DISTINCT receipt_id FROM etsy_order_facts
               WHERE captured_at >= ?
           )""",
        (cutoff,),
    ).fetchone()
    payments = int(payment_row[0] or 0)
    actual_fees = float(payment_row[1] or 0)
    actual_net = float(payment_row[2] or 0)
    payment_non_usd = int(payment_row[3] or 0)
    fee_data_complete = payments == orders and payment_non_usd == 0

    spend = float(conn.execute(
        """SELECT COALESCE(SUM(amount_usd), 0)
           FROM etsy_experiment_costs
           WHERE incurred_at >= ? AND category != ?""",
        (cutoff, ETSY_AD_RESERVE_CATEGORY),
    ).fetchone()[0])
    base_spend, ad_spend, ad_reserve, committed = _budget_totals(conn)
    lifetime_spend = base_spend + ad_spend
    unspent_reserve = max(ad_reserve - ad_spend, 0)

    listing_rows = conn.execute(
        """WITH ranked AS (
               SELECT listing_id, title, views, favorites, captured_at,
                      ROW_NUMBER() OVER (
                          PARTITION BY listing_id ORDER BY captured_at ASC
                      ) AS first_rank,
                      ROW_NUMBER() OVER (
                          PARTITION BY listing_id ORDER BY captured_at DESC
                      ) AS last_rank
               FROM etsy_listing_snapshots WHERE captured_at >= ?
           )
           SELECT listing_id, MAX(title),
                  MAX(CASE WHEN last_rank = 1 THEN views END) -
                  MAX(CASE WHEN first_rank = 1 THEN views END),
                  MAX(CASE WHEN last_rank = 1 THEN favorites END) -
                  MAX(CASE WHEN first_rank = 1 THEN favorites END)
           FROM ranked GROUP BY listing_id""",
        (cutoff,),
    ).fetchall()
    demand = [
        {
            "listing_id": row[0],
            "title": row[1],
            "view_delta": int(row[2] or 0),
            "favorite_delta": int(row[3] or 0),
        }
        for row in listing_rows
    ]
    demand.sort(
        key=lambda item: (item["favorite_delta"], item["view_delta"]),
        reverse=True,
    )

    contribution = (
        actual_net - known_cogs - spend if fee_data_complete
        else gross - estimated_fees - known_cogs - spend
    )
    return {
        "period_days": days,
        "orders": orders,
        "transactions": transactions,
        "gross_revenue_usd": round(gross, 2),
        "estimated_etsy_fees_usd": round(estimated_fees, 2),
        "actual_etsy_fees_usd": round(actual_fees, 2),
        "actual_etsy_net_usd": round(actual_net, 2),
        "fee_data_complete": fee_data_complete,
        "known_cogs_usd": round(known_cogs, 2),
        "experiment_spend_usd": round(spend, 2),
        "estimated_contribution_usd": round(contribution, 2),
        "profit_verified": False,
        "profit_verification_note": (
            "Requires complete Etsy payment facts, COGS, refunds, and "
            "payment-account/ad-spend reconciliation."
        ),
        "transactions_with_unknown_cogs": unknown_cogs,
        "transactions_outside_usd": non_usd,
        "budget_spent_usd": round(lifetime_spend, 2),
        "budget_reserved_usd": round(unspent_reserve, 2),
        "budget_committed_usd": round(committed, 2),
        "budget_remaining_usd": round(INITIAL_AD_BUDGET_USD - committed, 2),
        "etsy_ads_cap_usd": ETSY_AD_CAMPAIGN_CAP_USD,
        "etsy_ads_spend_remaining_usd": round(
            max(ETSY_AD_CAMPAIGN_CAP_USD - ad_spend, 0), 2,
        ),
        "monthly_target_usd": 500.0,
        "target_progress_pct": round(max(contribution, 0) / 500 * 100, 1),
        "top_demand": demand[:10],
    }


def collect_from_etsy(
    conn: sqlite3.Connection,
    client: Any,
) -> dict[str, Any]:
    """Read current Etsy listings and paid receipts into local measurement tables."""
    timestamp = _now_iso()
    listings = []
    for state in ("active", "draft"):
        response = client.get_listings(state=state, limit=100, offset=0)
        if "error" in response:
            raise RuntimeError(f"Etsy {state} listings: {response['error']}")
        listings.extend(response.get("results", []))

    receipts_response = client.get_receipts(was_paid=True, limit=100)
    if "error" in receipts_response:
        raise RuntimeError(f"Etsy receipts: {receipts_response['error']}")

    listing_count = capture_listing_snapshots(
        conn, listings, captured_at=timestamp,
    )
    transaction_count = capture_order_facts(
        conn,
        receipts_response.get("results", []),
        captured_at=timestamp,
    )
    payment_count = 0
    payment_errors = []
    for receipt in receipts_response.get("results", []):
        receipt_id = int(receipt["receipt_id"])
        response = client.get_receipt_payments(receipt_id)
        if "error" in response:
            payment_errors.append(receipt_id)
            continue
        payment = response.get("results", response)
        if isinstance(payment, list):
            payment = payment[0] if payment else {}
        if payment and capture_payment_fact(
            conn, receipt_id, payment, captured_at=timestamp,
        ):
            payment_count += 1
    return {
        "captured_at": timestamp,
        "listings": listing_count,
        "transactions": transaction_count,
        "payments": payment_count,
        "payment_errors": payment_errors,
        "report": revenue_report(conn),
    }
