import { sql } from "drizzle-orm"
import { getDb } from "./client"
import { mlOrderCosts } from "./schema"

export async function upsertMlOrderCost(row: {
  mlOrderId: string
  olistId: string
  saleFee: number
  shippingCost: number
  listingType: string | null
  mlStatus: string | null
  raw: unknown
}): Promise<void> {
  const db = getDb()
  await db
    .insert(mlOrderCosts)
    .values({
      mlOrderId: row.mlOrderId,
      olistId: row.olistId,
      saleFee: String(row.saleFee),
      shippingCost: String(row.shippingCost),
      listingType: row.listingType,
      mlStatus: row.mlStatus,
      raw: row.raw as never,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: mlOrderCosts.mlOrderId,
      set: {
        saleFee: sql`excluded.sale_fee`,
        shippingCost: sql`excluded.shipping_cost`,
        listingType: sql`excluded.listing_type`,
        mlStatus: sql`excluded.ml_status`,
        raw: sql`excluded.raw`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    })
}

// Pedidos ML sem custo real importado, mais recentes primeiro.
// O id do pedido no ML vem do raw da Olist (ecommerce.numeroPedidoEcommerce).
// O canal casa por ilike porque a Olist grava "Mercado Livre", "Mercado Livre
// Fulfillment" (Full) e "MERCADO LIVRE" — igualdade exata deixava o Full sem
// custo real e no fallback de 16% + frete zero (ver isCanalMercadoLivre em lib/data).
export async function getOrdersMissingMlCost(
  limit: number,
): Promise<Array<{ olistId: string; mlOrderId: string }>> {
  const db = getDb()
  const res = await db.execute(sql`
    select o.olist_id as "olistId",
           o.raw->'ecommerce'->>'numeroPedidoEcommerce' as "mlOrderId"
    from orders o
    where o.canal ilike '%mercado livre%'
      and coalesce(o.raw->'ecommerce'->>'numeroPedidoEcommerce', '') <> ''
      and not exists (select 1 from ml_order_costs m where m.olist_id = o.olist_id)
    order by o.data desc
    limit ${limit}
  `)
  return res.rows as unknown as Array<{ olistId: string; mlOrderId: string }>
}
