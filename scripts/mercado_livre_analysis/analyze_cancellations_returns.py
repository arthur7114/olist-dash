#!/usr/bin/env python3
"""Extrai Claims/Returns e analisa cancelamentos/devoluções de jan–jul/2026."""

from __future__ import annotations

import argparse
import csv
import json
import os
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq
from PIL import Image, ImageDraw, ImageFont

from enhance_executive_report import AMBER, GRAY, GREEN, NAVY, RED, TEAL, line_chart
from run_analysis import DataQuality, MeliApi, Pipeline, num


MONTHS = [f"2026-{month:02d}" for month in range(1, 8)]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    columns = sorted({key for row in rows for key in row})
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def parsed(value: str | None) -> Any:
    try:
        return json.loads(value or "null")
    except json.JSONDecodeError:
        return None


def classify_cancel(order: dict[str, str], claims: list[dict[str, Any]]) -> str:
    detail = parsed(order.get("cancel_detail")) or {}
    claim_types = {str(claim.get("type") or "") for claim in claims}
    requested_by = str(detail.get("requested_by") or "").lower()
    group = str(detail.get("group") or "").lower()
    code = str(detail.get("code") or "").lower()
    if "cancel_sale" in claim_types or requested_by == "seller":
        return "seller"
    if "cancel_purchase" in claim_types or requested_by == "buyer":
        return "buyer"
    if group == "shipment" or "shipment" in code or "not_delivered" in code:
        return "logistics"
    if group in {"mediations", "fraud"} or requested_by in {"meli", "mediator"}:
        return "mercado_livre_or_mediation"
    return "other_or_unidentified"


def return_candidate(claim: dict[str, Any]) -> bool:
    text = json.dumps({"type": claim.get("type"), "reason_id": claim.get("reason_id"), "resolution": claim.get("resolution")}, ensure_ascii=False).lower()
    return "return" in text or "devol" in text


