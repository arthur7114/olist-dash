#!/usr/bin/env node
// Exporta apenas campos analíticos do banco do dashboard. Não consulta colunas
// raw, credenciais, compradores, endereços ou qualquer outro dado pessoal.
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { neon } = require("@neondatabase/serverless");

const projectId = "prj_yARLx4IbtfPghr1dBPDSfMeTEHsF";
const teamId = "team_E6qazhWIgbIamEinMwE9FcZh";
const token = process.env.VERCEL_ACCESS_TOKEN;
if (!token) throw new Error("VERCEL_ACCESS_TOKEN não configurado.");

const response = await fetch(
  `https://api.vercel.com/v9/projects/${projectId}/env?decrypt=true&teamId=${teamId}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
if (!response.ok) throw new Error(`Falha ao consultar variáveis na Vercel (${response.status}).`);
const payload = await response.json();
const envs = Object.fromEntries((payload.envs || []).map((entry) => [entry.key, entry.value]));
const databaseUrl = [
  envs.DATABASE_URL,
  envs.oem_DATABASE_URL,
  envs.oem_POSTGRES_URL,
  envs.oem_POSTGRES_PRISMA_URL,
  envs.oem_DATABASE_URL_UNPOOLED,
].find((value) => typeof value === "string" && /^postgres(ql)?:\/\//.test(value));
if (!databaseUrl) throw new Error("DATABASE_URL não encontrada no projeto Vercel.");

const sql = neon(databaseUrl);
const orders = await sql.query(`
  select
    o.olist_id, o.numero_pedido, o.sku, o.produto, o.canal,
    o.valor_venda::float8, o.valor_frete::float8, o.devolucao::float8,
    o.taxa_comissao::float8, o.custo_total::float8, o.quantidade,
    o.data::text, o.situacao, o.status_pagamento,
    coalesce(mc.sale_fee::float8, 0) as ml_sale_fee,
    coalesce(mc.shipping_cost::float8, 0) as ml_shipping_cost,
    mc.listing_type, mc.ml_status
  from orders o
  left join ml_order_costs mc on mc.olist_id = o.olist_id
  where o.data between date '2026-01-01' and date '2026-07-31'
    and (lower(o.canal) like '%mercado%livre%' or lower(o.canal) like '%mercadolivre%')
  order by o.data, o.olist_id
`);
const orderItems = await sql.query(`
  select
    oi.id, oi.olist_id, oi.sku, oi.produto_olist_id, oi.descricao,
    oi.quantidade, oi.valor_unitario::float8, oi.custo_unitario::float8,
    oi.data::text
  from order_items oi
  join orders o on o.olist_id = oi.olist_id
  where oi.data between date '2026-01-01' and date '2026-07-31'
    and (lower(o.canal) like '%mercado%livre%' or lower(o.canal) like '%mercadolivre%')
  order by oi.data, oi.olist_id, oi.id
`);
const productCosts = await sql.query(`
  select ref, custo::float8, updated_at::text
  from product_costs
  order by ref
`);
const snapshot = {
  source: "vercel_database",
  extracted_at: new Date().toISOString(),
  period: { from: "2026-01-01", to: "2026-07-31", timezone: "America/Fortaleza" },
  orders,
  order_items: orderItems,
  product_costs: productCosts,
  unavailable_sources: ["seller_reputation", "visits", "product_ads", "billing_details", "platinum_official_ui"],
};

const root = path.resolve(process.argv[2] || ".");
const output = path.join(root, "data/raw/database/snapshot_2026-08-01.json");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(snapshot, null, 2), "utf8");
console.log(JSON.stringify({ output, orders: orders.length, order_items: orderItems.length, product_costs: productCosts.length }));
