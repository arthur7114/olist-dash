#!/usr/bin/env node
// Gera a planilha final com gráficos nativos. Requer @oai/artifact-tool,
// conforme o runtime de artefatos do Codex; não envia dados a terceiros.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let artifact;
try {
  artifact = require("@oai/artifact-tool");
} catch {
  throw new Error("@oai/artifact-tool não encontrado. Crie scripts/mercado_livre_analysis/node_modules como link para o node_modules informado pelo runtime Codex.");
}
const { Workbook, SpreadsheetFile } = artifact;
const root = path.resolve(process.argv[2] || ".");
const reportDir = path.join(root, "report");
const analysis = JSON.parse(await fs.readFile(path.join(reportDir, "analysis.json"), "utf8"));
let cancellations = {};
try {
  cancellations = JSON.parse(await fs.readFile(path.join(reportDir, "cancellations_returns.json"), "utf8"));
} catch {
  cancellations = {};
}

const palette = { navy: "#0F3D4C", teal: "#1F7A8C", amber: "#D97706", green: "#2F855A", gray: "#64748B", light: "#F1F5F9" };
const money = '"R$" #,##0.00;[Red]("R$" #,##0.00);-';
const percent = "0.0%;[Red](0.0%);-";
const col = (n) => { let s=""; for (; n>0; n=Math.floor((n-1)/26)) s=String.fromCharCode(65+(n-1)%26)+s; return s; };
const asNum = (x) => x == null || x === "" ? null : Number(x);

function setTitle(sheet, range, title, subtitle) {
  sheet.getRange(range).merge();
  sheet.getRange(range).values = [[title]];
  sheet.getRange(range).format = { fill: palette.navy, font: { bold: true, color: "#FFFFFF", size: 18 }, horizontalAlignment: "left", verticalAlignment: "center" };
  const titleRow = Number(range.match(/\d+/)[0]);
  sheet.getRange(`A${titleRow + 1}:L${titleRow + 1}`).merge();
  sheet.getRange(`A${titleRow + 1}`).values = [[subtitle]];
  sheet.getRange(`A${titleRow + 1}`).format = { font: { color: palette.gray, italic: true } };
}
function writeTable(sheet, startRow, headers, rows, numberFormats = {}) {
  const end = startRow + Math.max(rows.length, 1);
  sheet.getRange(`A${startRow}:${col(headers.length)}${startRow}`).values = [headers];
  sheet.getRange(`A${startRow}:${col(headers.length)}${startRow}`).format = { fill: palette.navy, font: { bold: true, color: "#FFFFFF" }, wrapText: true };
  if (rows.length) sheet.getRange(`A${startRow + 1}:${col(headers.length)}${end}`).values = rows;
  for (const [index, format] of Object.entries(numberFormats)) sheet.getRange(`${col(Number(index) + 1)}${startRow + 1}:${col(Number(index) + 1)}${end}`).format.numberFormat = format;
  sheet.getRange(`A${startRow}:${col(headers.length)}${end}`).format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };
  return { startRow, endRow: end };
}
function finish(sheet, used) {
  sheet.showGridLines = false;
  sheet.getUsedRange().format.autofitColumns();
  sheet.getUsedRange().format.autofitRows();
  sheet.getUsedRange().format.wrapText = true;
  sheet.freezePanes.freezeRows(3);
}

const wb = Workbook.create();
const summary = wb.worksheets.add("Resumo executivo");
const monthlySheet = wb.worksheets.add("Desempenho mensal");
const cancellationsSheet = wb.worksheets.add("Cancelamentos e devoluções");
const productsSheet = wb.worksheets.add("Desempenho por produto");
const abcSheet = wb.worksheets.add("Curvas ABC");
const oppSheet = wb.worksheets.add("Oportunidades");
const platinumSheet = wb.worksheets.add("Platinum");
const scenarioSheet = wb.worksheets.add("Cenários");
const qualitySheet = wb.worksheets.add("Qualidade");