def bar_chart(path: Path, title: str, labels: list[str], values: list[float], color: str = TEAL) -> None:
    image = Image.new("RGB", (1200, 620), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    draw.text((44, 30), title, fill=NAVY, font=font)
    maximum = max(values, default=0) or 1
    left, right, bottom = 90, 1150, 520
    width = max(36, int((right - left) / max(len(values), 1) * 0.65))
    for index, (label, value) in enumerate(zip(labels, values)):
        x = left + index * (right - left) / max(len(values), 1) + 18
        height = value / maximum * 390
        draw.rectangle((x, bottom - height, x + width, bottom), fill=color)
        draw.text((x, bottom - height - 20), f"{value:,.0f}", fill=NAVY, font=font)
        draw.text((x, 545), label[:18], fill=GRAY, font=font)
    draw.line((left, bottom, right, bottom), fill="#CBD5E1", width=2)
    image.save(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--snapshot-date", default="2026-08-01")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    processed = root / "data/processed"
    raw = root / "data/raw"
    report_dir = root / "report"
    charts_dir = report_dir / "charts"
    charts_dir.mkdir(parents=True, exist_ok=True)

    orders = read_csv(processed / "fact_orders.csv")
    order_items = read_csv(processed / "fact_order_items.csv")
    shipments = read_csv(processed / "fact_shipments.csv")
    pipeline = Pipeline(root, date.fromisoformat(args.snapshot_date), with_ads=False, with_billing=False)
    api = MeliApi(pipeline.access_token(), raw, DataQuality())

    def fetch_claims(order_id: str) -> tuple[str, list[dict[str, Any]], str | None]:
        cached = api.load_raw("claims_by_order", order_id)
        if cached is None:
            try:
                cached = api.get("/post-purchase/v1/claims/search", {"order_id": order_id})
                api.save_raw("claims_by_order", order_id, cached)
            except RuntimeError as exc:
                return order_id, [], str(exc)
        return order_id, cached.get("data", []) if isinstance(cached, dict) else [], None

    claims_by_order: dict[str, list[dict[str, Any]]] = defaultdict(list)
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fetch_claims, order["order_id"]) for order in orders]
        for index, future in enumerate(as_completed(futures), 1):
            order_id, claims, error = future.result()
            claims_by_order[order_id].extend(claims)
            if error:
                errors.append(error)
            if index % 250 == 0:
                print(f"Claims consultados: {index}/{len(orders)}", flush=True)

    fact_claims: list[dict[str, Any]] = []
    for order_id, claims in claims_by_order.items():
        for claim in claims:
            resolution = claim.get("resolution") or {}
            fact_claims.append({
                "claim_id": str(claim.get("id") or ""), "order_id": order_id,
                "type": claim.get("type"), "stage": claim.get("stage"), "status": claim.get("status"),
                "reason_id": claim.get("reason_id"), "quantity_type": claim.get("quantity_type"),
                "date_created": claim.get("date_created"), "last_updated": claim.get("last_updated"),
                "resolution_reason": resolution.get("reason"), "resolution_date": resolution.get("date_created"),
                "resolution_closed_by": resolution.get("closed_by"),
            })

    candidate_claims = [(row["order_id"], claim) for row in orders for claim in claims_by_order[row["order_id"]] if return_candidate(claim)]

    def fetch_return(order_id: str, claim: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
        claim_id = str(claim.get("id"))
        cached = api.load_raw("returns", claim_id)
        if cached is None:
            try:
                cached = api.get(f"/post-purchase/v2/claims/{claim_id}/returns")
                api.save_raw("returns", claim_id, cached)
            except RuntimeError as exc:
                detail = str(exc)
                if "(404)" in detail:
                    api.save_raw("returns", claim_id, {"available": False})
                    return None, None
                return None, detail
        if not cached or cached.get("available") is False:
            return None, None
        cost_payload = api.load_raw("return_costs", claim_id)
        if cost_payload is None:
            try:
                cost_payload = api.get(f"/post-purchase/v1/claims/{claim_id}/charges/return-cost")
                api.save_raw("return_costs", claim_id, cost_payload)
            except RuntimeError as exc:
                if "(404)" not in str(exc):
                    return None, str(exc)
                cost_payload = {}
        shipments_payload = cached.get("shipments") or []
        first = shipments_payload[0] if shipments_payload else {}
        destination = first.get("destination") or {}
        return {
            "return_id": str(cached.get("id") or ""), "claim_id": claim_id, "order_id": order_id,
            "claim_date": claim.get("date_created"), "last_updated": cached.get("last_updated"),
            "return_type": cached.get("type"), "return_subtype": cached.get("subtype"), "status": first.get("status"),
            "return_shipment_id": first.get("shipment_id"), "destination": destination.get("name"),
            "return_shipping_cost": num((cost_payload or {}).get("amount")), "currency_id": (cost_payload or {}).get("currency_id"),
        }, None

    fact_returns: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fetch_return, order_id, claim) for order_id, claim in candidate_claims]
        for future in as_completed(futures):
            result, error = future.result()
            if result:
                fact_returns.append(result)
            if error:
                errors.append(error)

    write_csv(processed / "fact_claims.csv", fact_claims)
    write_csv(processed / "fact_returns.csv", fact_returns)
    if fact_claims:
        pq.write_table(pa.Table.from_pylist(fact_claims), processed / "fact_claims.parquet")
    if fact_returns:
        pq.write_table(pa.Table.from_pylist(fact_returns), processed / "fact_returns.parquet")

    return_order_ids = {row["order_id"] for row in fact_returns}
    completed_return_order_ids = {row["order_id"] for row in fact_returns if row.get("status") == "delivered"}
    claim_return_order_ids = {row["order_id"] for row in fact_claims if "return" in str(row.get("type") or "").lower() or "return" in str(row.get("resolution_reason") or "").lower()}
    commercial_return_ids = return_order_ids | claim_return_order_ids
    returned_shipments: dict[str, dict[str, Any]] = {}
    for shipment in shipments:
        if "returned" in str(shipment.get("substatus") or ""):
            returned_shipments[shipment["order_id"]] = shipment

    monthly: list[dict[str, Any]] = []
    cancellation_causes = Counter()
    for month in MONTHS:
        cohort = [order for order in orders if str(order.get("date_created"))[:7] == month]
        cancelled = [order for order in cohort if order.get("status") == "cancelled"]
        eligible = [order for order in cohort if order.get("status") in {"paid", "confirmed"}]
        causes = Counter(classify_cancel(order, claims_by_order[order["order_id"]]) for order in cancelled)
        cancellation_causes.update(causes)
        commercial_returns = [order for order in cohort if order["order_id"] in commercial_return_ids]
        completed_returns = [order for order in cohort if order["order_id"] in completed_return_order_ids]
        logistics_returns = [order for order in cohort if order["order_id"] in returned_shipments and order["order_id"] not in commercial_return_ids]
        partial_refunds = [order for order in cohort if order.get("status") == "partially_refunded"]
        monthly.append({
            "month": month, "orders_created": len(cohort), "eligible_sales": len(eligible),
            "cancelled_orders": len(cancelled), "cancellation_rate": len(cancelled) / len(cohort) if cohort else None,
            "cancelled_gross_value": sum(num(order.get("total_amount")) for order in cancelled),
            "buyer_cancellations": causes["buyer"], "seller_cancellations": causes["seller"],
            "logistics_cancellations": causes["logistics"], "mediation_cancellations": causes["mercado_livre_or_mediation"],
            "other_cancellations": causes["other_or_unidentified"],
            "commercial_returns": len(commercial_returns),
            "return_rate_on_eligible_sales": len(commercial_returns) / len(eligible) if eligible else None,
            "completed_returns": len(completed_returns),
            "completed_return_rate_on_eligible_sales": len(completed_returns) / len(eligible) if eligible else None,
            "returned_gross_value": sum(num(order.get("total_amount")) for order in commercial_returns),
            "logistics_returns_to_sender": len(logistics_returns), "partial_refunds": len(partial_refunds),
        })

    item_by_order: dict[str, list[dict[str, str]]] = defaultdict(list)
    for item in order_items:
        item_by_order[item["order_id"]].append(item)
    cancelled_ids = {order["order_id"] for order in orders if order.get("status") == "cancelled"}
    order_status = {order["order_id"]: order.get("status") for order in orders}
    product_stats: dict[str, dict[str, Any]] = defaultdict(lambda: {"all_orders": set(), "eligible_orders": set(), "cancelled_orders": set(), "returned_orders": set(), "cancelled_value": 0.0, "returned_value": 0.0, "title": ""})
    for order_id, items_for_order in item_by_order.items():
        for item in items_for_order:
            key = item.get("product_key") or item.get("seller_sku") or item.get("item_id")
            stats = product_stats[key]
            stats["title"] = item.get("title") or key
            stats["all_orders"].add(order_id)
            if order_status.get(order_id) in {"paid", "confirmed"}:
                stats["eligible_orders"].add(order_id)
            if order_id in cancelled_ids:
                stats["cancelled_orders"].add(order_id)
                stats["cancelled_value"] += num(item.get("gross_revenue"))
            if order_id in commercial_return_ids:
                stats["returned_orders"].add(order_id)
                stats["returned_value"] += num(item.get("gross_revenue"))
    products = [{"product_key": key, "title": value["title"], "orders_created": len(value["all_orders"]), "eligible_sales": len(value["eligible_orders"]), "cancelled_orders": len(value["cancelled_orders"]), "cancellation_rate": len(value["cancelled_orders"]) / len(value["all_orders"]) if value["all_orders"] else None, "commercial_returns": len(value["returned_orders"]), "return_rate_on_eligible_sales": len(value["returned_orders"]) / len(value["eligible_orders"]) if value["eligible_orders"] else None, "cancelled_value": value["cancelled_value"], "returned_value": value["returned_value"]} for key, value in product_stats.items()]
    products.sort(key=lambda row: (row["cancelled_orders"], row["commercial_returns"], row["cancelled_value"]), reverse=True)

    total_orders = sum(row["orders_created"] for row in monthly)
    total_cancelled = sum(row["cancelled_orders"] for row in monthly)
    total_eligible = sum(row["eligible_sales"] for row in monthly)
    total_returns = len(commercial_return_ids)
    summary = {
        "period": "2026-01-01/2026-07-31", "definition": {
            "cancellation_rate": "pedidos com status cancelled / todos os pedidos criados no mês",
            "return_rate": "pedidos da coorte mensal com processo identificado em Claims/Returns / vendas pagas da coorte; o status entregue é mostrado separadamente",
            "logistics_return": "envio original retornado ao remetente sem devolução comercial confirmada; apresentado separadamente",
        },
        "overall": {
            "orders_created": total_orders, "eligible_sales": total_eligible, "cancelled_orders": total_cancelled,
            "cancellation_rate": total_cancelled / total_orders if total_orders else None,
            "commercial_returns": total_returns, "return_rate_on_eligible_sales": total_returns / total_eligible if total_eligible else None,
            "completed_returns": len(completed_return_order_ids), "completed_return_rate_on_eligible_sales": len(completed_return_order_ids) / total_eligible if total_eligible else None,
            "returns_in_transit_or_other_status": total_returns - len(completed_return_order_ids),
            "return_shipping_cost": sum(num(row.get("return_shipping_cost")) for row in fact_returns),
            "logistics_returns_to_sender": len(set(returned_shipments) - commercial_return_ids),
            "partial_refunds": sum(row["partial_refunds"] for row in monthly),
            "cancelled_gross_value": sum(row["cancelled_gross_value"] for row in monthly),
            "returned_gross_value": sum(row["returned_gross_value"] for row in monthly),
            "claims_found": len(fact_claims), "returns_found": len(fact_returns), "claim_query_errors": len(errors),
        },
        "monthly": monthly,
        "cancellation_causes": dict(cancellation_causes),
        "top_products": products[:30],
        "limitations": [
            "Valor cancelado é o valor bruto potencial do pedido, não perda contábil realizada.",
            "Taxa de devolução usa coorte pelo mês de criação do pedido; a devolução pode ter sido aberta posteriormente.",
            "A coorte de julho está censurada à direita no snapshot de 01/08/2026 e sua taxa de devolução ainda não está madura.",
            "Retornos logísticos ao remetente são separados de devoluções comerciais do comprador.",
        ],
    }
    (report_dir / "cancellations_returns.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_csv(processed / "fact_cancellations_returns_monthly.csv", monthly)
    pq.write_table(pa.Table.from_pylist(monthly), processed / "fact_cancellations_returns_monthly.parquet")

    labels = [row["month"] for row in monthly]
    line_chart(charts_dir / "cancellations_returns_monthly.png", "Cancelamentos e devoluções por mês", labels, [
        ("Cancelamentos", [row["cancelled_orders"] for row in monthly], RED),
        ("Devoluções", [row["commercial_returns"] for row in monthly], TEAL),
        ("Retorno logístico", [row["logistics_returns_to_sender"] for row in monthly], AMBER),
    ])
    line_chart(charts_dir / "cancellation_return_rates.png", "Taxas mensais de cancelamento e devolução", labels, [
        ("Cancelamento", [100 * (row["cancellation_rate"] or 0) for row in monthly], RED),
        ("Devolução", [100 * (row["return_rate_on_eligible_sales"] or 0) for row in monthly], TEAL),
    ], "Valores em pontos percentuais")
    cause_labels = ["Comprador", "Vendedor", "Logística", "Mediação/ML", "Outros"]
    cause_values = [cancellation_causes[key] for key in ("buyer", "seller", "logistics", "mercado_livre_or_mediation", "other_or_unidentified")]
    bar_chart(charts_dir / "cancellation_causes.png", "Cancelamentos por origem identificada", cause_labels, cause_values, RED)
    bar_chart(charts_dir / "top_cancelled_products.png", "Produtos com mais pedidos cancelados", [row["product_key"] for row in products[:12]], [row["cancelled_orders"] for row in products[:12]], AMBER)
    quality_path = report_dir / "data_quality.md"
    quality_text = quality_path.read_text(encoding="utf-8") if quality_path.exists() else "# Qualidade dos dados\n"
    marker = "## Cancelamentos e devoluções"
    if marker in quality_text:
        quality_text = quality_text.split(marker, 1)[0].rstrip() + "\n"
    quality_text += f"""

## Cancelamentos e devoluções

- Pedidos consultados em Claims: {len(orders):,}.
- Claims encontrados: {len(fact_claims):,}.
- Processos de devolução encontrados: {len(fact_returns):,}.
- Erros definitivos de consulta: {len(errors):,}.
- Retornos logísticos ao remetente foram separados de devoluções comerciais.
- A taxa de devolução usa coorte pelo mês de criação do pedido; a abertura pode ocorrer posteriormente.
"""
    quality_path.write_text(quality_text, encoding="utf-8")
    print(f"Análise concluída: {total_cancelled} cancelamentos, {total_returns} devoluções comerciais, {len(fact_claims)} claims.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
