import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm"
import { getDb } from "./client"
import { orders } from "./schema"
import type { FormaPagamento, Pedido, StatusPagamento } from "@/lib/data"
import { statusPorSituacao } from "@/lib/data"
import type { SyncOrder } from "@/lib/olist-v3"
import { normalizarFormaPagamento } from "@/lib/pagamento"

export async function getOrdersByPeriod(dataInicial: string): Promise<Pedido[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(orders)
    .where(gte(orders.data, dataInicial))
    .orderBy(desc(orders.data))
  return rows.map(rowToPedido)
}

// Pedidos com custo zerado (mas com venda) e detalhe salvo — alvo do recálculo de custos.
// Ordena do mais antigo p/ o mais novo (os antigos é que ficaram sem custo). raw traz o
// detalhe completo da Olist, então dá p/ recalcular o custo sem rebuscar o pedido.
export async function getOrdersMissingCost(limit: number): Promise<Array<{ olistId: string; raw: unknown }>> {
  const db = getDb()
  return db
    .select({ olistId: orders.olistId, raw: orders.raw })
    .from(orders)
    .where(sql`${orders.custoTotal} = 0 and ${orders.valorVenda} > 0 and ${orders.raw} is not null`)
    .orderBy(asc(orders.data))
    .limit(limit)
}

// Atualiza só custo + quantidade de um pedido (usado pelo recálculo).
export async function updateOrderCost(olistId: string, custoTotal: number, quantidade: number): Promise<void> {
  const db = getDb()
  await db
    .update(orders)
    .set({ custoTotal: String(custoTotal), quantidade, updatedAt: new Date() })
    .where(eq(orders.olistId, olistId))
}

// IDs de pedidos já no banco numa janela — usado para o backfill pular o que já foi sincronizado.
export async function getExistingOrderIds(dataInicial: string, dataFinal: string): Promise<Set<string>> {
  const db = getDb()
  const rows = await db
    .select({ id: orders.olistId })
    .from(orders)
    .where(and(gte(orders.data, dataInicial), lte(orders.data, dataFinal)))
  return new Set(rows.map((r) => r.id))
}

function rowToPedido(r: typeof orders.$inferSelect): Pedido {
  return {
    id: r.olistId,
    numeroPedido: r.numeroPedido,
    numeroNF: r.numeroNf,
    sku: r.sku,
    produto: r.produto,
    canal: r.canal,
    vendedor: r.vendedor,
    formaPagamento: normalizarFormaPagamento(r.formaPagamento) as FormaPagamento,
    valorVenda: Number(r.valorVenda),
    valorFrete: Number(r.valorFrete),
    devolucao: Number(r.devolucao),
    taxaComissao: Number(r.taxaComissao),
    custoTotal: Number(r.custoTotal),
    quantidade: Number(r.quantidade),
    statusPagamento: statusPorSituacao(r.situacao, r.statusPagamento as StatusPagamento),
    data: r.data,
  }
}

// Atualiza tudo a partir da linha que chegou no INSERT (excluded.*).
const ordersConflictSet = {
  numeroPedido: sql`excluded.numero_pedido`,
  numeroNf: sql`excluded.numero_nf`,
  sku: sql`excluded.sku`,
  produto: sql`excluded.produto`,
  canal: sql`excluded.canal`,
  vendedor: sql`excluded.vendedor`,
  formaPagamento: sql`excluded.forma_pagamento`,
  statusPagamento: sql`excluded.status_pagamento`,
  valorVenda: sql`excluded.valor_venda`,
  valorFrete: sql`excluded.valor_frete`,
  devolucao: sql`excluded.devolucao`,
  taxaComissao: sql`excluded.taxa_comissao`,
  custoTotal: sql`excluded.custo_total`,
  quantidade: sql`excluded.quantidade`,
  data: sql`excluded.data`,
  situacao: sql`excluded.situacao`,
  detailLevel: sql`excluded.detail_level`,
  raw: sql`excluded.raw`,
  updatedAt: sql`excluded.updated_at`,
}

export async function upsertOrders(items: SyncOrder[]): Promise<number> {
  if (!items.length) return 0
  const db = getDb()
  const now = new Date()
  const rows = items.map(({ pedido, situacao, detailLevel, raw }) => ({
    olistId: pedido.id,
    numeroPedido: pedido.numeroPedido,
    numeroNf: pedido.numeroNF,
    sku: pedido.sku,
    produto: pedido.produto,
    canal: pedido.canal,
    vendedor: pedido.vendedor,
    formaPagamento: pedido.formaPagamento,
    statusPagamento: pedido.statusPagamento,
    valorVenda: String(pedido.valorVenda),
    valorFrete: String(pedido.valorFrete),
    devolucao: String(pedido.devolucao),
    taxaComissao: String(pedido.taxaComissao),
    custoTotal: String(pedido.custoTotal),
    quantidade: pedido.quantidade,
    data: pedido.data,
    situacao: situacao ?? null,
    detailLevel,
    raw: (raw ?? null) as unknown,
    updatedAt: now,
  }))

  const CHUNK = 100
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(orders)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({ target: orders.olistId, set: ordersConflictSet })
  }
  return rows.length
}