setTitle(summary, "A1:L1", "Mercado Livre — Resumo executivo", `Período 01/01/2026 a 31/07/2026 · Extração ${analysis.snapshot_date} · America/Fortaleza`);
const july = analysis.july || {};
const cards = [["Receita bruta", asNum(july.gross_revenue)], ["Pedidos", asNum(july.orders)], ["Unidades", asNum(july.units)], ["Margem", asNum(july.margin)], ["Margem %", asNum(july.margin_pct)], ["Ticket médio", asNum(july.ticket_average)]];
cards.forEach((card, i) => {
  const start = col(i * 2 + 1), end = col(i * 2 + 2);
  summary.getRange(`${start}4:${end}4`).merge(); summary.getRange(`${start}4`).values = [[card[0]]];
  summary.getRange(`${start}5:${end}6`).merge(); summary.getRange(`${start}5`).values = [[card[1]]];
  summary.getRange(`${start}4:${end}6`).format = { fill: palette.light, font: { bold: true, color: palette.navy }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: "#CBD5E1" } };
  summary.getRange(`${start}5`).format.numberFormat = i === 4 ? percent : (i === 0 || i === 3 || i === 5 ? money : "#,##0");
});
summary.getRange("A9:H9").merge(); summary.getRange("A9").values = [["Leitura executiva"]]; summary.getRange("A9").format = { fill: palette.navy, font: { bold: true, color: "#FFFFFF" } };
const primary = analysis.products?.[0];
summary.getRange("A10:H13").values = [["Principal fonte de receita", primary?.title || "Sem dados"], ["Principal fonte de margem", primary?.margin != null ? primary.title : "Indisponível: custos não cadastrados"], ["Gap Platinum (painel)", analysis.platinum?.sales_gap_official ?? "Não informado"], ["Ação prioritária", "Cadastrar custos históricos e validar o gap oficial no painel antes de alterar preço, Ads ou estoque."]];
summary.getRange("A10:A13").format = { font: { bold: true, color: palette.navy } };
finish(summary);

setTitle(monthlySheet, "A1:K1", "Desempenho mensal", "Receita, pedidos, unidades e margem por mês");
const monthlyHeaders = ["Mês", "Pedidos", "Unidades", "Receita bruta", "Receita líquida ML", "Margem", "Margem %", "Ticket médio", "Preço médio", "Unid./pedido"];
const monthlyRows = (analysis.monthly || []).map(x => x.data_available === false
  ? [x.month, null, null, null, null, null, null, null, null, null]
  : [x.month + (x.complete_month === false ? " *" : ""), asNum(x.orders), asNum(x.units), asNum(x.gross_revenue), asNum(x.net_revenue), asNum(x.margin), asNum(x.margin_pct), asNum(x.ticket_average), asNum(x.unit_price_average), asNum(x.units_per_order)]);
const monthlyTable = writeTable(monthlySheet, 4, monthlyHeaders, monthlyRows, { 1: "#,##0", 2: "#,##0", 3: money, 4: money, 5: money, 6: percent, 7: money, 8: money, 9: "0.0" });
const categoryFormula = `'Desempenho mensal'!$A$5:$A$${monthlyTable.endRow}`;
const revenueChart = monthlySheet.charts.add("line", { chartType: "line", title: "Receita bruta (R$)", hasLegend: false });
const revenueSeries = revenueChart.series.add("Receita bruta");
revenueSeries.categoryFormula = categoryFormula;
revenueSeries.formula = `'Desempenho mensal'!$D$5:$D$${monthlyTable.endRow}`;
revenueSeries.line = { color: palette.green, width: 2.5 };
revenueChart.setPosition("L4", "T18");
revenueChart.xAxis = { axisType: "textAxis" };

const volumeChart = monthlySheet.charts.add("line", { chartType: "line", title: "Pedidos e unidades", hasLegend: true });
for (const [name, column, color] of [["Pedidos", "B", palette.teal], ["Unidades", "C", palette.amber]]) {
  const series = volumeChart.series.add(name);
  series.categoryFormula = categoryFormula;
  series.formula = `'Desempenho mensal'!$${column}$5:$${column}$${monthlyTable.endRow}`;
  series.line = { color, width: 2.5 };
}
volumeChart.setPosition("L20", "T34");
volumeChart.xAxis = { axisType: "textAxis" };

