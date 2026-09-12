import { sql } from "drizzle-orm"
import { getDb } from "./client"
import { productCosts } from "./schema"

export async function getAllProductCosts(): Promise<Array<{ ref: string; custo: number; updatedAt: Date }>> {
  const db = getDb()
  const rows = await db.select().from(productCosts)
  return rows.map((r) => ({ ref: r.ref, custo: Number(r.custo), updatedAt: r.updatedAt }))
}

export async function saveProductCosts(entries: Array<{ ref: string; custo: number }>): Promise<void> {
  if (!entries.length) return
  const db = getDb()
  const now = new Date()
  const rows = entries.map((e) => ({ ref: e.ref, custo: String(e.custo), updatedAt: now }))
  const CHUNK = 200
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insert(productCosts)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: productCosts.ref,
        set: { custo: sql`excluded.custo`, updatedAt: sql`excluded.updated_at` },
      })
  }
}

// SKUs de anúncios ATIVOS que não têm custo em lugar nenhum: nem em venda passada,
// nem no cache product_costs. Produto que nunca vendeu nunca passou pelo sync de pedidos,
// então o custo dele precisa ser buscado direto no cadastro da Olist.
export async function getSkusMissingCost(limit = 500): Promise<string[]> {
  const db = getDb()
  const res = await db.execute(sql`
    with ativos as (
      select distinct btrim(seller_sku) sku
      from ml_items
      where status = 'active' and seller_sku is not null and btrim(seller_sku) <> ''
    ),
    vendidos as (
      select distinct oi.sku
      from order_items oi join orders o on o.olist_id = oi.olist_id
      where oi.custo_unitario > 0 and o.data >= current_date - 180
    ),
    cacheado as (
      select replace(ref, 'sku:', '') sku from product_costs where custo > 0
    )
    select a.sku
    from ativos a
    left join vendidos v on v.sku = a.sku
    left join cacheado c on c.sku = a.sku
    where v.sku is null and c.sku is null
    order by a.sku
    limit ${limit}
  `)
  return (res.rows as unknown as Array<{ sku: string }>).map((r) => r.sku)
}
