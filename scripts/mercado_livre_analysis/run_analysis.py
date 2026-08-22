#!/usr/bin/env python3
"""Extrai e analisa uma conta Mercado Livre em modo estritamente somente leitura.

O programa preserva JSONs brutos sem PII, normaliza-os e gera o relatório HTML,
CSVs, Parquets, gráficos PNG e o dataset consumido pelo gerador de XLSX.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
import os
import re
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


API_URL = "https://api.mercadolibre.com"
TZ_OFFSET = "-03:00"  # America/Fortaleza não adota horário de verão.
START = date(2026, 1, 1)
END = date(2026, 7, 31)
# A API de Product Ads aceita no máximo 90 dias inclusivos por consulta.
ADS_START = END - timedelta(days=89)
ADS_METRICS = ",".join(
    [
        "clicks", "prints", "ctr", "cost", "cpc", "acos", "organic_units_quantity",
        "organic_units_amount", "organic_items_quantity", "direct_items_quantity",
        "indirect_items_quantity", "advertising_items_quantity", "cvr", "roas", "sov",
        "direct_units_quantity", "indirect_units_quantity", "units_quantity", "direct_amount",
        "indirect_amount", "total_amount",
    ]
)
PII_KEYS = re.compile(r"(buyer|first_name|last_name|email|phone|address|receiver_address|receiver|identification|user_id)", re.I)


def num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def iso_day(value: Any) -> str | None:
    if not value:
        return None
    text = str(value)
    return text[:10] if len(text) >= 10 else None


def month_range() -> list[str]:
    return [f"2026-{month:02d}" for month in range(1, 8)]


def safe_div(n: float, d: float) -> float | None:
    return n / d if d else None


def safe_json(value: Any) -> Any:
    """Remove informações pessoais antes de persistir qualquer resposta crua."""
    if isinstance(value, dict):
        return {k: safe_json(v) for k, v in value.items() if not PII_KEYS.search(str(k))}
    if isinstance(value, list):
        return [safe_json(v) for v in value]
    return value


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, Any]], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


@dataclass
class DataQuality:
    issues: list[dict[str, Any]] = field(default_factory=list)

    def add(self, severity: str, check: str, count: int, detail: str) -> None:
        for issue in self.issues:
            if issue["severity"] == severity and issue["check"] == check:
                issue["count"] += count
                return
        self.issues.append({"severity": severity, "check": check, "count": count, "detail": detail})

    @property
    def passed(self) -> bool:
        return not any(x["severity"] == "error" and x["count"] for x in self.issues)


class MeliApi:
    def __init__(self, access_token: str, raw_dir: Path, quality: DataQuality) -> None:
        self.access_token = access_token
        self.raw_dir = raw_dir
        self.quality = quality

    def get(self, path: str, params: dict[str, Any] | None = None, *, headers: dict[str, str] | None = None) -> Any:
        query = urlencode({k: v for k, v in (params or {}).items() if v is not None}, doseq=True)
        url = f"{API_URL}{path}" + (f"?{query}" if query else "")
        request_headers = {"Authorization": f"Bearer {self.access_token}", "Accept": "application/json"}
        request_headers.update(headers or {})
        for attempt in range(5):
            try:
                req = Request(url, headers=request_headers, method="GET")
                with urlopen(req, timeout=60) as response:
                    body = response.read().decode("utf-8")
                    payload = json.loads(body)
                    if response.status == 206:
                        self.quality.add("warning", "Resposta parcial HTTP 206", 1, f"{path}: {response.headers.get('X-Content-Missing', 'campos não informados')}")
                    return payload
            except HTTPError as exc:
                if exc.code in (429, 500, 502, 503, 504) and attempt < 4:
                    time.sleep(min(30, 2 ** attempt))
                    continue
                message = exc.read().decode("utf-8", "replace")[:500]
                raise RuntimeError(f"GET {path} falhou ({exc.code}): {message}") from exc
            except URLError as exc:
                if attempt < 4:
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f"Falha de rede em {path}: {exc.reason}") from exc
        raise AssertionError("unreachable")

    def save_raw(self, endpoint: str, identity: str, payload: Any) -> None:
        target = self.raw_dir / endpoint / f"{identity}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(safe_json(payload), ensure_ascii=False, indent=2), encoding="utf-8")

    def load_raw(self, endpoint: str, identity: str) -> Any | None:
        target = self.raw_dir / endpoint / f"{identity}.json"
        try:
            return json.loads(target.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def paged(self, path: str, params: dict[str, Any], *, result_key: str = "results", limit: int = 50) -> list[Any]:
        output: list[Any] = []
        offset = 0
        while True:
            page = self.get(path, {**params, "limit": limit, "offset": offset})
            rows = page.get(result_key, []) if isinstance(page, dict) else []
            output.extend(rows)
            paging = page.get("paging", {}) if isinstance(page, dict) else {}
            total = int(paging.get("total", len(output)))
            if not rows or offset + len(rows) >= total:
                return output
            offset += len(rows)


class Pipeline:
    def __init__(self, root: Path, snapshot_date: date, with_ads: bool, with_billing: bool) -> None:
        self.root = root
        self.snapshot_date = snapshot_date
        self.with_ads = with_ads
        self.with_billing = with_billing
        self.raw_dir = root / "data/raw"
        self.processed_dir = root / "data/processed"
        self.report_dir = root / "report"
        self.quality = DataQuality()
        self.tables: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.limits: list[str] = []
        self.partial_source = False
        self.available_months = set(month_range())
        self.complete_months = set(month_range())

    def access_token(self) -> str:
        token = os.environ.get("ML_ACCESS_TOKEN")
        if token:
            return token
        refresh = os.environ.get("ML_REFRESH_TOKEN")
        client_id, secret = os.environ.get("ML_CLIENT_ID"), os.environ.get("ML_CLIENT_SECRET")
        if not (client_id and secret):
            raise RuntimeError("Defina ML_ACCESS_TOKEN ou ML_CLIENT_ID e ML_CLIENT_SECRET.")
        token_params = {"grant_type": "client_credentials", "client_id": client_id, "client_secret": secret}
        if refresh:
            token_params = {"grant_type": "refresh_token", "client_id": client_id, "client_secret": secret, "refresh_token": refresh}
        data = urlencode(token_params).encode()
        req = Request(f"{API_URL}/oauth/token", data=data, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
        try:
            with urlopen(req, timeout=60) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            raise RuntimeError(f"Falha ao renovar token ({exc.code}). Não foi possível continuar.") from exc
        token = payload.get("access_token")
        if not token:
            raise RuntimeError("Refresh não devolveu access_token.")
        # O refresh token é rotativo. Ele permanece apenas na memória; o operador deve
        # persistir o token substituto no gerenciador de segredos antes da próxima execução.
        if refresh and payload.get("refresh_token"):
            self.limits.append("Token renovado apenas em memória; atualize ML_REFRESH_TOKEN no seu gerenciador de segredos antes da próxima execução.")
        return str(token)

    def extract(self) -> None:
        api = MeliApi(self.access_token(), self.raw_dir, self.quality)
        me = api.get("/users/me")
        api.save_raw("users", "me", me)
        seller_id = str(me["id"])
        site_id = str(me.get("site_id") or "MLB")
        self.tables["snapshot_reputation"] = [
            {
                "snapshot_date": self.snapshot_date.isoformat(), "seller_id": seller_id,
                "nickname": me.get("nickname"), "seller_reputation": json.dumps(me.get("seller_reputation", {}), ensure_ascii=False),
                "level_id": (me.get("seller_reputation") or {}).get("level_id"),
                "power_seller_status": (me.get("seller_reputation") or {}).get("power_seller_status"),
                "transactions": json.dumps((me.get("seller_reputation") or {}).get("transactions", {}), ensure_ascii=False),
            }
        ]
        self.extract_orders(api, seller_id)
        self.extract_items(api, seller_id)
        self.extract_shipments_and_discounts(api)
        self.extract_visits(api)
        if self.with_billing:
            self.extract_billing(api)
        if self.with_ads:
            self.extract_ads(api, site_id)
        self.load_manual_inputs()

    def extract_orders(self, api: MeliApi, seller_id: str) -> None:
        seen: set[str] = set()
        for month in range(1, 8):
            start = date(2026, month, 1)
            stop = date(2026, month + 1, 1) - timedelta(days=1) if month < 12 else date(2026, 12, 31)
            rows = api.paged(
                "/orders/search",
                {"seller": seller_id, "order.date_created.from": f"{start}T00:00:00.000{TZ_OFFSET}", "order.date_created.to": f"{stop}T23:00:00.000{TZ_OFFSET}", "sort": "date_asc"},
            )
            for order in rows:
                order_id = str(order.get("id"))
                if not order_id or order_id in seen:
                    continue
                seen.add(order_id)
                api.save_raw("orders", order_id, order)
                self.tables["_orders_raw"].append(order)

    def extract_items(self, api: MeliApi, seller_id: str) -> None:
        try:
            ids = api.paged(f"/users/{seller_id}/items/search", {}, result_key="results", limit=100)
        except RuntimeError as exc:
            ids = []
            self.limits.append(f"Catálogo atual completo indisponível; análise de itens limitada aos anúncios presentes nos pedidos: {exc}")
        order_item_stubs: dict[str, dict[str, Any]] = {}
        for raw_order in self.tables["_orders_raw"]:
            for order_item in raw_order.get("order_items", []):
                item = order_item.get("item", {})
                if item.get("id"):
                    item_id = str(item["id"])
                    ids.append(item_id)
                    order_item_stubs.setdefault(item_id, {"id": item_id, "title": item.get("title"), "seller_custom_field": item.get("seller_sku"), "category_id": item.get("category_id"), "status": "unknown_from_order"})
        unique = sorted(set(map(str, ids)))
        for start in range(0, len(unique), 20):
            batch = unique[start : start + 20]
            try:
                payload = api.get("/items", {"ids": ",".join(batch)})
            except RuntimeError as exc:
                self.limits.append(f"Detalhes de anúncios bloqueados; foram usados os campos preservados nos pedidos: {exc}")
                self.tables["_items_raw"] = list(order_item_stubs.values())
                return
            for record in payload if isinstance(payload, list) else []:
                item = record.get("body") if record.get("code") == 200 else None
                if item:
                    api.save_raw("items", str(item.get("id")), item)
                    self.tables["_items_raw"].append(item)
                else:
                    self.quality.add("warning", "Item não obtido", 1, f"{record.get('resource', 'item desconhecido')}: HTTP {record.get('code')}")

    def extract_shipments_and_discounts(self, api: MeliApi) -> None:
        seen_shipments: set[str] = set()
        jobs: list[tuple[str, str | None]] = []
        for order in self.tables["_orders_raw"]:
            order_id = str(order.get("id"))
            shipping_id = str((order.get("shipping") or {}).get("id") or "")
            shipment_job = None
            if shipping_id and shipping_id not in seen_shipments:
                seen_shipments.add(shipping_id)
                shipment_job = shipping_id
            jobs.append((order_id, shipment_job))

        def fetch_job(job: tuple[str, str | None]) -> dict[str, Any]:
            order_id, shipping_id = job
            result: dict[str, Any] = {"order_id": order_id, "shipping_id": shipping_id, "errors": []}
            discounts = api.load_raw("order_discounts", order_id)
            if discounts is not None:
                result["discounts"] = discounts
            else:
                try:
                    discounts = api.get(f"/orders/{order_id}/discounts")
                    api.save_raw("order_discounts", order_id, discounts)
                    result["discounts"] = discounts
                except RuntimeError as exc:
                    detail = str(exc)
                    if "(404)" in detail and "discount_not_found" in detail:
                        # A ausência de desconto é um resultado comercial válido.
                        api.save_raw("order_discounts", order_id, [])
                        result["discounts"] = []
                    else:
                        result["errors"].append(("Descontos indisponíveis", detail))
            if shipping_id:
                shipment = api.load_raw("shipments", shipping_id)
                costs = api.load_raw("shipment_costs", shipping_id)
                if shipment is not None and costs is not None:
                    result["shipment"] = shipment
                    result["costs"] = costs
                else:
                    try:
                        shipment = api.get(f"/shipments/{shipping_id}")
                        costs = api.get(f"/shipments/{shipping_id}/costs", headers={"x-format-new": "true"})
                        api.save_raw("shipments", shipping_id, shipment)
                        api.save_raw("shipment_costs", shipping_id, costs)
                        result["shipment"] = shipment
                        result["costs"] = costs
                    except RuntimeError as exc:
                        result["errors"].append(("Envio indisponível", str(exc)))
            return result

        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(fetch_job, job) for job in jobs]
            for future in as_completed(futures):
                result = future.result()
                if "discounts" in result:
                    self.tables["_discounts_raw"].append({"order_id": result["order_id"], "payload": result["discounts"]})
                if "shipment" in result:
                    self.tables["_shipments_raw"].append({"shipping_id": result["shipping_id"], "shipment": result["shipment"], "costs": result["costs"]})
                for check, detail in result["errors"]:
                    self.quality.add("warning", check, 1, detail)

    def extract_visits(self, api: MeliApi) -> None:
        item_ids = sorted({str(x.get("id")) for x in self.tables["_items_raw"] if x.get("id")})
        def fetch_item(item_id: str) -> tuple[list[dict[str, Any]], list[str]]:
            rows: list[dict[str, Any]] = []
            errors: list[str] = []
            cursor = START
            while cursor <= END:
                end = min(cursor + timedelta(days=149), END)
                days = (end - cursor).days + 1
                identity = f"{item_id}_{cursor}_{end}"
                try:
                    payload = api.load_raw("visits", identity)
                    if payload is None:
                        payload = api.get(f"/items/{item_id}/visits/time_window", {"last": days, "unit": "day", "ending": end.isoformat()})
                        api.save_raw("visits", identity, payload)
                    for row in payload.get("results", []):
                        rows.append({"item_id": item_id, **row})
                except RuntimeError as exc:
                    errors.append(str(exc))
                    break
                cursor = end + timedelta(days=1)
            return rows, errors

        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(fetch_item, item_id) for item_id in item_ids]
            for future in as_completed(futures):
                rows, errors = future.result()
                self.tables["_visits_raw"].extend(rows)
                for detail in errors:
                    self.quality.add("warning", "Visitas indisponíveis", 1, detail)

    def extract_billing(self, api: MeliApi) -> None:
        try:
            periods = api.paged("/billing/integration/monthly/periods", {"group": "ML", "document_type": "BILL"}, limit=12)
        except RuntimeError as exc:
            self.limits.append(f"Faturamento detalhado indisponível: {exc}")
            return
        for period in periods:
            key = str(period.get("key") or period.get("date") or "")
            if key[:7] not in month_range():
                continue
            try:
                details = api.paged(f"/billing/integration/periods/key/{key}/group/ML/details", {"document_type": "BILL"}, limit=50)
                api.save_raw("billing", key, details)
                self.tables["_billing_raw"].extend(details)
            except RuntimeError as exc:
                self.limits.append(f"Faturamento {key} indisponível: {exc}")

    def extract_ads(self, api: MeliApi, site_id: str) -> None:
        # A API limita métricas a 90 dias. A janela válida é 01/05–31/07 para o snapshot 01/08.
        try:
            advertisers = api.get("/advertising/advertisers", {"product_id": "PADS"}, headers={"Api-Version": "1", "Content-Type": "application/json"})
        except RuntimeError as exc:
            self.limits.append(f"Product Ads indisponível: {exc}")
            return
        records = advertisers.get("advertisers", advertisers if isinstance(advertisers, list) else [])
        for advertiser in records:
            advertiser_id = advertiser.get("advertiser_id") or advertiser.get("id")
            advertiser_site = advertiser.get("site_id") or site_id
            if not advertiser_id:
                continue
            params = {"date_from": ADS_START.isoformat(), "date_to": END.isoformat(), "metrics": ADS_METRICS, "aggregation_type": "DAILY"}
            try:
                rows = api.paged(f"/advertising/{advertiser_site}/advertisers/{advertiser_id}/product_ads/ads/search", params, limit=50)
                api.save_raw("product_ads", f"{advertiser_site}_{advertiser_id}", rows)
                for row in rows:
                    self.tables["_ads_raw"].append({"advertiser_id": advertiser_id, "site_id": advertiser_site, **row})
            except RuntimeError as exc:
                self.limits.append(f"Product Ads do anunciante {advertiser_id} indisponível: {exc}")

    def load_manual_inputs(self) -> None:
        input_dir = self.root / "data/input"
        self.tables["fact_product_costs"] = read_csv(input_dir / "product_costs.csv")
        self.tables["fact_interventions"] = read_csv(input_dir / "interventions.csv")
        self.tables["_product_mapping"] = read_csv(input_dir / "product_mapping.csv")
        platinum_path = input_dir / "platinum_status.json"
        try:
            platinum = json.loads(platinum_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            platinum = {}
        self.tables["snapshot_platinum_status"] = [platinum]

    def load_dashboard_snapshot(self, snapshot_path: Path) -> None:
        """Normaliza o snapshot sanitizado do endpoint público do dashboard."""
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
        self.partial_source = True
        orders = payload.get("orders", [])
        if not orders:
            raise RuntimeError("O snapshot do dashboard não contém pedidos reais.")
        available_dates = sorted({str(x.get("data")) for x in orders if x.get("data")})
        if available_dates:
            first_available, last_available = date.fromisoformat(available_dates[0]), date.fromisoformat(available_dates[-1])
            self.available_months = {x[:7] for x in available_dates}
            self.complete_months = set()
            for month_key in month_range():
                year, month = map(int, month_key.split("-"))
                month_start = date(year, month, 1)
                month_end = (date(year + (month == 12), 1 if month == 12 else month + 1, 1) - timedelta(days=1))
                if first_available <= month_start and last_available >= month_end:
                    self.complete_months.add(month_key)
            self.limits.extend(
                [
                    "Fonte alternativa: endpoint somente leitura do dashboard/Olist, pois a conta Mercado Livre não possui access/refresh token disponível.",
                    f"A base Mercado Livre disponível cobre {available_dates[0]} a {available_dates[-1]}; meses/dias anteriores não devem ser interpretados como zero de vendas.",
                    "Reputação, visitas, Product Ads, billing detalhado, histórico de anúncios e gap Platinum não existem nesta fonte.",
                ]
            )
            self.quality.add("warning", "Cobertura parcial do período", 1, f"Dados disponíveis de {available_dates[0]} a {available_dates[-1]}.")
        for order in orders:
            order_id = str(order.get("id"))
            status = str(order.get("statusPagamento") or "")
            eligible = status.lower() == "pago"
            gross = num(order.get("valorVenda"))
            commission = num(order.get("taxaComissao"))
            shipping = num(order.get("valorFrete"))
            returns_loss = num(order.get("devolucao"))
            order_cost_total = num(order.get("custoTotal"))
            items = order.get("itens") or []
            if not items:
                quantity = max(1, int(num(order.get("quantidade"), 1)))
                items = [{"sku": order.get("sku"), "descricao": order.get("produto"), "quantidade": quantity, "valorUnitario": safe_div(gross, quantity) or 0, "custoUnitario": safe_div(num(order.get("custoTotal")), quantity) or 0}]
            item_gross_total = sum(num(x.get("valorUnitario")) * max(1, int(num(x.get("quantidade"), 1))) for x in items)
            self.tables["fact_orders"].append(
                {
                    "order_id": order_id, "pack_id": None, "date_created": f"{order.get('data')}T12:00:00{TZ_OFFSET}",
                    "date_closed": None, "last_updated": None, "status": status, "status_detail": None,
                    "total_amount": gross, "paid_amount": gross if eligible else 0, "currency_id": "BRL", "tags": "[]",
                    "shipping_id": None, "cancel_detail": None, "item_count": len(items),
                    "units": sum(max(1, int(num(x.get("quantidade"), 1))) for x in items),
                    "payment_approved": eligible, "is_cancelled_or_returned": not eligible,
                    "eligible_sale": eligible, "seller_shipping_cost": shipping, "returns_loss": returns_loss,
                    "source": "dashboard_readonly_api", "channel": order.get("canal"), "ml_cost_real": bool(order.get("custoMlReal")),
                }
            )
            for index, item in enumerate(items):
                quantity = max(1, int(num(item.get("quantidade"), 1)))
                observed_gross = num(item.get("valorUnitario")) * quantity
                share = observed_gross / item_gross_total if item_gross_total else 1 / len(items)
                allocated_gross = gross * share
                observed_unit_cost = num(item.get("custoUnitario"))
                allocated_cost = observed_unit_cost * quantity if observed_unit_cost > 0 else order_cost_total * share
                sku = str(item.get("sku") or order.get("sku") or f"sem-sku:{order_id}:{index}")
                title = item.get("descricao") or order.get("produto") or sku
                self.tables["fact_order_items"].append(
                    {
                        "order_id": order_id, "item_id": None, "variation_id": None, "seller_sku": sku,
                        "product_key": sku, "title": title, "category_id": None, "quantity": quantity,
                        "unit_price": safe_div(allocated_gross, quantity) or 0, "full_unit_price": safe_div(allocated_gross, quantity) or 0,
                        "sale_fee": commission * share, "listing_type_id": None, "condition": None,
                        "gross_revenue": allocated_gross, "discounts": 0, "commission": commission * share,
                        "eligible_sale": eligible, "order_created_date": order.get("data"),
                        "unit_product_cost_snapshot": (allocated_cost / quantity if allocated_cost > 0 else 0), "returns_loss": returns_loss * share,
                    }
                )
        product_rows: dict[str, dict[str, Any]] = {}
        for row in self.tables["fact_order_items"]:
            key = row["product_key"]
            product_rows.setdefault(key, {"product_key": key, "seller_sku": row["seller_sku"], "title": row["title"], "item_count": 0})["item_count"] += 1
        self.tables["dim_products"] = list(product_rows.values())
        self.tables["dim_items"] = []
        self.tables["fact_shipments"] = []
        self.tables["fact_financial_adjustments"] = []
        self.tables["fact_visits_daily"] = []
        self.tables["fact_ads_daily"] = []
        self.tables["snapshot_reputation"] = []
        self.load_manual_inputs()
        self.validate()

    def normalize(self) -> None:
        mapping = self.product_mapping()
        items_by_id = {str(x.get("id")): x for x in self.tables["_items_raw"]}
        shipment_by_id = {x["shipping_id"]: x for x in self.tables["_shipments_raw"]}
        for item_id, item in items_by_id.items():
            product_key = self.product_key(item.get("seller_custom_field"), item.get("user_product_id"), item.get("parent_item_id"), item_id, mapping)
            self.tables["dim_items"].append({
                "item_id": item_id, "parent_item_id": item.get("parent_item_id"), "user_product_id": item.get("user_product_id"),
                "seller_sku": item.get("seller_custom_field"), "product_key": product_key, "title": item.get("title"),
                "category_id": item.get("category_id"), "price": num(item.get("price")), "original_price": item.get("original_price"),
                "listing_type_id": item.get("listing_type_id"), "status": item.get("status"), "sub_status": json.dumps(item.get("sub_status", [])),
                "available_quantity": item.get("available_quantity"), "sold_quantity": item.get("sold_quantity"), "date_created": item.get("date_created"),
                "date_closed": item.get("date_closed"), "logistic_type": (item.get("shipping") or {}).get("logistic_type"),
                "free_shipping": (item.get("shipping") or {}).get("free_shipping"), "catalog_listing": item.get("catalog_listing"),
            })
        known_products: dict[str, dict[str, Any]] = {}
        for row in self.tables["dim_items"]:
            known_products.setdefault(row["product_key"], {"product_key": row["product_key"], "seller_sku": row["seller_sku"], "title": row["title"], "item_count": 0})["item_count"] += 1
        self.tables["dim_products"] = list(known_products.values())
        shipping_orders: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for order in self.tables["_orders_raw"]:
            shipping = str((order.get("shipping") or {}).get("id") or "")
            if shipping:
                shipping_orders[shipping].append(order)
        for order in self.tables["_orders_raw"]:
            order_id = str(order.get("id"))
            status = str(order.get("status") or "")
            tags = order.get("tags") or []
            shipping_id = str((order.get("shipping") or {}).get("id") or "") or None
            gross = sum(num(x.get("unit_price")) * num(x.get("quantity"), 1) for x in order.get("order_items", []))
            shipment_cost = 0.0
            if shipping_id and shipment_by_id.get(shipping_id):
                cost_payload = shipment_by_id[shipping_id]["costs"]
                total_cost = sum(num(x.get("cost")) for x in cost_payload.get("senders", []))
                denominator = sum(sum(num(i.get("unit_price")) * num(i.get("quantity"), 1) for i in each.get("order_items", [])) for each in shipping_orders[shipping_id])
                shipment_cost = total_cost * (gross / denominator) if denominator else total_cost
                shipment = shipment_by_id[shipping_id]["shipment"]
                self.tables["fact_shipments"].append({
                    "shipping_id": shipping_id, "order_id": order_id, "mode": shipment.get("mode"), "status": shipment.get("status"),
                    "substatus": json.dumps(shipment.get("substatus", [])), "logistic_type": shipment.get("logistic_type"),
                    "seller_cost_allocated": shipment_cost, "buyer_cost": num((cost_payload.get("receiver") or {}).get("cost")),
                    "seller_discounts": json.dumps((cost_payload.get("senders") or [{}])[0].get("discounts", [])),
                    "date_shipped": shipment.get("date_shipped"), "date_delivered": shipment.get("date_delivered"), "estimated_delivery": shipment.get("estimated_delivery_time", {}).get("date"),
                })
            eligible = status in {"paid", "confirmed"} and "cancelled" not in tags and "returned" not in tags
            self.tables["fact_orders"].append({
                "order_id": order_id, "pack_id": order.get("pack_id"), "date_created": order.get("date_created"), "date_closed": order.get("date_closed"),
                "last_updated": order.get("last_updated"), "status": status, "status_detail": order.get("status_detail"),
                "total_amount": num(order.get("total_amount"), gross), "paid_amount": sum(num(x.get("total_paid_amount")) for x in order.get("payments", [])),
                "currency_id": order.get("currency_id"), "tags": json.dumps(tags), "shipping_id": shipping_id,
                "cancel_detail": json.dumps(order.get("cancel_detail")), "item_count": len(order.get("order_items", [])),
                "units": sum(int(num(x.get("quantity"), 1)) for x in order.get("order_items", [])), "payment_approved": any(x.get("status") == "approved" for x in order.get("payments", [])),
                "is_cancelled_or_returned": not eligible, "eligible_sale": eligible, "seller_shipping_cost": shipment_cost,
            })
            for order_item in order.get("order_items", []):
                item = order_item.get("item", {})
                item_id = str(item.get("id") or "")
                dim = items_by_id.get(item_id, {})
                sku = item.get("seller_sku") or dim.get("seller_custom_field")
                pkey = self.product_key(sku, dim.get("user_product_id"), dim.get("parent_item_id"), item_id, mapping, item.get("variation_id"))
                quantity = int(num(order_item.get("quantity"), 1))
                unit_price = num(order_item.get("unit_price"))
                self.tables["fact_order_items"].append({
                    "order_id": order_id, "item_id": item_id, "variation_id": (item.get("variation_id") or ""), "seller_sku": sku,
                    "product_key": pkey, "title": item.get("title") or dim.get("title"), "category_id": dim.get("category_id"), "quantity": quantity,
                    "unit_price": unit_price, "full_unit_price": num(order_item.get("full_unit_price"), unit_price), "sale_fee": num(order_item.get("sale_fee")),
                    "listing_type_id": order_item.get("listing_type_id"), "condition": dim.get("condition"), "gross_revenue": unit_price * quantity,
                    "discounts": 0.0, "commission": num(order_item.get("sale_fee")) * quantity, "eligible_sale": eligible,
                    "order_created_date": iso_day(order.get("date_created")),
                })
        discounts_by_order = {x["order_id"]: x["payload"] for x in self.tables["_discounts_raw"]}
        for order_id, discounts in discounts_by_order.items():
            for adjustment in discounts if isinstance(discounts, list) else discounts.get("details", []) if isinstance(discounts, dict) else []:
                self.tables["fact_financial_adjustments"].append({"order_id": order_id, "source": "order_discounts", "type": adjustment.get("type"), "amount": num(adjustment.get("amount")), "payer": adjustment.get("payer"), "raw_label": json.dumps(safe_json(adjustment), ensure_ascii=False)})
        for row in self.tables["_visits_raw"]:
            self.tables["fact_visits_daily"].append({"date": iso_day(row.get("date")), "item_id": row.get("item_id"), "visits": int(num(row.get("total")))})
        for row in self.tables["_ads_raw"]:
            self.tables["fact_ads_daily"].append({"date": iso_day(row.get("date")), "item_id": row.get("item_id") or row.get("id"), "campaign_id": row.get("campaign_id"), **{k: row.get(k) for k in ADS_METRICS.split(",")}})
        self.validate()

    def product_mapping(self) -> dict[str, str]:
        lookup: dict[str, str] = {}
        for row in self.tables["_product_mapping"]:
            key = row.get("product_key", "").strip()
            if key:
                for column in ("seller_sku", "item_id", "variation_id"):
                    if row.get(column, "").strip():
                        lookup[f"{column}:{row[column].strip()}"] = key
        return lookup

    @staticmethod
    def product_key(sku: Any, user_product_id: Any, parent_item_id: Any, item_id: Any, mapping: dict[str, str], variation_id: Any = None) -> str:
        # O mapeamento manual tem precedência sobre a chave automática e pode unir
        # variações ou anúncios distintos do mesmo produto/família.
        for label, value in (("variation_id", variation_id), ("seller_sku", sku), ("item_id", item_id)):
            if value and mapping.get(f"{label}:{value}"):
                return mapping[f"{label}:{value}"]
        return str(sku or user_product_id or parent_item_id or item_id or "unmapped")

    def validate(self) -> None:
        orders = self.tables["fact_orders"]
        items = self.tables["fact_order_items"]
        duplicate = len(orders) - len({x["order_id"] for x in orders})
        self.quality.add("error", "Pedidos duplicados", duplicate, "order_id deve ser único.")
        missing_dates = sum(not x.get("date_created") for x in orders)
        self.quality.add("error", "Pedidos sem data", missing_dates, "date_created é obrigatório para a análise mensal.")
        missing_sku = sum(not x.get("seller_sku") for x in items)
        self.quality.add("warning", "SKU ausente", missing_sku, "A chave analítica usa user_product_id, parent_item_id ou item_id como fallback.")
        by_order: dict[str, float] = defaultdict(float)
        for item in items:
            by_order[item["order_id"]] += num(item["gross_revenue"])
        divergence = sum(abs(by_order[x["order_id"]] - num(x["total_amount"])) > 0.05 for x in orders)
        self.quality.add("warning", "Total do pedido divergente da soma dos itens", divergence, "Diferenças podem ser frete, arredondamento ou descontos no pedido.")
        costs = self.tables["fact_product_costs"]
        manual_known = {x.get("product_key") for x in costs if x.get("unit_product_cost") not in ("", None)}
        known = set(manual_known)
        known.update(x.get("product_key") for x in items if num(x.get("unit_product_cost_snapshot")) > 0)
        without_cost = len({x["product_key"] for x in items if x["product_key"] not in known})
        self.quality.add("warning", "Produtos sem custo", without_cost, "Margem é indisponível até o custo histórico ser cadastrado.")
        missing_cost_rows = sum(num(x.get("unit_product_cost_snapshot")) <= 0 and x.get("product_key") not in manual_known for x in items)
        self.quality.add("warning", "Itens de venda sem custo", missing_cost_rows, "A margem agregada fica indisponível quando a cobertura de custo não é total.")

    def cost_for(self, product_key: str, sale_date: str | None) -> dict[str, str] | None:
        options = [x for x in self.tables["fact_product_costs"] if x.get("product_key") == product_key and x.get("unit_product_cost") not in ("", None)]
        active = [x for x in options if (not x.get("valid_from") or x["valid_from"] <= (sale_date or "9999-12-31")) and (not x.get("valid_to") or x["valid_to"] >= (sale_date or "0000-01-01"))]
        return active[-1] if active else None

    def analysis(self) -> dict[str, Any]:
        orders = {x["order_id"]: x for x in self.tables["fact_orders"]}
        product: dict[str, dict[str, Any]] = {}
        monthly: dict[str, dict[str, Any]] = {m: {"month": m, "orders": set(), "units": 0, "gross_revenue": 0.0, "net_revenue": 0.0, "margin": None, "margin_covered": 0.0, "covered_revenue": 0.0, "margin_available": True, "commissions": 0.0, "shipping": 0.0, "returns_loss": 0.0, "product_cost": 0.0, "data_available": m in self.available_months, "complete_month": m in self.complete_months} for m in month_range()}
        visited: dict[tuple[str, str], int] = defaultdict(int)
        for x in self.tables["fact_visits_daily"]:
            if x.get("date"):
                visited[(str(x.get("item_id")), x["date"][:7])] += int(num(x.get("visits")))
        for row in self.tables["fact_order_items"]:
            order = orders.get(row["order_id"], {})
            if not order.get("eligible_sale"):
                continue
            month = str(row.get("order_created_date") or "")[:7]
            if month not in monthly:
                continue
            pkey = row["product_key"]
            target = product.setdefault(pkey, {"product_key": pkey, "title": row.get("title") or pkey, "orders": set(), "units": 0, "gross_revenue": 0.0, "commissions": 0.0, "shipping": 0.0, "returns_loss": 0.0, "product_cost": 0.0, "margin_available": True, "monthly": defaultdict(lambda: {"orders": set(), "units": 0, "gross_revenue": 0.0})})
            gross, commission = num(row["gross_revenue"]), num(row["commission"])
            order_gross = sum(num(y["gross_revenue"]) for y in self.tables["fact_order_items"] if y["order_id"] == row["order_id"])
            shipping = num(order.get("seller_shipping_cost")) * (gross / order_gross) if order_gross else 0.0
            returns_loss = num(row.get("returns_loss"))
            cost = self.cost_for(pkey, row.get("order_created_date"))
            if cost:
                item_cost = num(cost.get("unit_product_cost")) * num(row["quantity"]) + num(cost.get("packaging_cost")) * num(row["quantity"]) + num(cost.get("other_variable_cost")) * num(row["quantity"]) + gross * num(cost.get("tax_rate"))
            elif num(row.get("unit_product_cost_snapshot")) > 0:
                item_cost = num(row.get("unit_product_cost_snapshot")) * num(row["quantity"])
            else:
                item_cost = None
            for bucket in (target, monthly[month]):
                bucket["orders"].add(row["order_id"])
                bucket["units"] += int(num(row["quantity"]))
                bucket["gross_revenue"] += gross
                bucket["commissions"] += commission
                bucket["shipping"] += shipping
                bucket["returns_loss"] += returns_loss
            target["monthly"][month]["orders"].add(row["order_id"])
            target["monthly"][month]["units"] += int(num(row["quantity"]))
            target["monthly"][month]["gross_revenue"] += gross
            if item_cost is None:
                target["margin_available"] = False
                monthly[month]["margin_available"] = False
            else:
                target["product_cost"] += item_cost
                monthly[month]["product_cost"] += item_cost
                monthly[month]["margin_covered"] += gross - commission - shipping - returns_loss - item_cost
                monthly[month]["covered_revenue"] += gross
        for m, row in monthly.items():
            row["orders"] = len(row["orders"])
            row["net_revenue"] = row["gross_revenue"] - row["commissions"] - row["shipping"] - row["returns_loss"]
            row["margin"] = row["margin_covered"] if row["gross_revenue"] and row["data_available"] and row["margin_available"] else None
            row["margin_pct"] = safe_div(row["margin_covered"], row["gross_revenue"]) if row["margin"] is not None else None
            row["cost_coverage_pct"] = safe_div(row["covered_revenue"], row["gross_revenue"])
            row["ticket_average"] = safe_div(row["gross_revenue"], row["orders"])
            row["unit_price_average"] = safe_div(row["gross_revenue"], row["units"])
            row["units_per_order"] = safe_div(row["units"], row["orders"])
        output_products: list[dict[str, Any]] = []
        for row in product.values():
            row["orders"] = len(row["orders"])
            row["net_revenue"] = row["gross_revenue"] - row["commissions"] - row["shipping"] - row["returns_loss"]
            row["margin"] = row["gross_revenue"] - row["commissions"] - row["shipping"] - row["returns_loss"] - row["product_cost"] if row["margin_available"] else None
            row["margin_pct"] = safe_div(row["margin"], row["gross_revenue"]) if row["margin"] is not None else None
            row["average_price"] = safe_div(row["gross_revenue"], row["units"])
            item_ids = [str(x.get("item_id")) for x in self.tables["fact_order_items"] if x["product_key"] == row["product_key"]]
            row["visits"] = sum(visited[(item, month)] for item in item_ids for month in month_range())
            row["conversion_approx"] = safe_div(row["orders"], row["visits"])
            jul, jun = row["monthly"]["2026-07"], row["monthly"]["2026-06"]
            prior_months = [m for m in month_range()[:6] if m in self.complete_months]
            prior = [row["monthly"][m]["gross_revenue"] for m in prior_months]
            row["july_vs_june"] = safe_div(jul["gross_revenue"] - jun["gross_revenue"], jun["gross_revenue"]) if jun["gross_revenue"] else None
            avg_prior = sum(prior) / len(prior)
            row["july_vs_prior_avg"] = safe_div(jul["gross_revenue"] - avg_prior, avg_prior) if avg_prior else None
            row["last_month_with_sale"] = next((m for m in reversed(month_range()) if row["monthly"][m]["gross_revenue"]), None)
            row["months_without_sale"] = sum(not row["monthly"][m]["gross_revenue"] for m in reversed(month_range()))
            row["status"] = "inativo" if not row["last_month_with_sale"] else "em crescimento" if (row["july_vs_june"] or 0) > 0.15 else "em queda" if (row["july_vs_june"] or 0) < -0.15 else "estável"
            row["monthly"] = {m: {**v, "orders": len(v["orders"])} for m, v in row["monthly"].items()}
            output_products.append(row)
        output_products.sort(key=lambda x: x["gross_revenue"], reverse=True)
        abc = {metric: self.abc(output_products, metric) for metric in ("gross_revenue", "orders", "units", "margin")}
        platinum = self.tables["snapshot_platinum_status"][0] if self.tables["snapshot_platinum_status"] else {}
        july = next(x for x in monthly.values() if x["month"] == "2026-07")
        generic_limits = ["Conversão é aproximada: visitas e pedidos podem ter regras de atribuição diferentes."]
        if not self.partial_source:
            generic_limits.append("Dados de Ads são limitados aos últimos 90 dias permitidos pela API; janeiro a abril não são reconstruídos.")
        return {"snapshot_date": self.snapshot_date.isoformat(), "monthly": list(monthly.values()), "products": output_products, "abc": abc, "platinum": self.platinum(platinum, monthly), "quality": self.quality.issues, "limitations": self.limits + generic_limits, "july": july}

    @staticmethod
    def abc(products: list[dict[str, Any]], metric: str) -> list[dict[str, Any]]:
        eligible = [x for x in products if x.get(metric) is not None]
        values = sorted(eligible, key=lambda x: num(x.get(metric)), reverse=True)
        total = sum(num(x.get(metric)) for x in values)
        cumulative = 0.0
        output = []
        for row in values:
            value = num(row.get(metric))
            cumulative += value
            share, acc = safe_div(value, total) or 0.0, safe_div(cumulative, total) or 0.0
            output.append({"product_key": row["product_key"], "title": row["title"], "metric": metric, "value": value, "share": share, "cumulative_share": acc, "class": "A" if acc <= .8 else "B" if acc <= .95 else "C"})
        return output

    @staticmethod
    def platinum(raw: dict[str, Any], monthly: dict[str, dict[str, Any]]) -> dict[str, Any]:
        sales = raw.get("sales_current")
        revenue = raw.get("revenue_current")
        sales_gap = raw.get("sales_gap_ui") if raw.get("sales_gap_ui") is not None else (num(raw.get("sales_required")) - num(sales) if sales is not None else None)
        revenue_gap = raw.get("revenue_gap_ui") if raw.get("revenue_gap_ui") is not None else (num(raw.get("revenue_required")) - num(revenue) if revenue is not None else None)
        return {**raw, "sales_gap_official": sales_gap, "revenue_gap_official": revenue_gap, "estimated_daily_sales_needed_30d": safe_div(num(sales_gap), 30) if sales_gap is not None else None, "estimated_daily_revenue_needed_30d": safe_div(num(revenue_gap), 30) if revenue_gap is not None else None}

    def persist(self, report: dict[str, Any]) -> None:
        self.processed_dir.mkdir(parents=True, exist_ok=True)
        self.report_dir.mkdir(parents=True, exist_ok=True)
        public_tables = {k: v for k, v in self.tables.items() if not k.startswith("_")}
        for name, rows in public_tables.items():
            columns = sorted({column for row in rows for column in row}) if rows else []
            if columns:
                write_csv(self.processed_dir / f"{name}.csv", rows, columns)
        try:
            import pyarrow as pa  # type: ignore
            import pyarrow.parquet as pq  # type: ignore
            for name, rows in public_tables.items():
                if rows:
                    pq.write_table(pa.Table.from_pylist(rows), self.processed_dir / f"{name}.parquet")
        except ImportError:
            raise RuntimeError("pyarrow é obrigatório para o requisito de Parquet. Instale scripts/mercado_livre_analysis/requirements.txt.")
        (self.report_dir / "analysis.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=list), encoding="utf-8")
        self.write_quality(report)
        self.write_html(report)
        self.write_charts(report)

    def write_quality(self, report: dict[str, Any]) -> None:
        lines = ["# Qualidade dos dados", "", f"Status do modelo: {'PASS' if self.quality.passed else 'REVISAR'}", "", "| Severidade | Teste | Ocorrências | Detalhe |", "|---|---|---:|---|"]
        lines += [f"| {x['severity']} | {x['check']} | {x['count']} | {x['detail']} |" for x in report["quality"]]
        lines += ["", "## Limitações", ""] + [f"- {x}" for x in report["limitations"]]
        (self.report_dir / "data_quality.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def write_html(self, report: dict[str, Any]) -> None:
        monthly = report["monthly"]
        products = report["products"][:20]
        def money(v: Any) -> str: return "—" if v is None else f"R$ {num(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
        def pct(v: Any) -> str: return "—" if v is None else f"{num(v) * 100:.1f}%".replace(".", ",")
        kpis = [("Receita bruta", money(report["july"]["gross_revenue"])), ("Pedidos", str(report["july"]["orders"])), ("Unidades", str(report["july"]["units"])), ("Margem", money(report["july"]["margin"])), ("Margem %", pct(report["july"]["margin_pct"])), ("Ticket médio", money(report["july"]["ticket_average"]))]
        cards = "".join(f"<article><small>{html.escape(k)}</small><strong>{html.escape(v)}</strong></article>" for k, v in kpis)
        rows = "".join(f"<tr><td>{m['month']}{' *' if m.get('data_available') and not m.get('complete_month') else ''}</td><td>{m['orders'] if m.get('data_available') else '—'}</td><td>{m['units'] if m.get('data_available') else '—'}</td><td>{money(m['gross_revenue']) if m.get('data_available') else '—'}</td><td>{money(m['net_revenue']) if m.get('data_available') else '—'}</td><td>{money(m['margin']) if m.get('data_available') else '—'}</td><td>{pct(m['margin_pct']) if m.get('data_available') else '—'}</td></tr>" for m in monthly)
        product_rows = "".join(f"<tr><td>{html.escape(str(p['product_key']))}</td><td>{html.escape(str(p['title']))}</td><td>{p['orders']}</td><td>{p['units']}</td><td>{money(p['gross_revenue'])}</td><td>{money(p['margin'])}</td><td>{pct(p['margin_pct'])}</td><td>{html.escape(p['status'])}</td></tr>" for p in products)
        limitations = "".join(f"<li>{html.escape(x)}</li>" for x in report["limitations"])
        text = f"""<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Análise Mercado Livre</title><style>
        body{{font:15px Inter,Arial,sans-serif;color:#172033;background:#f7f9fc;margin:0}}main{{max-width:1200px;margin:auto;padding:40px 24px}}h1{{margin:0}}h2{{margin-top:42px}}.sub{{color:#64748b}}.cards{{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin:24px 0}}article,section{{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:18px}}article small{{color:#64748b;display:block}}article strong{{font-size:22px;display:block;margin-top:8px}}table{{border-collapse:collapse;width:100%;background:white}}th{{background:#0f3d4c;color:#fff;text-align:left}}th,td{{padding:10px;border-bottom:1px solid #e2e8f0}}td:nth-child(n+3){{text-align:right}}.grid{{display:grid;grid-template-columns:1fr 1fr;gap:20px}}img{{width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:12px}}@media(max-width:850px){{.cards,.grid{{grid-template-columns:repeat(2,1fr)}}}}</style><main>
        <h1>Mercado Livre — Relatório executivo</h1><p class=\"sub\">Período: 01/01/2026 a 31/07/2026 · Fuso: America/Fortaleza · Extração: {html.escape(report['snapshot_date'])}</p>
        <h2>1. Como foi julho</h2><div class=\"cards\">{cards}</div><p>Os indicadores acima usam somente pedidos elegíveis; pedidos e unidades são apresentados separadamente.</p>
        <h2>2. Evolução mensal</h2><div class=\"grid\"><img src=\"charts/monthly_revenue.png\" alt=\"Receita mensal\"><img src=\"charts/monthly_orders_units.png\" alt=\"Pedidos e unidades\"></div><table><thead><tr><th>Mês</th><th>Pedidos</th><th>Unidades</th><th>Receita bruta</th><th>Receita líquida ML</th><th>Margem</th><th>Margem %</th></tr></thead><tbody>{rows}</tbody></table><p class=\"sub\">* mês com cobertura parcial; não utilizado como base de comparação mensal.</p>
        <h2>3. O que explica o resultado</h2><section><p>O modelo cruza a série mensal com alterações registradas em <code>interventions.csv</code>. Sem uma intervenção ou evidência operacional temporalmente próxima, a variação é tratada como observação, não como causalidade.</p><p>Interpretação de negócio: valide preço, ruptura, estoque, desconto e Ads nos produtos com maior variação antes de alterar a estratégia.</p></section>
        <h2>4. Curva ABC e concentração</h2><div class=\"grid\"><img src=\"charts/abc_revenue.png\" alt=\"Pareto receita\"><img src=\"charts/abc_margin.png\" alt=\"Pareto margem\"></div><p>Produtos A concentram a maior parcela do indicador; receita alta não implica margem alta. Priorize disponibilidade e conversão dos itens A com margem positiva.</p>
        <h2>5. Evolução individual e oportunidades de retomada</h2><table><thead><tr><th>Chave</th><th>Produto</th><th>Pedidos</th><th>Unidades</th><th>Receita</th><th>Margem</th><th>Margem %</th><th>Situação</th></tr></thead><tbody>{product_rows}</tbody></table><p>O ranking de retomada considera somente histórico de vendas; sua execução depende de validar estoque, margem vigente e risco operacional.</p>
        <h2>6. Situação Platinum</h2><section><p>Gap oficial de vendas: <strong>{html.escape(str(report['platinum'].get('sales_gap_official') if report['platinum'].get('sales_gap_official') is not None else 'não informado no painel'))}</strong></p><p>Gap oficial de faturamento: <strong>{money(report['platinum'].get('revenue_gap_official'))}</strong></p><p>O painel da conta prevalece sobre qualquer projeção calculada. Pedidos e unidades não são intercambiáveis para a meta.</p></section>
        <h2>7. Estratégia de produtos de menor ticket e cenários</h2><section><p>Produtos de menor ticket só devem apoiar a meta se preservarem margem por pedido, apresentarem conversão e estoque suficientes e não elevarem cancelamentos/devoluções. Sem custos históricos e estoque/reabastecimento informados, o relatório não recomenda um SKU específico.</p><p>Cenário conservador: ganho de conversão nos itens atuais. Equilibrado: retomada seletiva e entrada limitada. Agressivo: maior pressão de descontos e Ads, com maior risco de margem e operação.</p></section>
        <h2>8. Plano de ação</h2><table><thead><tr><th>Horizonte</th><th>Ação</th><th>Responsável</th><th>Indicador</th></tr></thead><tbody><tr><td>48 horas</td><td>Preencher custos vigentes, estoque e snapshot Platinum.</td><td>Financeiro / Marketplace</td><td>Cobertura de custo e gap oficial</td></tr><tr><td>7 dias</td><td>Validar produtos A, itens em queda e intervenções recentes.</td><td>Comercial / Operação</td><td>Ruptura, conversão, margem por pedido</td></tr><tr><td>30 dias</td><td>Executar o cenário equilibrado aprovado e revisar a janela Platinum.</td><td>Diretoria / Marketplace</td><td>Pedidos elegíveis/dia, receita/dia e reputação</td></tr></tbody></table>
        <h2>9. Limitações e qualidade</h2><ul>{limitations}</ul><p>Veja <a href=\"data_quality.md\">data_quality.md</a> para os testes e divergências.</p></main></html>"""
        self.report_dir.mkdir(parents=True, exist_ok=True)
        (self.report_dir / "executive_report.html").write_text(text, encoding="utf-8")
        summary = ["# Relatório executivo — Mercado Livre", "", "## Resumo executivo", "", "O relatório HTML contém os KPIs, tendências e rankings calculados a partir da extração somente leitura.", "", "## Limitações e qualidade", ""] + [f"- {x}" for x in report["limitations"]]
        (self.report_dir / "executive_report.md").write_text("\n".join(summary) + "\n", encoding="utf-8")

    def write_charts(self, report: dict[str, Any]) -> None:
        try:
            from PIL import Image, ImageDraw, ImageFont  # type: ignore
        except ImportError as exc:
            raise RuntimeError("Pillow é obrigatório para os gráficos PNG.") from exc
        out = self.report_dir / "charts"; out.mkdir(parents=True, exist_ok=True)
        font = ImageFont.load_default()
        def bar(name: str, title: str, labels: list[str], values: list[float]) -> None:
            img = Image.new("RGB", (1000, 440), "white"); draw = ImageDraw.Draw(img); draw.text((36, 24), title, fill="#102a43", font=font)
            max_v = max(values) if values else 0
            if not max_v: draw.text((36, 220), "Sem dados disponíveis", fill="#64748b", font=font)
            for i, value in enumerate(values):
                x = 55 + i * max(1, 880 // max(len(values), 1)); width = max(12, 760 // max(len(values), 1)); height = int((value / max_v) * 290) if max_v else 0
                draw.rectangle((x, 370 - height, x + width, 370), fill="#1f7a8c"); draw.text((x, 385), labels[i][:13], fill="#334e68", font=font)
            draw.line((45, 370, 955, 370), fill="#9fb3c8", width=1); img.save(out / name)
        def line(name: str, title: str, labels: list[str], values: list[float]) -> None:
            img = Image.new("RGB", (1000, 440), "white"); draw = ImageDraw.Draw(img); draw.text((36, 24), title, fill="#102a43", font=font)
            max_v = max(values) if values else 0; points=[]
            for i, value in enumerate(values):
                x=60+i*(850/max(len(values)-1,1)); y=360-(value/max_v*280 if max_v else 0); points.append((x,y)); draw.text((x-8,385),labels[i][-2:],fill="#334e68",font=font)
            if len(points)>1: draw.line(points, fill="#d97706", width=4)
            for x,y in points: draw.ellipse((x-4,y-4,x+4,y+4), fill="#d97706")
            draw.line((45,370,955,370),fill="#9fb3c8",width=1); img.save(out/name)
        months=[x for x in report["monthly"] if x.get("data_available")]; labels=[x["month"] + ("*" if not x.get("complete_month") else "") for x in months]
        bar("monthly_revenue.png", "Receita bruta mensal", labels, [num(x["gross_revenue"]) for x in months])
        bar("monthly_orders_units.png", "Pedidos mensais", labels, [num(x["orders"]) for x in months])
        line("monthly_margin.png", "Margem de contribuição", labels, [num(x["margin"]) for x in months])
        line("ticket_average.png", "Ticket médio", labels, [num(x["ticket_average"]) for x in months])
        for metric, filename, title in (("gross_revenue", "abc_revenue.png", "Pareto ABC — Receita"), ("units", "abc_units.png", "Pareto ABC — Unidades"), ("margin", "abc_margin.png", "Pareto ABC — Margem")):
            abc=report["abc"].get(metric, [])[:15]; bar(filename, title, [str(x["product_key"]) for x in abc], [num(x["value"]) for x in abc])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Análise Mercado Livre — somente leitura")
    parser.add_argument("--root", default=".", help="Raiz do projeto")
    parser.add_argument("--snapshot-date", default="2026-08-01")
    parser.add_argument("--source", choices=("api", "dashboard"), default="api")
    parser.add_argument("--snapshot-file", default="data/raw/dashboard/snapshot_2026-08-01.json")
    parser.add_argument("--skip-ads", action="store_true")
    parser.add_argument("--skip-billing", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pipeline = Pipeline(Path(args.root).resolve(), date.fromisoformat(args.snapshot_date), not args.skip_ads, not args.skip_billing)
    try:
        # Falha antes de qualquer chamada externa caso não seja possível cumprir
        # os entregáveis CSV + Parquet + PNG solicitados.
        import pyarrow  # type: ignore # noqa: F401
        import PIL  # type: ignore # noqa: F401
        if args.source == "dashboard":
            pipeline.load_dashboard_snapshot((pipeline.root / args.snapshot_file).resolve())
        else:
            pipeline.extract()
            pipeline.normalize()
        report = pipeline.analysis()
        pipeline.persist(report)
    except (RuntimeError, ImportError) as exc:
        print(f"ERRO: {exc}", file=sys.stderr)
        return 2
    print("Análise concluída. Entregáveis em report/ e data/processed/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