if (monthlyRows.some(row => row[5] != null)) {
  const marginChart = monthlySheet.charts.add("line", { chartType: "line", title: "Margem de contribuição", hasLegend: false });
  const marginSeries = marginChart.series.add("Margem");
  marginSeries.categoryFormula = categoryFormula;
  marginSeries.formula = `'Desempenho mensal'!$F$5:$F$${monthlyTable.endRow}`;
  marginSeries.line = { color: palette.navy, width: 2.5 };
  marginChart.setPosition("L36", "T50");
  marginChart.xAxis = { axisType: "textAxis" };
} else {
  monthlySheet.getRange("L36:T39").merge();
  monthlySheet.getRange("L36").values = [["Margem indisponível: preencha os custos históricos por produto para habilitar este gráfico."]];
  monthlySheet.getRange("L36:T39").format = { fill: "#FFF7ED", font: { color: "#9A3412", italic: true }, wrapText: true, verticalAlignment: "center" };
}
finish(monthlySheet);

setTitle(cancellationsSheet, "A1:L1", "Cancelamentos e devoluções", "Coorte por mês de criação do pedido · Claims/Returns consultados diretamente no Mercado Livre");
const cancellationOverall = cancellations.overall || {};
const cancellationCards = [
  ["Cancelamentos", asNum(cancellationOverall.cancelled_orders), "#,##0"],
  ["Taxa cancelamento", asNum(cancellationOverall.cancellation_rate), percent],
  ["Devoluções iniciadas", asNum(cancellationOverall.commercial_returns), "#,##0"],
  ["Taxa devolução", asNum(cancellationOverall.return_rate_on_eligible_sales), percent],
  ["Devoluções concluídas", asNum(cancellationOverall.completed_returns), "#,##0"],
  ["Retornos logísticos", asNum(cancellationOverall.logistics_returns_to_sender), "#,##0"],
];
cancellationCards.forEach((card, i) => {
  const start = col(i * 2 + 1), end = col(i * 2 + 2);
  cancellationsSheet.getRange(`${start}4:${end}4`).merge(); cancellationsSheet.getRange(`${start}4`).values = [[card[0]]];
  cancellationsSheet.getRange(`${start}5:${end}6`).merge(); cancellationsSheet.getRange(`${start}5`).values = [[card[1]]];
  cancellationsSheet.getRange(`${start}4:${end}6`).format = { fill: palette.light, font: { bold: true, color: palette.navy }, horizontalAlignment: "center", verticalAlignment: "center", borders: { preset: "outside", style: "thin", color: "#CBD5E1" } };
  cancellationsSheet.getRange(`${start}5`).format.numberFormat = card[2];
});
const cancellationRows = (cancellations.monthly || []).map(x => [x.month, asNum(x.orders_created), asNum(x.cancelled_orders), asNum(x.cancellation_rate), asNum(x.cancelled_gross_value), asNum(x.commercial_returns), asNum(x.completed_returns), asNum(x.return_rate_on_eligible_sales), asNum(x.logistics_returns_to_sender)]);
const cancellationTable = writeTable(cancellationsSheet, 9, ["Mês", "Pedidos criados", "Cancelados", "Taxa cancel.", "Valor bruto cancelado", "Devoluções", "Concluídas", "Taxa devol.", "Retornos logísticos"], cancellationRows, { 1: "#,##0", 2: "#,##0", 3: percent, 4: money, 5: "#,##0", 6: "#,##0", 7: percent, 8: "#,##0" });
cancellationsSheet.getRange(`D10:D${cancellationTable.endRow}`).conditionalFormats.add("cellIs", { operator: "greaterThanOrEqual", formula: 0.12, format: { fill: "#FEE2E2", font: { color: "#B91C1C", bold: true } } });
cancellationsSheet.getRange(`H10:H${cancellationTable.endRow}`).conditionalFormats.add("cellIs", { operator: "greaterThanOrEqual", formula: 0.05, format: { fill: "#FFF7ED", font: { color: "#9A3412", bold: true } } });
const cancelCategoryFormula = `'Cancelamentos e devoluções'!$A$10:$A$${cancellationTable.endRow}`;
const countChart = cancellationsSheet.charts.add("line", { chartType: "line", title: "Ocorrências mensais", hasLegend: true });
for (const [name, column, color] of [["Cancelamentos", "C", "#C2413B"], ["Devoluções", "F", palette.teal], ["Retornos logísticos", "I", palette.amber]]) {
  const series = countChart.series.add(name); series.categoryFormula = cancelCategoryFormula; series.formula = `'Cancelamentos e devoluções'!$${column}$10:$${column}$${cancellationTable.endRow}`; series.line = { color, width: 2.5 };
}
countChart.setPosition("N4", "V18"); countChart.xAxis = { axisType: "textAxis" }; countChart.yAxis = { numberFormatCode: "#,##0" };
const rateChart = cancellationsSheet.charts.add("line", { chartType: "line", title: "Taxas mensais", hasLegend: true });
for (const [name, column, color] of [["Taxa cancelamento", "D", "#C2413B"], ["Taxa devolução", "H", palette.teal]]) {
  const series = rateChart.series.add(name); series.categoryFormula = cancelCategoryFormula; series.formula = `'Cancelamentos e devoluções'!$${column}$10:$${column}$${cancellationTable.endRow}`; series.line = { color, width: 2.5 };
}
rateChart.setPosition("N20", "V34"); rateChart.xAxis = { axisType: "textAxis" }; rateChart.yAxis = { numberFormatCode: "0.0%" };
const causeLabels = { buyer: "Comprador", seller: "Vendedor", logistics: "Logística", mercado_livre_or_mediation: "Mediação / Mercado Livre", other_or_unidentified: "Outros / não identificado" };
const causeRows = Object.entries(cancellations.cancellation_causes || {}).map(([key, value]) => [causeLabels[key] || key, asNum(value)]);
writeTable(cancellationsSheet, 19, ["Origem identificada", "Cancelamentos"], causeRows, { 1: "#,##0" });
const cancellationProducts = (cancellations.top_products || []).slice(0, 20).map(x => [x.product_key, x.title, asNum(x.orders_created), asNum(x.cancelled_orders), asNum(x.cancellation_rate), asNum(x.commercial_returns), asNum(x.return_rate_on_eligible_sales), asNum(x.cancelled_value)]);
writeTable(cancellationsSheet, 26, ["Chave", "Produto", "Pedidos", "Cancelados", "Taxa cancel.", "Devoluções", "Taxa devol.", "Valor cancelado"], cancellationProducts, { 2: "#,##0", 3: "#,##0", 4: percent, 5: "#,##0", 6: percent, 7: money });
cancellationsSheet.getRange("A49:J50").merge();
cancellationsSheet.getRange("A49").values = [["Fontes: https://developers.mercadolivre.com.br/en_us/tools/working-with-claims · https://developers.mercadolivre.com.br/pt_br/recurso-visits/gerenciar-devolucoes"]];
cancellationsSheet.getRange("A49:J50").format = { font: { color: palette.gray, italic: true }, wrapText: true };
cancellationsSheet.getRange("A51:L52").merge();
cancellationsSheet.getRange("A51").values = [["Atenção: a coorte de julho ainda não está madura no snapshot de 01/08/2026; sua taxa de devolução sofre censura à direita e não deve ser comparada como resultado definitivo."]];
cancellationsSheet.getRange("A51:L52").format = { fill: "#FFF7ED", font: { color: "#9A3412", italic: true }, wrapText: true, verticalAlignment: "center" };
finish(cancellationsSheet);

