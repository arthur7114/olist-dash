#!/usr/bin/env node
// Snapshot sanitizado do endpoint somente leitura do dashboard. O endpoint já
// não devolve comprador/endereço; ainda assim, selecionamos apenas campos úteis.
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const url = "https://olist-dash.vercel.app/api/olist/orders?periodo=custom&de=2026-01-01&ate=2026-07-31";
const response = await fetch(url, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`Dashboard retornou HTTP ${response.status}.`);
const payload = await response.json();
if (payload.source !== "real") throw new Error(`Dashboard não retornou dados reais: ${payload.message || "origem desconhecida"}`);

const wantedChannel = (value) => /mercado\s*livre/i.test(String(value || ""));
const orders = (payload.pedidos || [])
  .filter((order) => order.data >= "2026-01-01" && order.data <= "2026-07-31" && wantedChannel(order.canal))
  .map((order) => ({
    id: String(order.id),
    numeroPedido: order.numeroPedido == null ? null : String(order.numeroPedido),
    sku: order.sku == null ? null : String(order.sku),
    produto: order.produto == null ? null : String(order.produto),
    canal: order.canal,
    valorVenda: Number(order.valorVenda || 0),
    valorFrete: Number(order.valorFrete || 0),
    devolucao: Number(order.devolucao || 0),
    taxaComissao: Number(order.taxaComissao || 0),
    custoTotal: Number(order.custoTotal || 0),
    quantidade: Number(order.quantidade || 0),
    statusPagamento: order.statusPagamento,
    data: order.data,
    custoMlReal: Boolean(order.custoMlReal),
    itens: (order.itens || []).map((item) => ({
      sku: item.sku == null ? null : String(item.sku),
      descricao: item.descricao == null ? null : String(item.descricao),
      quantidade: Number(item.quantidade || 0),
      valorUnitario: Number(item.valorUnitario || 0),
      custoUnitario: Number(item.custoUnitario || 0),
    })),
  }))
  .sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id));

const snapshot = {
  source: "dashboard_readonly_api",
  endpoint: url,
  extracted_at: new Date().toISOString(),
  last_sync: payload.lastSync || null,
  period: { requested_from: "2026-01-01", requested_to: "2026-07-31", timezone: "America/Fortaleza" },
  unavailable_sources: ["seller_reputation", "visits", "product_ads", "billing_details", "platinum_official_ui", "historical_listing_state"],
  orders,
};
const output = path.join(root, "data/raw/dashboard/snapshot_2026-08-01.json");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(snapshot, null, 2), "utf8");
console.log(JSON.stringify({ output, orders: orders.length, min_date: orders[0]?.data || null, max_date: orders.at(-1)?.data || null, last_sync: snapshot.last_sync }));
