import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

const execute = vi.fn()
vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ execute }),
  hasDatabase: () => true,
}))

import { isCanalMercadoLivre } from "@/lib/data"
import { getOrdersMissingMlCost } from "@/lib/db/mlOrderCosts"

beforeEach(() => {
  execute.mockReset()
})

describe("isCanalMercadoLivre", () => {
  it("reconhece todas as grafias do canal ML vindas da Olist", () => {
    expect(isCanalMercadoLivre("Mercado Livre")).toBe(true)
    expect(isCanalMercadoLivre("Mercado Livre Fulfillment")).toBe(true)
    expect(isCanalMercadoLivre("MERCADO LIVRE")).toBe(true)
  })
  it("não confunde outros canais com ML", () => {
    expect(isCanalMercadoLivre("Shopee")).toBe(false)
    expect(isCanalMercadoLivre("Site")).toBe(false)
    expect(isCanalMercadoLivre("Vendedor interno")).toBe(false)
    expect(isCanalMercadoLivre("")).toBe(false)
  })
})

describe("getOrdersMissingMlCost", () => {
  it("filtra por canal ML de forma case-insensitive e incluindo Fulfillment", async () => {
    execute.mockResolvedValue({ rows: [{ olistId: "1", mlOrderId: "2000" }] })

    const rows = await getOrdersMissingMlCost(10)

    expect(rows).toEqual([{ olistId: "1", mlOrderId: "2000" }])
    const query = execute.mock.calls[0][0] as SQL
    const { sql } = new PgDialect().sqlToQuery(query)
    // Igualdade exata deixava "Mercado Livre Fulfillment" e "MERCADO LIVRE" fora do sync.
    expect(sql).not.toMatch(/canal\s*=\s*'Mercado Livre'/)
    expect(sql).toMatch(/canal\s+ilike\s+'%mercado livre%'/i)
  })
})