setTitle(productsSheet, "A1:N1", "Desempenho por produto", "Margem fica vazia quando não existe custo histórico válido");
const productHeaders = ["Chave", "Produto", "Pedidos", "Unidades", "Receita bruta", "Receita líquida", "Margem", "Margem %", "Preço médio", "Visitas", "Conversão aprox.", "Jul. x Jun.", "Jul. x média", "Classificação"];
const productRows = (analysis.products || []).map(x => [x.product_key, x.title, asNum(x.orders), asNum(x.units), asNum(x.gross_revenue), asNum(x.net_revenue), asNum(x.margin), asNum(x.margin_pct), asNum(x.average_price), asNum(x.visits), asNum(x.conversion_approx), asNum(x.july_vs_june), asNum(x.july_vs_prior_avg), x.status]);
writeTable(productsSheet, 4, productHeaders, productRows, { 2: "#,##0", 3: "#,##0", 4: money, 5: money, 6: money, 7: percent, 8: money, 9: "#,##0", 10: percent, 11: percent, 12: percent });
finish(productsSheet);

setTitle(abcSheet, "A1:H1", "Curvas ABC", "Classe A até 80%, B até 95% e C até 100% do indicador acumulado");
let abcRow = 4;
for (const [metric, label] of [["gross_revenue", "Receita bruta"], ["orders", "Pedidos"], ["units", "Unidades"], ["margin", "Margem de contribuição"]]) {
  abcSheet.getRange(`A${abcRow}:F${abcRow}`).merge(); abcSheet.getRange(`A${abcRow}`).values = [[label]]; abcSheet.getRange(`A${abcRow}`).format = { fill: palette.teal, font: { bold: true, color: "#FFFFFF" } };
  abcRow += 1;
  const rows = (analysis.abc?.[metric] || []).map(x => [x.product_key, x.title, x.class, asNum(x.value), asNum(x.share), asNum(x.cumulative_share)]);
  const end = writeTable(abcSheet, abcRow, ["Chave", "Produto", "Classe", "Valor", "Participação", "Acumulado"], rows, { 3: metric === "orders" || metric === "units" ? "#,##0" : money, 4: percent, 5: percent });
  abcRow = end.endRow + 3;
}
finish(abcSheet);

