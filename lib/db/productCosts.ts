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
