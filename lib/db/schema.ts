import { pgTable, text, integer, numeric, date, timestamp, jsonb, index } from "drizzle-orm/pg-core"

// Pedidos sincronizados da Olist. Espelha o tipo `Pedido` (lib/data.ts) + bookkeeping.
export const orders = pgTable(
  "orders",
  {
    olistId: text("olist_id").primaryKey(),
    numeroPedido: text("numero_pedido").notNull().default(""),
    numeroNf: text("numero_nf").notNull().default("-"),
    sku: text("sku").notNull().default(""),
    produto: text("produto").notNull().default(""),
    canal: text("canal").notNull().default(""),
    vendedor: text("vendedor").notNull().default(""),
    formaPagamento: text("forma_pagamento").notNull().default("Não informado"),
    statusPagamento: text("status_pagamento").notNull().default("Pendente"),
    valorVenda: numeric("valor_venda", { precision: 14, scale: 2 }).notNull().default("0"),
    valorFrete: numeric("valor_frete", { precision: 14, scale: 2 }).notNull().default("0"),
    devolucao: numeric("devolucao", { precision: 14, scale: 2 }).notNull().default("0"),
    taxaComissao: numeric("taxa_comissao", { precision: 14, scale: 2 }).notNull().default("0"),
    custoTotal: numeric("custo_total", { precision: 14, scale: 2 }).notNull().default("0"),
    quantidade: integer("quantidade").notNull().default(1),
    data: date("data").notNull(),
    situacao: integer("situacao"),
    detailLevel: text("detail_level").notNull().default("summary"),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dataIdx: index("orders_data_idx").on(t.data),
  }),
)

// Itens de pedido, extraídos do JSON `raw` de orders. 1 linha por item.
// `data` e denormalizada do pedido p/ filtrar por período sem join.
export const orderItems = pgTable(
  "order_items",
  {
    id: text("id").primaryKey(), // `${olistId}:${indice}`
    olistId: text("olist_id").notNull(),
    sku: text("sku").notNull().default("sem-sku"),
    produtoOlistId: integer("produto_olist_id"),
    descricao: text("descricao").notNull().default(""),
    quantidade: integer("quantidade").notNull().default(1),
    valorUnitario: numeric("valor_unitario", { precision: 14, scale: 2 }).notNull().default("0"),
    custoUnitario: numeric("custo_unitario", { precision: 14, scale: 2 }).notNull().default("0"),
    data: date("data").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    olistIdx: index("order_items_olist_idx").on(t.olistId),
    dataIdx: index("order_items_data_idx").on(t.data),
    skuIdx: index("order_items_sku_idx").on(t.sku),
  }),
)

// Custos reais por pedido vindos da API do Mercado Livre (sale_fee + frete do vendedor).
// Join com orders via olist_id; ml_order_id = raw.ecommerce.numeroPedidoEcommerce.
export const mlOrderCosts = pgTable("ml_order_costs", {
  mlOrderId: text("ml_order_id").primaryKey(),
  olistId: text("olist_id").notNull().unique(),
  saleFee: numeric("sale_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  shippingCost: numeric("shipping_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  listingType: text("listing_type"),
  mlStatus: text("ml_status"),
  raw: jsonb("raw"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
})

// Cache de custo de produto, persistente entre cold starts. ref = "id:123" ou "sku:ABC".
export const productCosts = pgTable("product_costs", {
  ref: text("ref").primaryKey(),
  custo: numeric("custo", { precision: 14, scale: 2 }).notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

// Estado do sync (1 linha, id=1).
export const syncState = pgTable("sync_state", {
  id: integer("id").primaryKey().default(1),
  cursorData: date("cursor_data"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  status: text("status"),
  lastError: text("last_error"),
  ordersSynced: integer("orders_synced").notNull().default(0),
})

// Credencial OAuth da conta Olist (1 linha, id=1). Tokens cifrados em repouso.
export const olistCredentials = pgTable("olist_credentials", {
  id: integer("id").primaryKey().default(1),
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token"),
  accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})