setTitle(oppSheet, "A1:J1", "Oportunidades de retomada", "Ranking só deve ser usado após custos, estoque e intervenções serem preenchidos");
const opportunities = (analysis.products || []).filter(x => x.status === "em queda" || x.status === "inativo").map(x => [x.product_key, x.title, x.last_month_with_sale, asNum(x.gross_revenue), asNum(x.orders), asNum(x.margin), x.status, "Validar ruptura, preço, Ads e estoque", "Médio", "Priorizar após validar margem"]);
writeTable(oppSheet, 4, ["Chave", "Produto", "Último mês", "Receita histórica", "Pedidos", "Margem", "Motivo observado", "Evidências a validar", "Risco", "Ação"], opportunities, { 3: money, 4: "#,##0", 5: money });
finish(oppSheet);

setTitle(platinumSheet, "A1:H1", "MercadoLíder Platinum", "Dados do painel oficial prevalecem sobre os cálculos do modelo");
const p = analysis.platinum || {};
writeTable(platinumSheet, 4, ["Indicador", "Valor"], [["Snapshot", p.snapshot_date], ["Vendas atuais elegíveis", p.sales_current], ["Vendas necessárias", p.sales_required], ["Gap oficial de vendas", p.sales_gap_official], ["Faturamento atual elegível", p.revenue_current], ["Faturamento necessário", p.revenue_required], ["Gap oficial de faturamento", p.revenue_gap_official], ["Vendas/dia (30 dias)", p.estimated_daily_sales_needed_30d], ["Faturamento/dia (30 dias)", p.estimated_daily_revenue_needed_30d], ["Requisitos de qualidade", p.quality_requirements_met]]);
platinumSheet.getRange("B6:B8").format.numberFormat = "#,##0";
platinumSheet.getRange("B9:B11").format.numberFormat = money;
platinumSheet.getRange("B12").format.numberFormat = "0.0";
platinumSheet.getRange("B13").format.numberFormat = money;
finish(platinumSheet);

setTitle(scenarioSheet, "A1:J1", "Cenários", "Cenários devem ser atualizados com estoque, reposição e custos completos");
writeTable(scenarioSheet, 4, ["Cenário", "Pedidos adicionais", "Receita adicional", "Margem adicional", "Ticket médio", "Ads", "Estoque", "Capital", "Risco", "Prazo"], [["Conservador", null, null, null, null, null, null, null, "Não calculado sem inputs", "—"], ["Equilibrado", null, null, null, null, null, null, null, "Não calculado sem inputs", "—"], ["Agressivo", null, null, null, null, null, null, null, "Não calculado sem inputs", "—"]], { 1: "#,##0", 2: money, 3: money, 4: money, 5: money, 6: "#,##0", 7: money });
finish(scenarioSheet);

setTitle(qualitySheet, "A1:H1", "Qualidade dos dados", "Falhas precisam ser resolvidas antes de decisões de preço, Ads ou meta Platinum");
writeTable(qualitySheet, 4, ["Severidade", "Teste", "Ocorrências", "Detalhe"], (analysis.quality || []).map(x => [x.severity, x.check, asNum(x.count), x.detail]), { 2: "#,##0" });
qualitySheet.getRange(`A5:D${4 + (analysis.quality || []).length}`).conditionalFormats.addCustom('=AND($A5="error",$C5>0)', { fill: "#FEE2E2", font: { color: "#B91C1C", bold: true } });
finish(qualitySheet);

const checks = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula error scan" });
if (checks.ndjson && !checks.ndjson.includes('"count":0')) console.warn(checks.ndjson);
const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(path.join(reportDir, "mercado_livre_analysis.xlsx"));
console.log("Planilha criada em report/mercado_livre_analysis.xlsx");
