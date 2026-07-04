import { describe, expect, it } from "vitest"
import { normalizarFormaPagamento } from "@/lib/pagamento"

describe("normalizarFormaPagamento", () => {
  it("corrige mojibake UTF-8 duplo", () => {
    expect(normalizarFormaPagamento("CartÃ£o de crÃ©dito")).toBe("Cartão de crédito")
    expect(normalizarFormaPagamento("CartÃ£o de dÃ©bito")).toBe("Cartão de débito")
    expect(normalizarFormaPagamento("DepÃ³sito bancÃ¡rio")).toBe("Depósito bancário")
  })
  it("mantém valores corretos", () => {
    expect(normalizarFormaPagamento("Pix")).toBe("Pix")
    expect(normalizarFormaPagamento("Mercado Livre")).toBe("Mercado Livre")
  })
  it("trata vazio/nulo como Não informado", () => {
    expect(normalizarFormaPagamento("")).toBe("Não informado")
    expect(normalizarFormaPagamento(undefined)).toBe("Não informado")
    expect(normalizarFormaPagamento(null)).toBe("Não informado")
  })
})
