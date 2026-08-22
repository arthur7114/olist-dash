import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm"
import { getDb } from "./client"
import { mlOrderCosts, orders } from "./schema"
import type { BaseValor, FormaPagamento, Pedido, StatusPagamento } from "@/lib/data"
import { statusPorSituacao } from "@/lib/data"
import type { SyncOrder } from "@/lib/olist-v3"
import { normalizarFormaPagamento } from "@/lib/pagamento"
import type { ReconcileRow } from "@/lib/reconcile"
import { replaceOrderItems } from "./orderItems"

export async function getOrdersByPeriod(dataInicial: string, baseValor: BaseValor = "venda"): Promise<Pedido[]> {
  const db = getDb()
  const dataBase = baseValor === "nota" ? orders.dataNota : orders.data
  const rows = await db
    .select({ order: orders, mlSaleFee: mlOrderCosts.saleFee, mlShipping: mlOrderCosts.shippingCost })
    .from(orders)
    .leftJoin(mlOrderCosts, eq(mlOrderCosts.olistId, orders.olistId))
    .where(gte(dataBase, dataInicial))
    .orderBy(desc(dataBase))
  return rows.map((r) => rowToPedido(r.order, r.mlSaleFee, r.mlShipping))
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

// Pedidos ainda sem valor/data da NF, mas cujo detalhe salvo referencia uma nota.
export async function getOrdersMissingNotaValue(
  limit: number,
): Promise<Array<{ olistId: string; data: string; raw: unknown }>> {
  const db = getDb()
  return db
    .select({ olistId: orders.olistId, data: orders.data, raw: orders.raw })
    .from(orders)
    .where(sql`(${orders.valorNota} is null or ${orders.dataNota} is null)
      and ${orders.raw} is not null
      and ${orders.raw}->>'idNotaFiscal' is not null`)
    .orderBy(asc(orders.data))
    .limit(limit)
}

export async function updateOrderNotaFacts(
  olistId: string,
  valorNota: number,
  dataNota: string,
): Promise<void> {
  const db = getDb()
  await db
    .update(orders)
    .set({ valorNota: String(valorNota), dataNota, updatedAt: new Date() })
    .where(eq(orders.olistId, olistId))
}

export async function clearOrderNotaFacts(olistId: string): Promise<void> {
  const db = getDb()
  await db
    .update(orders)
    .set({ valorNota: null, dataNota: null, updatedAt: new Date() })
    .where(eq(orders.olistId, olistId))
}

// Pedidos de uma janela com o detalhe cru, para a reconciliação dash × Olist.
// Traz `raw` porque é lá que estão os outros totais do pedido (produtos, total,
// frete, desconto) contra os quais a base do dash é comparada.
export async function getOrdersForReconcile(
  dataInicial: string,
  dataFinal: string,
): Promise<ReconcileRow[]> {
  const db = getDb()
  const rows = await db
    .select({
      olistId: orders.olistId,
      data: orders.data,
      situacao: orders.situacao,
      valorVenda: orders.valorVenda,
      valorNota: orders.valorNota,
      updatedAt: orders.updatedAt,
      raw: orders.raw,
    })
    .from(orders)
    .where(and(gte(orders.data, dataInicial), lte(orders.data, dataFinal)))
    .orderBy(desc(orders.data))
  return rows.map((r) => ({
    olistId: r.olistId,
    data: r.data,
    situacao: r.situacao,
    valorVenda: Number(r.valorVenda),
    valorNota: r.valorNota == null ? null : Number(r.valorNota),
    updatedAt: r.updatedAt.toISOString(),
    raw: r.raw,
  }))
}

// Pedidos que o backfill pode pular nesta execução. Pular por "já existe no banco"
// congelava o pedido no estado que ele tinha ~48h após a criação (a janela recente é
// curta): a NF sai depois e nunca era gravada, a situação parava em "Em aberto", e
// mudanças de valor/cancelamento ficavam invisíveis.
//
// Duas razões para pular:
//   1. LIQUIDADO — não há mais o que buscar na Olist (ver pedidoLiquidado em reconcile.ts):
//      cancelado (2), ou entregue (6) com valor e data da NF já capturados.
//   2. RECÉM-ATUALIZADO — revisto há menos de `staleHours`. Esta cláusula é o que garante
//      AVANÇO: sem ela, o orçamento de tempo é gasto sempre nos mesmos pedidos do início
//      da lista (que vem em ordem decrescente de data) e a cauda nunca é alcançada —
//      um pedido entregue sem NF, por exemplo, nunca liquida e travaria a fila.
export async function getBackfillSkipIds(
  dataInicial: string,
  dataFinal: string,
  staleHours: number,
): Promise<Set<string>> {
  const db = getDb()
  const rows = await db
    .select({ id: orders.olistId })
    .from(orders)
    .where(
      and(
        gte(orders.data, dataInicial),
        lte(orders.data, dataFinal),
        sql`(
          ${orders.situacao} = 2
          or (${orders.situacao} = 6 and ${orders.valorNota} is not null and ${orders.dataNota} is not null)
          or (
            ${orders.updatedAt} >= now() - make_interval(hours => ${staleHours})
            and not (${orders.raw}->>'idNotaFiscal' is not null and ${orders.dataNota} is null)
          )
        )`,
      ),
    )
  return new Set(rows.map((r) => r.id))
}

function rowToPedido(
  r: typeof orders.$inferSelect,
  mlSaleFee?: string | null,
  mlShipping?: string | null,
): Pedido {
  const saleFee = Number(mlSaleFee ?? 0)
  const custoMlReal = saleFee > 0
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
    // Custo real do ML quando importado; senão valores da Olist (frete 0 no ML).
    valorFrete: custoMlReal ? Number(mlShipping ?? 0) : Number(r.valorFrete),
    devolucao: Number(r.devolucao),
    taxaComissao: custoMlReal ? saleFee : Number(r.taxaComissao),
    custoTotal: Number(r.custoTotal),
    valorNota: r.valorNota == null ? undefined : Number(r.valorNota),
    dataNota: r.dataNota ?? undefined,
    quantidade: Number(r.quantidade),
    statusPagamento: statusPorSituacao(r.situacao, r.statusPagamento as StatusPagamento),
    data: r.data,
    custoMlReal,
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
  // Uma falha transitória ao consultar /notas não pode apagar fatos fiscais já
  // confirmados. Cancelamentos devem ser tratados explicitamente, não como ausência.
  valorNota: sql`coalesce(excluded.valor_nota, ${orders.valorNota})`,
  dataNota: sql`coalesce(excluded.data_nota, ${orders.dataNota})`,
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
    valorNota: pedido.valorNota == null ? null : String(pedido.valorNota),
    dataNota: pedido.dataNota ?? null,
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

  const notasCanceladas = items.filter((item) => item.notaCancelada).map((item) => item.pedido.id)
  if (notasCanceladas.length) {
    await db
      .update(orders)
      .set({ valorNota: null, dataNota: null, updatedAt: now })
      .where(inArray(orders.olistId, notasCanceladas))
  }

  await replaceOrderItems(
    items.map(({ pedido, itens }) => ({ olistId: pedido.id, data: pedido.data, itens })),
  )

  return rows.length
}
