import { describe, expect, it } from "vitest"
import { extractOrderItems } from "@/lib/olist-items"
import type { TinyOrderDetail } from "@/lib/olist-v3"

const DETALHE: TinyOrderDetail = {
  id: 123,
  itens: [
    { produto: { id: 10, sku: "6103", descricao: "ALAVANCA COMPLETA" }, quantidade: 2, valorUnitario: 100 },
    { produto: { id: 11, sku: "", descricao: "CABO" }, quantidade: 1, valorUnitario: 50 },
  ],
}

describe("extractOrderItems", () => {
  it("extrai itens com custo do lookup", () => {
    const itens = extractOrderItems(DETALHE, (id) => (id === 10 ? 40 : 0))
    expect(itens).toEqual([
      { sku: "6103", produtoOlistId: 10, descricao: "ALAVANCA COMPLETA", quantidade: 2, valorUnitario: 100, custoUnitario: 40 },
      { sku: "sem-sku", produtoOlistId: 11, descricao: "CABO", quantidade: 1, valorUnitario: 50, custoUnitario: 0 },
    ])
  })
  it("pedido sem itens retorna lista vazia", () => {
    expect(extractOrderItems({ id: 1 }, () => 0)).toEqual([])
  })
  it("quantidade mínima é 1 e valores string são convertidos", () => {
    const itens = extractOrderItems(
      { id: 2, itens: [{ produto: { sku: "X" }, quantidade: 0, valorUnitario: "12,50" as unknown as number }] },
      () => 0,
    )
    expect(itens[0].quantidade).toBe(1)
    expect(itens[0].valorUnitario).toBe(12.5)
  })
})
