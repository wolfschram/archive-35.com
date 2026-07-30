"""Verified revenue facts for Archive-35 direct printable Checkout orders."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import httpx


STRIPE_API = "https://api.stripe.com/v1"


def _usd(cents: int | float) -> float:
    return round(float(cents or 0) / 100, 2)


def summarize_printable_orders(
    sessions: list[dict[str, Any]],
    payment_intents: dict[str, dict[str, Any]],
    days: int = 30,
) -> dict[str, Any]:
    """Summarize paid printable orders without retaining customer PII."""
    orders = []
    facts_complete = True
    for session in sessions:
        metadata = session.get("metadata") or {}
        if (
            not session.get("livemode")
            or metadata.get("orderType") != "printable"
            or session.get("payment_status") != "paid"
            or session.get("status") != "complete"
        ):
            continue

        payment_intent_id = session.get("payment_intent")
        payment_intent = payment_intents.get(str(payment_intent_id), {})
        charge = payment_intent.get("latest_charge") or {}
        balance = charge.get("balance_transaction") or {}
        refunds = (charge.get("refunds") or {}).get("data") or []
        refund_balances = [
            refund.get("balance_transaction")
            for refund in refunds
            if isinstance(refund.get("balance_transaction"), dict)
        ]

        currency = str(session.get("currency") or "").lower()
        amount_total = int(session.get("amount_total") or 0)
        tax = int((session.get("total_details") or {}).get("amount_tax") or 0)
        refunded = int(charge.get("amount_refunded") or 0)
        fee_complete = (
            isinstance(balance, dict)
            and balance.get("currency") == "usd"
            and balance.get("fee") is not None
            and balance.get("net") is not None
        )
        order_complete = (
            currency == "usd"
            and bool(payment_intent_id)
            and fee_complete
            and not charge.get("disputed")
            and refunded == 0
            and len(refund_balances) == len(refunds)
        )
        facts_complete = facts_complete and order_complete

        stripe_fee = int(balance.get("fee") or 0) if fee_complete else 0
        stripe_net = int(balance.get("net") or 0) if fee_complete else 0
        if refunds:
            stripe_net += sum(int(item.get("net") or 0) for item in refund_balances)
        contribution = stripe_net - tax
        if not fee_complete:
            # Conservative fallback to Stripe's standard domestic card price.
            stripe_fee = round(amount_total * 0.029) + 30
            contribution = amount_total - tax - stripe_fee - refunded

        orders.append({
            "session_id": session.get("id"),
            "sku": metadata.get("printableSku"),
            "created": datetime.fromtimestamp(
                int(session.get("created") or 0), tz=timezone.utc,
            ).isoformat(timespec="seconds"),
            "product_revenue_usd": _usd(amount_total - tax),
            "sales_tax_usd": _usd(tax),
            "stripe_fee_usd": _usd(stripe_fee),
            "refunds_usd": _usd(refunded),
            "net_contribution_usd": _usd(contribution),
            "facts_complete": order_complete,
        })

    gross = round(sum(item["product_revenue_usd"] for item in orders), 2)
    fees = round(sum(item["stripe_fee_usd"] for item in orders), 2)
    tax = round(sum(item["sales_tax_usd"] for item in orders), 2)
    refunds = round(sum(item["refunds_usd"] for item in orders), 2)
    contribution = round(sum(item["net_contribution_usd"] for item in orders), 2)
    return {
        "period_days": days,
        "orders": len(orders),
        "gross_product_revenue_usd": gross,
        "sales_tax_collected_usd": tax,
        "actual_stripe_fees_usd": fees,
        "refunds_usd": refunds,
        "known_cogs_usd": 0.0,
        "net_contribution_usd": contribution,
        "facts_complete": facts_complete,
        "profit_verified": facts_complete and contribution > 0,
        "orders_detail": orders,
    }


def collect_stripe_printable_revenue(
    secret_key: str,
    days: int = 30,
) -> dict[str, Any]:
    """Read paid live Checkout sessions and exact Stripe fee facts."""
    if not secret_key.startswith("sk_live_"):
        raise ValueError("A live Stripe secret key is required")
    cutoff = int(
        (datetime.now(timezone.utc) - timedelta(days=days)).timestamp()
    )
    headers = {"Authorization": f"Bearer {secret_key}"}
    sessions: list[dict[str, Any]] = []
    params: dict[str, Any] = {
        "limit": 100,
        "status": "complete",
        "created[gte]": cutoff,
    }

    with httpx.Client(timeout=30, headers=headers) as client:
        while True:
            response = client.get(f"{STRIPE_API}/checkout/sessions", params=params)
            response.raise_for_status()
            page = response.json()
            sessions.extend(page.get("data", []))
            if not page.get("has_more") or not page.get("data"):
                break
            params["starting_after"] = page["data"][-1]["id"]

        printable = [
            session for session in sessions
            if session.get("livemode")
            and (session.get("metadata") or {}).get("orderType") == "printable"
            and session.get("payment_status") == "paid"
        ]
        payment_intents = {}
        for session in printable:
            payment_intent_id = session.get("payment_intent")
            if not payment_intent_id:
                continue
            response = client.get(
                f"{STRIPE_API}/payment_intents/{payment_intent_id}",
                params=[
                    ("expand[]", "latest_charge.balance_transaction"),
                    (
                        "expand[]",
                        "latest_charge.refunds.data.balance_transaction",
                    ),
                ],
            )
            response.raise_for_status()
            payment_intents[str(payment_intent_id)] = response.json()

    return summarize_printable_orders(printable, payment_intents, days=days)


def combine_revenue_reports(
    etsy: dict[str, Any],
    stripe: dict[str, Any],
) -> dict[str, Any]:
    """Combine marketplace and direct facts without double-counting spend."""
    etsy_contribution = float(etsy.get("estimated_contribution_usd") or 0)
    stripe_contribution = float(stripe.get("net_contribution_usd") or 0)
    contribution = round(etsy_contribution + stripe_contribution, 2)
    facts_complete = bool(
        etsy.get("facts_complete") and stripe.get("facts_complete")
    )
    profit_verified = facts_complete and contribution > 0
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "period_days": int(etsy.get("period_days") or stripe.get("period_days") or 30),
        "orders": {
            "etsy": int(etsy.get("orders") or 0),
            "direct_printables": int(stripe.get("orders") or 0),
            "total": int(etsy.get("orders") or 0) + int(stripe.get("orders") or 0),
        },
        "gross_revenue_usd": round(
            float(etsy.get("gross_revenue_usd") or 0)
            + float(stripe.get("gross_product_revenue_usd") or 0),
            2,
        ),
        "net_contribution_usd": contribution,
        "facts_complete": facts_complete,
        "profit_verified": profit_verified,
        "verified_profitable_revenue_usd": contribution if profit_verified else 0.0,
        "monthly_target_usd": 500.0,
        "target_progress_pct": round(max(contribution, 0) / 500 * 100, 1),
        "goal_achieved": profit_verified and contribution >= 500,
        "budget_committed_usd": etsy.get("budget_committed_usd"),
        "budget_remaining_usd": etsy.get("budget_remaining_usd"),
        "channels": {"etsy": etsy, "direct_printables": stripe},
    }
