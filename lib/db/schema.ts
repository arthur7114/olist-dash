import { pgTable, text, integer, numeric, date, timestamp, jsonb, index, primaryKey } from "drizzle-orm/pg-core"

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
    valorNota: numeric("valor_nota", { precision: 14, scale: 2 }),
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

// Conciliação Mercado Pago → Olist: liberação do dinheiro (money_release) por
// pedido ML e estado da baixa no contas a receber. 1 linha por pedido Olist;
// é o que torna o job idempotente (não rebaixa o que já foi baixado).
export const mpReleases = pgTable(
  "mp_releases",
  {
    olistId: text("olist_id").primaryKey(),
    mlOrderId: text("ml_order_id").notNull(),
    releaseStatus: text("release_status").notNull().default("unknown"), // released | pending | no_payments | not_found
    releaseDate: timestamp("release_date", { withTimezone: true }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    receivableId: integer("receivable_id"),
    baixaStatus: text("baixa_status").notNull().default("pending"), // pending | done | already_paid | receivable_not_found | error
    baixaAt: timestamp("baixa_at", { withTimezone: true }),
    lastError: text("last_error"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("mp_releases_status_idx").on(t.releaseStatus, t.baixaStatus),
  }),
)

// Agregado mensal direto do Mercado Livre para a visão Evolução de produtos.
// Mantém as duas bases lado a lado para a alternância ser instantânea no cliente.
export const mlProductMonthlyMetrics = pgTable(
  "ml_product_monthly_metrics",
  {
    month: date("month").notNull(),
    productKey: text("product_key").notNull(),
    title: text("title").notNull().default(""),
    itemIds: jsonb("item_ids").$type<string[]>().notNull().default([]),
    createdOrders: integer("created_orders").notNull().default(0),
    createdUnits: integer("created_units").notNull().default(0),
    createdRevenue: numeric("created_revenue", { precision: 16, scale: 2 }).notNull().default("0"),
    paidOrders: integer("paid_orders").notNull().default(0),
    paidUnits: integer("paid_units").notNull().default(0),
    paidRevenue: numeric("paid_revenue", { precision: 16, scale: 2 }).notNull().default("0"),
    visits: integer("visits"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.month, t.productKey] }),
    monthIdx: index("ml_product_monthly_metrics_month_idx").on(t.month),
  }),
)

export const mlProductEvolutionSyncState = pgTable("ml_product_evolution_sync_state", {
  id: integer("id").primaryKey().default(1),
  status: text("status").notNull().default("idle"),
  cursorMonth: text("cursor_month"),
  coveredMonths: jsonb("covered_months").$type<string[]>().notNull().default([]),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
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

// Catálogo comercial do Mercado Livre usado pela calculadora e pela extensão.
export const mlItems = pgTable(
  "ml_items",
  {
    itemId: text("item_id").primaryKey(),
    sellerSku: text("seller_sku"),
    title: text("title").notNull().default(""),
    categoryId: text("category_id"),
    listingTypeId: text("listing_type_id"),
    currencyId: text("currency_id").notNull().default("BRL"),
    currentPrice: numeric("current_price", { precision: 16, scale: 2 }),
    status: text("status").notNull().default("unknown"),
    shippingMode: text("shipping_mode"),
    logisticType: text("logistic_type"),
    freeShipping: integer("free_shipping").notNull().default(0),
    raw: jsonb("raw"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    skuIdx: index("ml_items_seller_sku_idx").on(t.sellerSku),
    statusIdx: index("ml_items_status_idx").on(t.status),
  }),
)

export const mlPromotions = pgTable(
  "ml_promotions",
  {
    key: text("key").primaryKey(),
    itemId: text("item_id").notNull(),
    promotionId: text("promotion_id").notNull(),
    offerId: text("offer_id"),
    type: text("type").notNull(),
    status: text("status").notNull().default("unknown"),
    name: text("name").notNull().default(""),
    originalPrice: numeric("original_price", { precision: 16, scale: 2 }),
    candidatePrice: numeric("candidate_price", { precision: 16, scale: 2 }),
    minPrice: numeric("min_price", { precision: 16, scale: 2 }),
    maxPrice: numeric("max_price", { precision: 16, scale: 2 }),
    suggestedPrice: numeric("suggested_price", { precision: 16, scale: 2 }),
    feeReduction: numeric("fee_reduction", { precision: 16, scale: 2 }).notNull().default("0"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    raw: jsonb("raw"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    itemIdx: index("ml_promotions_item_id_idx").on(t.itemId),
    statusIdx: index("ml_promotions_status_idx").on(t.status),
    syncedIdx: index("ml_promotions_synced_at_idx").on(t.syncedAt),
  }),
)

export const pricingSettings = pgTable("pricing_settings", {
  id: integer("id").primaryKey().default(1),
  taxRateBps: integer("tax_rate_bps"),
  adsRateBps: integer("ads_rate_bps").notNull().default(0),
  fixedCost: numeric("fixed_cost", { precision: 16, scale: 2 }).notNull().default("0"),
  minimumMarginBps: integer("minimum_margin_bps"),
  targetMarginBps: integer("target_margin_bps"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const pricingOverrides = pgTable("pricing_overrides", {
  key: text("key").primaryKey(),
  scope: text("scope").notNull().default("item"),
  itemId: text("item_id"),
  sellerSku: text("seller_sku"),
  productCost: numeric("product_cost", { precision: 16, scale: 2 }),
  shippingCost: numeric("shipping_cost", { precision: 16, scale: 2 }),
  taxRateBps: integer("tax_rate_bps"),
  adsRateBps: integer("ads_rate_bps"),
  fixedCost: numeric("fixed_cost", { precision: 16, scale: 2 }),
  minimumMarginBps: integer("minimum_margin_bps"),
  targetMarginBps: integer("target_margin_bps"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const mlCommercialSyncState = pgTable("ml_commercial_sync_state", {
  id: integer("id").primaryKey().default(1),
  status: text("status").notNull().default("idle"),
  cursor: text("cursor"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
  itemsSynced: integer("items_synced").notNull().default(0),
  promotionsSynced: integer("promotions_synced").notNull().default(0),
})
