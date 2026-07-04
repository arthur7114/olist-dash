import { gte, inArray, sql } from "drizzle-orm"
import { getDb } from "./client"
import { orderItems } from "./schema"
import type { ItemPedido } from "@/lib/data"
import type { SyncOrderItem } from "@/lib/olist-items"

// Substitui os itens dos pedidos informados (delete + insert): pedidos editados
// na Olist podem perder/ganhar itens, e o upsert puro deixaria linhas órfãs.
export async function replaceOrderItems(
  porPedido: Array<{ olistId: string; data: string; itens: SyncOrderItem[] }>,
): Promise<number> {
  if (!porPedido.length) return 0
  const db = getDb()
  const ids = porPedido.map((p) => p.olistId)
  const rows = porPedido.flatMap((p) =>
    p.itens.map((item, i) => ({
      id: `${p.olistId}:${i}`,
      olistId: p.olistId,
      sku: item.sku,
      produtoOlistId: item.produtoOlistId,
      descricao: item.descricao,
      quantidade: item.quantidade,
      valorUnitario: String(item.valorUnitario),
      custoUnitario: String(item.custoUnitario),
      data: p.data,
    })),
  )

  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    await db.delete(orderItems).where(inArray(orderItems.olistId, ids.slice(i, i + CHUNK)))
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(orderItems).values(rows.slice(i, i + CHUNK))
  }
  return rows.length
}

// Pedidos com raw salvo e nenhum item extraído — alvo do backfill.
export async function getOrdersWithoutItems(
  limit: number,
): Promise<Array<{ olistId: string; data: string; raw: unknown }>> {
  const db = getDb()
  const res = await db.execute(sql`
    select o.olist_id as "olistId", o.data::text as "data", o.raw as "raw"
    from orders o
    where o.raw is not null
      and not exists (select 1 from order_items i where i.olist_id = o.olist_id)
    order by o.data desc
    limit ${limit}
  `)
  return res.rows as unknown as Array<{ olistId: string; data: string; raw: unknown }>
}

// Itens agrupados por pedido para o período — anexados aos Pedidos pela API.
export async function getItemsByPeriod(dataInicial: string): Promise<Map<string, ItemPedido[]>> {
  const db = getDb()
  const rows = await db.select().from(orderItems).where(gte(orderItems.data, dataInicial))
  const mapa = new Map<string, ItemPedido[]>()
  for (const r of rows) {
    const lista = mapa.get(r.olistId) ?? []
    lista.push({
      sku: r.sku,
      descricao: r.descricao,
      quantidade: r.quantidade,
      valorUnitario: Number(r.valorUnitario),
      custoUnitario: Number(r.custoUnitario),
    })
    mapa.set(r.olistId, lista)
  }
  return mapa
}
