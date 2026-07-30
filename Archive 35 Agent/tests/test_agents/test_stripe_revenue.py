from src.agents.stripe_revenue import (
    combine_revenue_reports,
    summarize_printable_orders,
)


def paid_session(amount=900, tax=0, payment_intent="pi_1"):
    return {
        "id": "cs_live_1",
        "livemode": True,
        "status": "complete",
        "payment_status": "paid",
        "payment_intent": payment_intent,
        "amount_total": amount + tax,
        "currency": "usd",
        "created": 1785412800,
        "total_details": {"amount_tax": tax},
        "metadata": {
            "orderType": "printable",
            "printableSku": "A35-DIG-ANT-0001",
        },
    }


def payment_intent(total=900, fee=56):
    return {
        "latest_charge": {
            "amount_refunded": 0,
            "disputed": False,
            "balance_transaction": {
                "currency": "usd",
                "fee": fee,
                "net": total - fee,
            },
            "refunds": {"data": []},
        },
    }


def test_exact_stripe_fee_and_tax_are_removed_from_contribution():
    report = summarize_printable_orders(
        [paid_session(amount=900, tax=74)],
        {"pi_1": payment_intent(total=974, fee=58)},
    )
    assert report["orders"] == 1
    assert report["gross_product_revenue_usd"] == 9
    assert report["sales_tax_collected_usd"] == 0.74
    assert report["actual_stripe_fees_usd"] == 0.58
    assert report["net_contribution_usd"] == 8.42
    assert report["facts_complete"] is True
    assert report["profit_verified"] is True
    assert set(report["orders_detail"][0]) == {
        "session_id",
        "sku",
        "created",
        "product_revenue_usd",
        "sales_tax_usd",
        "stripe_fee_usd",
        "refunds_usd",
        "net_contribution_usd",
        "facts_complete",
    }


def test_unpaid_expired_and_non_printable_sessions_are_excluded():
    unpaid = paid_session()
    unpaid["payment_status"] = "unpaid"
    expired = paid_session()
    expired["status"] = "expired"
    physical = paid_session()
    physical["metadata"]["orderType"] = "print"
    report = summarize_printable_orders([unpaid, expired, physical], {})
    assert report["orders"] == 0
    assert report["facts_complete"] is True


def test_missing_fee_fact_is_conservative_and_not_verified():
    report = summarize_printable_orders([paid_session()], {"pi_1": {}})
    assert report["orders"] == 1
    assert report["actual_stripe_fees_usd"] == 0.56
    assert report["net_contribution_usd"] == 8.44
    assert report["facts_complete"] is False
    assert report["profit_verified"] is False


def test_refund_or_dispute_prevents_verified_profit():
    intent = payment_intent()
    intent["latest_charge"]["amount_refunded"] = 900
    intent["latest_charge"]["disputed"] = True
    intent["latest_charge"]["refunds"]["data"] = [{
        "balance_transaction": {"currency": "usd", "net": -900},
    }]
    report = summarize_printable_orders([paid_session()], {"pi_1": intent})
    assert report["facts_complete"] is False
    assert report["profit_verified"] is False
    assert report["refunds_usd"] == 9


def test_combined_report_tracks_verified_progress_to_five_hundred():
    etsy = {
        "period_days": 30,
        "orders": 1,
        "gross_revenue_usd": 12,
        "estimated_contribution_usd": 8.45,
        "facts_complete": True,
        "budget_committed_usd": 24.4,
        "budget_remaining_usd": 25.6,
    }
    stripe = {
        "period_days": 30,
        "orders": 60,
        "gross_product_revenue_usd": 540,
        "net_contribution_usd": 505,
        "facts_complete": True,
    }
    report = combine_revenue_reports(etsy, stripe)
    assert report["orders"]["total"] == 61
    assert report["net_contribution_usd"] == 513.45
    assert report["verified_profitable_revenue_usd"] == 513.45
    assert report["target_progress_pct"] == 102.7
    assert report["goal_achieved"] is True
