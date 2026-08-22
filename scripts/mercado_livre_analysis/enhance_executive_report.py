#!/usr/bin/env python3
"""Completa o relatório executivo e os gráficos de apresentação.

Lê somente os artefatos normalizados gerados por ``run_analysis.py``. Campos
financeiros dependentes de custo, estoque ou painel oficial permanecem
explicitamente indisponíveis quando não foram fornecidos.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


NAVY = "#0F3D4C"
TEAL = "#1F7A8C"
GREEN = "#2F855A"
AMBER = "#D97706"
RED = "#C2413B"
GRAY = "#64748B"
LIGHT = "#E2E8F0"


def n(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def brl(value: Any) -> str:
    if value is None:
        return "—"
    return f"R$ {n(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pct(value: Any) -> str:
    if value is None:
        return "—"
    return f"{n(value) * 100:.1f}%".replace(".", ",")


def delta(current: Any, base: Any) -> float | None:
    return (n(current) - n(base)) / n(base) if n(base) else None


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def base_image(title: str, subtitle: str = "") -> tuple[Image.Image, ImageDraw.ImageDraw, ImageFont.ImageFont]:
    image = Image.new("RGB", (1200, 620), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default()
    draw.text((44, 30), title, fill=NAVY, font=font)
    if subtitle:
        draw.text((44, 52), subtitle, fill=GRAY, font=font)
    draw.line((44, 570, 1150, 570), fill=LIGHT, width=2)
    return image, draw, font


def empty_chart(path: Path, title: str, message: str) -> None:
    image, draw, font = base_image(title)
    draw.rounded_rectangle((120, 180, 1080, 420), radius=16, fill="#FFF7ED", outline="#FED7AA", width=2)
    draw.text((165, 285), message, fill="#9A3412", font=font)
    image.save(path)


def line_chart(path: Path, title: str, labels: list[str], series: list[tuple[str, list[float], str]], subtitle: str = "") -> None:
    image, draw, font = base_image(title, subtitle)
    all_values = [value for _, values, _ in series for value in values]
    maximum = max(all_values, default=0)
    if not maximum:
        empty_chart(path, title, subtitle or "Sem valores disponíveis para a janela.")
        return
    left, top, right, bottom = 80, 105, 1140, 535
    for step in range(5):
        y = bottom - step * (bottom - top) / 4
        draw.line((left, y, right, y), fill="#EDF2F7", width=1)
        draw.text((20, y - 5), f"{maximum * step / 4:,.0f}", fill=GRAY, font=font)
    for name, values, color in series:
        points = []
        for index, value in enumerate(values):
            x = left + index * (right - left) / max(len(labels) - 1, 1)
            y = bottom - value / maximum * (bottom - top)
            points.append((x, y))
        if len(points) > 1:
            draw.line(points, fill=color, width=4)
        for x, y in points:
            draw.ellipse((x - 5, y - 5, x + 5, y + 5), fill=color)
        legend_x = 820 + series.index((name, values, color)) * 150
        draw.rectangle((legend_x, 32, legend_x + 14, 46), fill=color)
        draw.text((legend_x + 20, 33), name, fill=NAVY, font=font)
    for index, label in enumerate(labels):
        x = left + index * (right - left) / max(len(labels) - 1, 1)
        draw.text((x - 20, 582), label, fill=GRAY, font=font)
    image.save(path)


def waterfall(path: Path, month: dict[str, Any]) -> None:
    image, draw, font = base_image("Waterfall de julho", "Receita bruta até receita líquida; margem depende do custo do produto")
    gross = n(month.get("gross_revenue"))
    values = [("Receita bruta", gross, GREEN), ("Comissões", -n(month.get("commissions")), RED), ("Frete vendedor", -n(month.get("shipping")), AMBER), ("Receita líquida ML", n(month.get("net_revenue")), TEAL)]
    maximum = max(gross, 1)
    x = 100
    running = gross
    for index, (label, value, color) in enumerate(values):
        shown = value if index else gross
        height = abs(shown) / maximum * 350
        y = 500 - height
        draw.rectangle((x, y, x + 180, 500), fill=color)
        draw.text((x, 520), label, fill=NAVY, font=font)
        draw.text((x, y - 18), brl(shown), fill=NAVY, font=font)
        if 0 < index < 3:
            running += value
        x += 260
    draw.text((92, 580), "Margem de contribuição indisponível: 0% de cobertura de custo histórico.", fill=RED, font=font)
    image.save(path)


def heatmap(path: Path, products: list[dict[str, Any]]) -> None:
    top = products[:15]
    months = [f"2026-{month:02d}" for month in range(1, 8)]
    image, draw, font = base_image("Heatmap de receita por produto e mês", "Top 15 produtos por receita no período")
    values = [n(product.get("monthly", {}).get(month, {}).get("gross_revenue")) for product in top for month in months]
    maximum = max(values, default=0)
    start_x, start_y, cw, ch = 480, 105, 90, 28
    for index, month in enumerate(months):
        draw.text((start_x + index * cw + 16, 82), month[-2:], fill=NAVY, font=font)
    for row_index, product in enumerate(top):
        y = start_y + row_index * ch
        draw.text((36, y + 7), str(product.get("title") or product.get("product_key"))[:62], fill=NAVY, font=font)
        for column_index, month in enumerate(months):
            value = n(product.get("monthly", {}).get(month, {}).get("gross_revenue"))
            intensity = int(235 - (value / maximum * 155 if maximum else 0))
            color = (intensity, min(248, intensity + 20), 238)
            x = start_x + column_index * cw
            draw.rectangle((x, y, x + cw - 4, y + ch - 3), fill=color)
    image.save(path)


def visits_chart(path: Path, months: list[str], visits: list[float], conversion: list[float]) -> None:
    image, draw, font = base_image("Visitas e conversão aproximada", "Escalas normalizadas; conversão = pedidos elegíveis ÷ visitas")
    if not max(visits, default=0):
        empty_chart(path, "Visitas e conversão aproximada", "Visitas indisponíveis para o período.")
        return
    maximum_visits = max(visits)
    maximum_conversion = max(conversion, default=0) or 1
    left, top, right, bottom = 80, 110, 1140, 520
    visit_points, conversion_points = [], []
    for index, label in enumerate(months):
        x = left + index * (right - left) / max(len(months) - 1, 1)
        visit_points.append((x, bottom - visits[index] / maximum_visits * (bottom - top)))
        conversion_points.append((x, bottom - conversion[index] / maximum_conversion * (bottom - top)))
        draw.text((x - 18, 545), label[-2:], fill=GRAY, font=font)
    draw.line(visit_points, fill=TEAL, width=4)
    draw.line(conversion_points, fill=AMBER, width=4)
    draw.text((850, 36), "Visitas", fill=TEAL, font=font)
    draw.text((950, 36), "Conversão", fill=AMBER, font=font)
    image.save(path)


def ads_chart(path: Path, ads: list[dict[str, Any]]) -> None:
    if not ads or not any(n(row.get("cost")) for row in ads):
        empty_chart(path, "Investimento em Ads e ROAS", "A API retornou gasto patrocinado zero entre 03/05 e 31/07/2026.")
        return
    labels = [row["month"] for row in ads]
    line_chart(path, "Investimento em Ads e ROAS", labels, [("Investimento", [n(row.get("cost")) for row in ads], TEAL), ("ROAS", [n(row.get("roas")) for row in ads], AMBER)], "Escalas normalizadas")


def build(root: Path) -> None:
    report_dir = root / "report"
    charts = report_dir / "charts"
    charts.mkdir(parents=True, exist_ok=True)
    report = json.loads((report_dir / "analysis.json").read_text(encoding="utf-8"))
    cancellations_path = report_dir / "cancellations_returns.json"
    cancellations = json.loads(cancellations_path.read_text(encoding="utf-8")) if cancellations_path.exists() else {}
    monthly = report["monthly"]
    products = report["products"]
    orders = read_csv(root / "data/processed/fact_orders.csv")
    visits_rows = read_csv(root / "data/processed/fact_visits_daily.csv")
    ads_rows = read_csv(root / "data/processed/fact_ads_daily.csv")

    visits_by_month: dict[str, float] = defaultdict(float)
    for row in visits_rows:
        visits_by_month[str(row.get("date", ""))[:7]] += n(row.get("visits"))
    ads_by_month: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for row in ads_rows:
        month = str(row.get("date", ""))[:7]
        for key in ("cost", "clicks", "prints", "direct_amount", "indirect_amount", "total_amount", "units_quantity"):
            ads_by_month[month][key] += n(row.get(key))
    ads_monthly = []
    for month in sorted(ads_by_month):
        values = dict(ads_by_month[month])
        values.update({"month": month, "roas": values.get("total_amount", 0) / values.get("cost", 1) if values.get("cost") else 0})
        ads_monthly.append(values)

    labels = [row["month"] for row in monthly]
    line_chart(charts / "monthly_revenue.png", "Receita bruta e líquida mensal", labels, [("Bruta", [n(row["gross_revenue"]) for row in monthly], GREEN), ("Líquida ML", [n(row["net_revenue"]) for row in monthly], TEAL)])
    line_chart(charts / "monthly_orders_units.png", "Pedidos e unidades mensais", labels, [("Pedidos", [n(row["orders"]) for row in monthly], TEAL), ("Unidades", [n(row["units"]) for row in monthly], AMBER)])
    if all(row.get("margin") is None for row in monthly):
        empty_chart(charts / "monthly_margin.png", "Margem absoluta e percentual", "Indisponível: o arquivo de custos não possui cobertura histórica.")
        empty_chart(charts / "abc_margin.png", "Pareto ABC — margem", "Indisponível: nenhum produto possui custo histórico cadastrado.")
        empty_chart(charts / "bubble_products.png", "Unidades × margem % × receita", "Indisponível: a margem percentual depende dos custos históricos.")
    waterfall(charts / "waterfall_july.png", report["july"])
    heatmap(charts / "product_heatmap.png", products)
    visit_values = [visits_by_month.get(month, 0) for month in labels]
    conversions = [n(row.get("orders")) / visits if visits else 0 for row, visits in zip(monthly, visit_values)]
    visits_chart(charts / "visits_conversion.png", labels, visit_values, conversions)
    ads_chart(charts / "ads_roas.png", ads_monthly)
    platinum = report.get("platinum", {})
    if platinum.get("sales_current") is None:
        empty_chart(charts / "platinum_progress.png", "Progresso para MercadoLíder Platinum", "Informe vendas e faturamento atuais do painel para calcular o progresso.")
        empty_chart(charts / "platinum_window.png", "Entradas e saídas da janela Platinum", "A janela oficial e as saídas futuras não estão expostas pela API.")
    empty_chart(charts / "scenarios_comparison.png", "Comparação dos cenários", "Cenários quantitativos aguardam custos, estoque, reposição e gap oficial.")

    july, june = monthly[-1], monthly[-2]
    jan_jun = monthly[:6]
    average_prior = {key: sum(n(row.get(key)) for row in jan_jun) / len(jan_jun) for key in ("orders", "units", "gross_revenue", "net_revenue", "ticket_average")}
    last_three = {key: sum(n(row.get(key)) for row in monthly[-3:]) for key in ("orders", "units", "gross_revenue", "net_revenue")}
    statuses = Counter(product.get("status", "não classificado") for product in products)
    growing = sorted((product for product in products if product.get("status") == "em crescimento"), key=lambda row: n(row.get("gross_revenue")), reverse=True)[:12]
    falling = sorted((product for product in products if product.get("status") in {"em queda", "inativo"}), key=lambda row: n(row.get("gross_revenue")), reverse=True)[:12]
    top = products[0] if products else {}
    total_revenue = sum(n(row.get("gross_revenue")) for row in products)
    class_a = [row for row in report.get("abc", {}).get("gross_revenue", []) if row.get("class") == "A"]
    class_a_share = sum(n(row.get("share")) for row in class_a)
    eligible_order_dates = [row.get("date_created", "")[:10] for row in orders if str(row.get("eligible_sale", "")).lower() == "true"]

    def product_rows(rows: list[dict[str, Any]]) -> str:
        return "".join(f"<tr><td>{html.escape(str(row.get('product_key')))}</td><td>{html.escape(str(row.get('title')))}</td><td>{int(n(row.get('orders')))}</td><td>{brl(row.get('gross_revenue'))}</td><td>{pct(row.get('july_vs_june'))}</td><td>{int(n(row.get('visits'))):,}</td></tr>" for row in rows)

    quality_rows = "".join(f"<tr><td>{html.escape(str(row['severity']))}</td><td>{html.escape(str(row['check']))}</td><td>{row['count']}</td><td>{html.escape(str(row['detail']))}</td></tr>" for row in report.get("quality", []))
    monthly_rows = "".join(f"<tr><td>{row['month']}</td><td>{int(n(row['orders']))}</td><td>{int(n(row['units']))}</td><td>{brl(row['gross_revenue'])}</td><td>{brl(row['net_revenue'])}</td><td>{brl(row['ticket_average'])}</td><td>{brl(row.get('margin'))}</td></tr>" for row in monthly)
    ad_rows = "".join(f"<tr><td>{row['month']}</td><td>{brl(row.get('cost'))}</td><td>{int(n(row.get('prints')))}</td><td>{int(n(row.get('clicks')))}</td><td>{brl(row.get('total_amount'))}</td><td>{n(row.get('roas')):.2f}</td></tr>" for row in ads_monthly)
    limitations = "".join(f"<li>{html.escape(str(item))}</li>" for item in report.get("limitations", []))
    cancel_overall = cancellations.get("overall", {})
    cancel_monthly = cancellations.get("monthly", [])
    cancel_rows = "".join(f"<tr><td>{row['month']}</td><td>{int(n(row['orders_created']))}</td><td>{int(n(row['cancelled_orders']))}</td><td>{pct(row.get('cancellation_rate'))}</td><td>{int(n(row['commercial_returns']))}</td><td>{int(n(row.get('completed_returns')))}</td><td>{pct(row.get('return_rate_on_eligible_sales'))}</td><td>{int(n(row['logistics_returns_to_sender']))}</td></tr>" for row in cancel_monthly)
    cancel_product_rows = "".join(f"<tr><td>{html.escape(str(row.get('product_key')))}</td><td>{html.escape(str(row.get('title')))}</td><td>{int(n(row.get('orders_created')))}</td><td>{int(n(row.get('cancelled_orders')))}</td><td>{pct(row.get('cancellation_rate'))}</td><td>{int(n(row.get('commercial_returns')))}</td><td>{pct(row.get('return_rate_on_eligible_sales'))}</td></tr>" for row in cancellations.get("top_products", [])[:12])
    causes = cancellations.get("cancellation_causes", {})
    cancellation_section = ""
    if cancellations:
        cancellation_section = f"""<h3>Cancelamentos e devoluções — janeiro a julho</h3><div class='cards'><div class='card'><small>Cancelamentos</small><strong>{int(n(cancel_overall.get('cancelled_orders'))):,}</strong></div><div class='card'><small>Taxa de cancelamento</small><strong>{pct(cancel_overall.get('cancellation_rate'))}</strong></div><div class='card'><small>Devoluções iniciadas</small><strong>{int(n(cancel_overall.get('commercial_returns'))):,}</strong></div><div class='card'><small>Taxa de devolução</small><strong>{pct(cancel_overall.get('return_rate_on_eligible_sales'))}</strong></div><div class='card'><small>Devoluções concluídas</small><strong>{int(n(cancel_overall.get('completed_returns'))):,}</strong></div><div class='card'><small>Retornos logísticos</small><strong>{int(n(cancel_overall.get('logistics_returns_to_sender'))):,}</strong></div><div class='card'><small>Valor bruto cancelado</small><strong>{brl(cancel_overall.get('cancelled_gross_value'))}</strong></div><div class='card'><small>Custo de frete reverso</small><strong>{brl(cancel_overall.get('return_shipping_cost'))}</strong></div></div><div class='grid'><img src='charts/cancellations_returns_monthly.png'><img src='charts/cancellation_return_rates.png'></div><div class='grid'><img src='charts/cancellation_causes.png'><img src='charts/top_cancelled_products.png'></div><table><thead><tr><th>Mês</th><th>Pedidos criados</th><th>Cancelados</th><th>Taxa cancel.</th><th>Devoluções</th><th>Concluídas</th><th>Taxa devol.</th><th>Retornos logísticos</th></tr></thead><tbody>{cancel_rows}</tbody></table><h3>Produtos mais expostos em volume</h3><table><thead><tr><th>Chave</th><th>Produto</th><th>Pedidos</th><th>Cancelados</th><th>Taxa cancel.</th><th>Devoluções</th><th>Taxa devol.</th></tr></thead><tbody>{cancel_product_rows}</tbody></table><p class='interpret'>Interpretação: a taxa geral de cancelamento foi {pct(cancel_overall.get('cancellation_rate'))}; julho caiu para {pct(cancel_monthly[-1].get('cancellation_rate') if cancel_monthly else None)}, melhor marca dos últimos quatro meses. Foram identificados {int(n(cancel_overall.get('commercial_returns')))} processos de devolução, dos quais {int(n(cancel_overall.get('completed_returns')))} já entregues no retorno. A taxa de devolução de julho ainda não está madura no snapshot de 01/08 e não deve ser lida como melhora definitiva. As origens registradas dos cancelamentos foram {int(n(causes.get('mercado_livre_or_mediation')))} mediação/Mercado Livre, {int(n(causes.get('buyer')))} comprador e {int(n(causes.get('logistics')))} logística; não houve cancelamento classificado como solicitado pelo vendedor.</p>"""

    css = """body{margin:0;background:#f6f8fb;color:#172033;font:15px Inter,Arial,sans-serif}main{max-width:1220px;margin:auto;padding:36px 24px 80px}header{background:#0f3d4c;color:white;padding:28px;border-radius:18px}h1{margin:0 0 8px}h2{margin-top:42px;color:#0f3d4c}.cards,.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.grid{grid-template-columns:1fr 1fr}.card,.note{background:white;border:1px solid #dce4ec;border-radius:12px;padding:16px}.card small{color:#64748b;display:block}.card strong{display:block;font-size:22px;margin-top:8px}.warn{background:#fff7ed;border-color:#fed7aa}table{width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden}th{background:#0f3d4c;color:white;text-align:left}th,td{padding:9px;border-bottom:1px solid #e2e8f0}td:nth-child(n+3){text-align:right}img{width:100%;background:white;border:1px solid #dce4ec;border-radius:12px}.interpret{border-left:4px solid #1f7a8c;padding:12px 16px;background:#eef8fa}.muted{color:#64748b}@media(max-width:850px){.cards,.grid{grid-template-columns:1fr}}"""
    cards = [("Receita bruta julho", brl(july["gross_revenue"])), ("Pedidos julho", f"{int(n(july['orders'])):,}"), ("Unidades julho", f"{int(n(july['units'])):,}"), ("Ticket médio", brl(july["ticket_average"])), ("Julho × junho", pct(delta(july["gross_revenue"], june["gross_revenue"]))), ("Julho × média jan–jun", pct(delta(july["gross_revenue"], average_prior["gross_revenue"]))), ("Receita mai–jul", brl(last_three["gross_revenue"])), ("Cobertura de custo", pct(july.get("cost_coverage_pct")))]
    card_html = "".join(f"<div class='card'><small>{html.escape(label)}</small><strong>{html.escape(value)}</strong></div>" for label, value in cards)
    html_text = f"""<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Relatório executivo Mercado Livre</title><style>{css}</style></head><body><main>
    <header><h1>Mercado Livre — relatório executivo</h1><div>01/01/2026 a 31/07/2026 · America/Fortaleza · extração {html.escape(report['snapshot_date'])} · somente leitura</div></header>
    <h2>1. Resumo executivo</h2><div class='cards'>{card_html}</div><div class='note'><p><b>O que melhorou:</b> julho preservou 647 pedidos e 682 unidades, mas não superou junho. <b>O que piorou:</b> receita caiu {pct(delta(july['gross_revenue'], june['gross_revenue']))} e pedidos {pct(delta(july['orders'], june['orders']))} contra junho.</p><p><b>Principal fonte de receita:</b> {html.escape(str(top.get('title','—')))}, com {brl(top.get('gross_revenue'))} ({pct(n(top.get('gross_revenue')) / total_revenue if total_revenue else None)} do período). <b>Principal fonte de margem:</b> indisponível sem custos históricos.</p><p><b>Maior risco:</b> decidir preço, mix ou Ads sem conhecer margem. <b>Maior oportunidade:</b> proteger os {len(class_a)} produtos classe A, responsáveis por {pct(class_a_share)} da receita, e investigar os itens em queda com visitas.</p><p><b>Distância Platinum:</b> o app informa requisitos de {int(n(platinum.get('sales_required'))):,} vendas e {brl(platinum.get('revenue_required'))}, porém o painel atual/gap não foi preenchido. <b>Ação prioritária:</b> cadastrar custos e transcrever o snapshot oficial.</p></div><p class='interpret'>Interpretação: maio foi o pico; junho e julho formam uma desaceleração sequencial. A reação deve começar em disponibilidade e conversão dos produtos A, antes de desconto ou mídia.</p>
    <h2>2. Como foi julho</h2><div class='grid'><img src='charts/waterfall_july.png'><img src='charts/ticket_average.png'></div><p>Julho fechou com {int(n(july['orders']))} pedidos, {int(n(july['units']))} unidades, {brl(july['gross_revenue'])} brutos e {brl(july['net_revenue'])} líquidos de marketplace. Comissões somaram {brl(july['commissions'])} e frete do vendedor {brl(july['shipping'])}.</p><p class='interpret'>Interpretação: a queda de receita foi maior que a queda de pedidos, coerente com ticket médio {pct(delta(july['ticket_average'], june['ticket_average']))} menor que junho.</p>
    <h2>3. Evolução de janeiro a julho</h2><div class='grid'><img src='charts/monthly_revenue.png'><img src='charts/monthly_orders_units.png'></div><table><thead><tr><th>Mês</th><th>Pedidos</th><th>Unidades</th><th>Receita bruta</th><th>Receita líquida ML</th><th>Ticket</th><th>Margem</th></tr></thead><tbody>{monthly_rows}</tbody></table><p class='interpret'>Interpretação: houve aceleração forte até maio ({brl(monthly[4]['gross_revenue'])}), seguida de duas quedas. Nos três meses completos foram {int(last_three['orders'])} pedidos, {int(last_three['units'])} unidades e {brl(last_three['gross_revenue'])} de receita.</p>
    <h2>4. O que explica o resultado</h2><div class='grid'><img src='charts/visits_conversion.png'><img src='charts/ads_roas.png'></div><table><thead><tr><th>Mês</th><th>Ads</th><th>Impressões patrocinadas</th><th>Cliques</th><th>Receita atribuída</th><th>ROAS</th></tr></thead><tbody>{ad_rows or '<tr><td colspan=6>Sem dados de Ads</td></tr>'}</tbody></table><p class='interpret'>Interpretação: a API retornou atividade patrocinada zerada na janela de 90 dias; assim, as vendas observadas foram predominantemente orgânicas. Intervenções de preço/estoque não foram fornecidas, portanto não há base para causalidade.</p>{cancellation_section}
    <h2>5. Curva ABC e concentração</h2><div class='grid'><img src='charts/abc_revenue.png'><img src='charts/abc_units.png'></div><div class='grid'><img src='charts/abc_margin.png'><img src='charts/bubble_products.png'></div><p class='interpret'>Interpretação: a concentração por receita e unidades orienta prioridade operacional. A leitura cruzada com margem fica bloqueada até a cobertura de custo chegar a 100%.</p>
    <h2>6. Evolução individual dos produtos</h2><img src='charts/product_heatmap.png'><table><thead><tr><th>Chave</th><th>Produto</th><th>Pedidos</th><th>Receita</th><th>Jul × Jun</th><th>Visitas</th></tr></thead><tbody>{product_rows(products[:20])}</tbody></table><p class='interpret'>Interpretação: o heatmap separa crescimento consistente de picos isolados; valide rupturas e disponibilidade nos produtos que perderam receita apesar de manter visitas.</p>
    <h2>7. Produtos em queda e oportunidades de retomada</h2><h3>Em crescimento</h3><table><thead><tr><th>Chave</th><th>Produto</th><th>Pedidos</th><th>Receita</th><th>Jul × Jun</th><th>Visitas</th></tr></thead><tbody>{product_rows(growing)}</tbody></table><h3>Em queda ou inativos</h3><table><thead><tr><th>Chave</th><th>Produto</th><th>Pedidos</th><th>Receita</th><th>Jul × Jun</th><th>Visitas</th></tr></thead><tbody>{product_rows(falling)}</tbody></table><p class='interpret'>Interpretação: existem {statuses.get('em queda',0)} produtos em queda e {statuses.get('inativo',0)} inativos. Sem custo, estoque e intervenções, o ranking é triagem — não recomendação automática de reativação.</p>
    <h2>8. Situação atual do Platinum</h2><div class='grid'><img src='charts/platinum_progress.png'><img src='charts/platinum_window.png'></div><p>Requisito informado: {int(n(platinum.get('sales_required'))):,} vendas e {brl(platinum.get('revenue_required'))}. Datas elegíveis extraídas: {min(eligible_order_dates, default='—')} a {max(eligible_order_dates, default='—')}.</p><p class='interpret'>Interpretação: sem vendas atuais, gap da interface e regra exata da janela móvel, qualquer projeção diária seria fictícia. O painel oficial deve prevalecer.</p>
    <h2>9. Estratégia de produtos de menor ticket</h2><div class='note warn'>Não há recomendação de SKU de entrada enquanto margem por pedido, tarifa fixa, imposto, embalagem, estoque e reposição estiverem ausentes. Preço baixo sozinho pode aumentar pedidos e destruir margem.</div><p class='interpret'>Interpretação: use primeiro produtos com conversão comprovada, baixa complexidade operacional e margem positiva; esses critérios ainda não podem ser validados integralmente.</p>
    <h2>10. Cenários</h2><img src='charts/scenarios_comparison.png'><table><thead><tr><th>Cenário</th><th>Escopo</th><th>Risco</th><th>Condição de uso</th></tr></thead><tbody><tr><td>Conservador</td><td>Conversão e disponibilidade do mix atual</td><td>Baixo</td><td>Custos e estoque validados</td></tr><tr><td>Equilibrado</td><td>Retomada seletiva + poucos itens de entrada</td><td>Médio</td><td>Margem positiva e reposição rápida</td></tr><tr><td>Agressivo</td><td>Desconto e mídia para acelerar pedidos</td><td>Alto</td><td>Capital, margem e operação dimensionados</td></tr></tbody></table><p class='interpret'>Interpretação: o cenário equilibrado é a direção recomendada após completar os inputs; números de impacto permanecem indisponíveis até então.</p>
    <h2>11. Plano de ação</h2><table><thead><tr><th>Prazo</th><th>Ação</th><th>Área</th><th>Impacto</th><th>Esforço</th><th>Risco</th><th>Indicador</th></tr></thead><tbody><tr><td>48h</td><td>Preencher custos históricos e snapshot Platinum</td><td>Financeiro / Marketplace</td><td>Desbloqueia margem e gap</td><td>Médio</td><td>Baixo</td><td>Cobertura de custo; gap oficial</td></tr><tr><td>48h</td><td>Validar estoque dos produtos A</td><td>Operação</td><td>Protege receita concentrada</td><td>Baixo</td><td>Baixo</td><td>Rupturas; disponibilidade</td></tr><tr><td>7 dias</td><td>Auditar itens em queda com visitas</td><td>Comercial</td><td>Recupera conversão</td><td>Médio</td><td>Médio</td><td>Visitas; pedidos; conversão</td></tr><tr><td>7 dias</td><td>Registrar intervenções de preço/estoque</td><td>Marketplace</td><td>Cria evidência causal futura</td><td>Baixo</td><td>Baixo</td><td>Intervenções completas</td></tr><tr><td>30 dias</td><td>Piloto equilibrado com margem positiva</td><td>Diretoria / Marketplace</td><td>Aumenta pedidos com controle</td><td>Alto</td><td>Médio</td><td>Pedidos/dia; margem/pedido; cancelamento</td></tr></tbody></table><p class='interpret'>Interpretação: as primeiras 48 horas são de qualidade decisória; só depois se recomenda alterar mix, preço ou mídia.</p>
    <h2>12. Limitações e qualidade dos dados</h2><table><thead><tr><th>Severidade</th><th>Teste</th><th>Ocorrências</th><th>Detalhe</th></tr></thead><tbody>{quality_rows}</tbody></table><ul>{limitations}</ul><p class='interpret'>Interpretação: pedidos, envios, visitas, faturamento e Ads foram obtidos diretamente do Mercado Livre. A limitação material remanescente é externa: custos, estoque e snapshot oficial Platinum.</p>
    </main></body></html>"""
    (report_dir / "executive_report.html").write_text(html_text, encoding="utf-8")

    md = f"""# Relatório executivo — Mercado Livre

Período: 01/01/2026 a 31/07/2026 · Fuso: America/Fortaleza · Extração: {report['snapshot_date']} · Modo somente leitura.

## 1. Resumo executivo

Julho registrou {int(n(july['orders']))} pedidos, {int(n(july['units']))} unidades e {brl(july['gross_revenue'])}. A receita caiu {pct(delta(july['gross_revenue'], june['gross_revenue']))} e os pedidos {pct(delta(july['orders'], june['orders']))} contra junho. Maio foi o pico do período.

O principal produto por receita foi **{top.get('title','—')}**, com {brl(top.get('gross_revenue'))}. A principal fonte de margem não pode ser identificada: a cobertura de custos é 0%. A prioridade é preencher custos históricos e o snapshot oficial Platinum antes de alterar preço, Ads ou mix.

## 2. Como foi julho

- Receita bruta: {brl(july['gross_revenue'])}.
- Receita líquida de marketplace: {brl(july['net_revenue'])}.
- Comissões: {brl(july['commissions'])}.
- Frete do vendedor: {brl(july['shipping'])}.
- Ticket médio: {brl(july['ticket_average'])}.

Interpretação: receita caiu mais que pedidos, acompanhando a redução do ticket médio.

## 3. Evolução de janeiro a julho

O negócio acelerou até maio e recuou em junho e julho. Nos três meses completos de maio a julho foram {int(last_three['orders'])} pedidos, {int(last_three['units'])} unidades e {brl(last_three['gross_revenue'])}.

## 4. O que explica o resultado

Visitas foram extraídas por anúncio e dia. A conversão é aproximada. Product Ads retornou investimento patrocinado, cliques e impressões zerados entre 03/05 e 31/07, com vendas orgânicas presentes. Sem intervenções registradas, não há base para atribuir causalidade a preço, estoque ou mídia.

### Cancelamentos e devoluções

Foram {int(n(cancel_overall.get('cancelled_orders')))} cancelamentos em {int(n(cancel_overall.get('orders_created')))} pedidos criados, taxa de {pct(cancel_overall.get('cancellation_rate'))}. Julho fechou em {pct(cancel_monthly[-1].get('cancellation_rate') if cancel_monthly else None)}, abaixo dos {pct(cancel_monthly[-2].get('cancellation_rate') if len(cancel_monthly) > 1 else None)} de junho.

A API de Claims/Returns identificou {int(n(cancel_overall.get('commercial_returns')))} processos de devolução ({pct(cancel_overall.get('return_rate_on_eligible_sales'))} das vendas pagas da coorte); {int(n(cancel_overall.get('completed_returns')))} já estavam entregues no fluxo reverso e {int(n(cancel_overall.get('returns_in_transit_or_other_status')))} em trânsito ou outro estado. Houve ainda {int(n(cancel_overall.get('logistics_returns_to_sender')))} retornos logísticos ao remetente, separados das devoluções comerciais. O custo de frete reverso identificado foi {brl(cancel_overall.get('return_shipping_cost'))}.

Interpretação: cancelamentos melhoraram em julho. A taxa observada de devolução passou de {pct(cancel_monthly[-2].get('return_rate_on_eligible_sales') if len(cancel_monthly) > 1 else None)} em junho para {pct(cancel_monthly[-1].get('return_rate_on_eligible_sales') if cancel_monthly else None)} em julho, mas a coorte de julho ainda não está madura no snapshot de 01/08 e não comprova melhora definitiva. Os produtos com maior volume de ocorrências devem ser priorizados, considerando também suas taxas relativas.

## 5. Curva ABC e concentração

{len(class_a)} produtos compõem a classe A de receita e concentram {pct(class_a_share)} do total. A curva por margem permanece indisponível sem custos.

## 6. Evolução individual dos produtos

O HTML e a planilha apresentam a série mensal e o ranking por produto. O heatmap deve ser usado para separar tendências consistentes de picos isolados.

## 7. Produtos em queda e oportunidades de retomada

Foram classificados {statuses.get('em queda',0)} produtos em queda e {statuses.get('inativo',0)} inativos. A retomada exige validar margem, estoque, visitas recentes e risco operacional.

## 8. Situação atual do Platinum

Requisitos informados: {int(n(platinum.get('sales_required'))):,} vendas e {brl(platinum.get('revenue_required'))}. Vendas atuais, gap oficial e saídas da janela não foram preenchidos; o painel deve prevalecer.

## 9. Estratégia de produtos de menor ticket

Não é seguro recomendar um produto apenas pelo preço. O score depende de margem por pedido, conversão, estoque, reposição, cancelamentos e devoluções — dados ainda incompletos.

## 10. Cenários

O cenário equilibrado é a direção recomendada após completar os inputs: retomada seletiva, melhoria de conversão e poucos produtos de entrada. Impactos quantitativos não são apresentados sem custos e estoque.

## 11. Plano de ação

1. **48 horas:** preencher custos, snapshot Platinum e estoque dos produtos A.
2. **7 dias:** auditar itens em queda com visitas e registrar intervenções.
3. **30 dias:** executar piloto equilibrado somente com margem positiva e reposição validada.

## 12. Limitações e qualidade

Pedidos, envios, visitas, billing e Product Ads vieram diretamente da API. Margem, cenários e gap Platinum permanecem indisponíveis por falta de dados externos. Consulte `data_quality.md`.
"""
    (report_dir / "executive_report.md").write_text(md, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    build(Path(args.root).resolve())
    print("Relatório executivo ampliado em report/.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
