import { describe, expect, it } from "vitest"
import { planBaixa } from "@/lib/mp-baixa-plan"
import type { MlOrderRelease } from "@/lib/mp-release"
import type { TinyReceivable } from "@/lib/olist-v3"

const release = (over: Partial<MlOrderRelease> = {}): MlOrderRelease => ({
  mlOrderId: "2000014472588973",
  releaseStatus: "released",
  releaseDate: "2026-08-22T07:00:19.000-04:00",
  amount: 267.37,
  netAmount: 203.43,
  feeAmount: 63.94,
  refundedAmount: 0,
  payments: [],
  ...over,
})

const conta = (over: Partial<TinyReceivable> = {}): TinyReceivable => ({
  id: 362259083,
  situacao: "aberto",
  valor: 267.37,
  saldo: 267.37,
  historico: "Ref. a NF nº 2700 - OC nº 2000014472588973",
  ...over,
})

describe("planBaixa", () => {
  it("venda com tarifa: baixa pelo líquido com a tarifa em taxa", () => {
    const decision = planBaixa(release(), [conta()])
    expect(decision).toEqual({
      action: "baixa",
      receivableId: 362259083,
      valorPago: 203.43,
      taxa: 63.94,
    })
  })

  it("venda sem tarifa: taxa zero", () => {
    const decision = planBaixa(
      release({ amount: 50, netAmount: 50, feeAmount: 0 }),
      [conta({ valor: 50, saldo: 50 })],
    )
    expect(decision).toEqual({ action: "baixa", receivableId: 362259083, valorPago: 50, taxa: 0 })
  })

  it("tolera divergência de até R$ 0,01 entre bruto e valor da conta", () => {
    const decision = planBaixa(release({ amount: 267.38, netAmount: 203.44, feeAmount: 63.94 }), [conta()])
    expect(decision.action).toBe("baixa")
  })

  it("dinheiro não liberado: skip", () => {
    expect(planBaixa(release({ releaseStatus: "pending" }), [conta()])).toEqual({
      action: "skip",
      reason: "not_released",
    })
    expect(planBaixa(release({ releaseStatus: "disputed" }), [conta()])).toEqual({
      action: "skip",
      reason: "not_released",
    })
  })

  it("estorno (total ou parcial) bloqueia a baixa", () => {
    const decision = planBaixa(release({ refundedAmount: 30 }), [conta()])
    expect(decision.action).toBe("divergence")
    expect(decision).toMatchObject({ reason: "refund_present" })
  })

  it("conta já baixada: already_paid com o id da conta", () => {
    const decision = planBaixa(release(), [conta({ situacao: "pago", saldo: 0 })])
    expect(decision).toEqual({ action: "already_paid", receivableId: 362259083 })
  })

  it("nenhuma conta: receivable_not_found", () => {
    expect(planBaixa(release(), [])).toEqual({ action: "receivable_not_found" })
  })

  it("conta só em situação não-baixável (cancelada): receivable_not_found", () => {
    expect(planBaixa(release(), [conta({ situacao: "cancelada" })])).toEqual({
      action: "receivable_not_found",
    })
  })

  it("conta aberta ao lado de outra já PAGA: divergência de duplicidade", () => {
    // Cenário da revisão (P1): o título pode já ter sido pago em duplicata.
    // Baixar a aberta receberia o mesmo dinheiro duas vezes — trava manual.
    const decision = planBaixa(release(), [conta(), conta({ id: 999, situacao: "pago", saldo: 0 })])
    expect(decision.action).toBe("divergence")
    expect(decision).toMatchObject({ reason: "duplicate_receivables" })
  })

  it("mais de uma conta aberta: divergência (exigimos exatamente uma)", () => {
    const decision = planBaixa(release(), [conta(), conta({ id: 999 })])
    expect(decision.action).toBe("divergence")
    expect(decision).toMatchObject({ reason: "multiple_open_receivables" })
  })

  it("a baixa exige que a conta aberta seja a ÚNICA conta do pedido", () => {
    // Aberta convivendo com cancelada/emissao é ambíguo (re-emissão? duplicata
    // cancelada pela metade?) — trava manual em vez de adivinhar.
    const decision = planBaixa(release(), [conta(), conta({ id: 999, situacao: "cancelada" })])
    expect(decision.action).toBe("divergence")
    expect(decision).toMatchObject({ reason: "ambiguous_receivables" })
  })

  it("bruto diferente do valor original da conta: divergência", () => {
    const decision = planBaixa(release({ amount: 250, netAmount: 190, feeAmount: 60 }), [conta()])
    expect(decision.action).toBe("divergence")
    expect(decision).toMatchObject({ reason: "gross_mismatch" })
  })

  it("conta parcialmente baixada (saldo < valor): divergência, nunca baixar por cima", () => {
    const decision = planBaixa(release(), [conta({ situacao: "parcial", saldo: 63.94 })])
    expect(decision.action).toBe("divergence")
    expect(decision).toMatchObject({ reason: "partial_balance" })
  })

  it("líquido inconsistente (líquido + tarifa ≠ bruto): divergência", () => {
    const decision = planBaixa(release({ netAmount: 100, feeAmount: 63.94 }), [conta()])
    expect(decision.action).toBe("divergence")
    expect(decision).toMatchObject({ reason: "invalid_net" })
  })

  it("líquido zerado ou negativo: divergência", () => {
    const decision = planBaixa(release({ netAmount: 0, feeAmount: 267.37 }), [conta()])
    expect(decision.action).toBe("divergence")
    expect(decision).toMatchObject({ reason: "invalid_net" })
  })

  it("conta aberta sem id: divergência (não dá para baixar sem id)", () => {
    const decision = planBaixa(release(), [conta({ id: undefined })])
    expect(decision.action).toBe("divergence")
  })
})
