import { describe, expect, it } from "vitest"
import { extractShopeeOc, planShopeeBaixa, planWithdrawal } from "@/lib/shopee-baixa-plan"
import type { ShopeeEscrowDetail } from "@/lib/shopee-api"
import type { TinyReceivable } from "@/lib/olist-v3"

const aberta = (valor: number, extra: Partial<TinyReceivable> = {}): TinyReceivable => ({
  id: 1,
  situacao: "aberto",
  valor,
  saldo: valor,
  historico: "Ref. a NF nº 3096, Naira - OC nº 260921K0XWYY4U",
  ...extra,
})

// Venda de 51,37: Shopee tira 7,19 de comissão e 4,00 de serviço, credita 40,18.
const escrow = (income: Partial<NonNullable<ShopeeEscrowDetail["order_income"]>> = {}, extra: Partial<ShopeeEscrowDetail> = {}): ShopeeEscrowDetail => ({
  order_sn: "260921K0XWYY4U",
  return_order_sn_list: [],
  order_income: { escrow_amount: 40.18, commission_fee: 7.19, service_fee: 4, seller_transaction_fee: 0, order_ams_commission_fee: 0, ...income },
  ...extra,
})

describe("extractShopeeOc", () => {
  it("lê o número alfanumérico do pedido Shopee no histórico", () => {
    expect(extractShopeeOc("Ref. a NF nº 3096, Naira - OC nº 260921K0XWYY4U")).toBe("260921K0XWYY4U")
    expect(extractShopeeOc("Ref. a NF nº 1 - OC nº 2000012345678901")).toBe("2000012345678901")
    expect(extractShopeeOc("sem ordem de compra")).toBeUndefined()
  })
})

describe("planShopeeBaixa", () => {
  it("baixa pelo líquido com a taxa igual às tarifas declaradas", () => {
    expect(planShopeeBaixa({ credited: 40.18, escrow: escrow() }, [aberta(51.37)])).toEqual({
      action: "baixa",
      receivableId: 1,
      valorPago: 40.18,
      taxa: 11.19,
    })
  })

  it("devolução ou estorno bloqueia", () => {
    expect(planShopeeBaixa({ credited: 40.18, escrow: escrow({}, { return_order_sn_list: ["R1"] }) }, [aberta(51.37)])).toMatchObject({ action: "divergence", reason: "refund_present" })
    expect(planShopeeBaixa({ credited: 40.18, escrow: escrow({ seller_return_refund: -5 }) }, [aberta(51.37)])).toMatchObject({ action: "divergence", reason: "refund_present" })
    expect(planShopeeBaixa({ credited: 40.18, escrow: escrow({ drc_adjustable_refund: 3 }) }, [aberta(51.37)])).toMatchObject({ action: "divergence", reason: "refund_present" })
  })

  it("crédito na carteira diferente do escrow bloqueia; usa o valor pós-ajuste quando existe", () => {
    expect(planShopeeBaixa({ credited: 39, escrow: escrow() }, [aberta(51.37)])).toMatchObject({ action: "divergence", reason: "net_mismatch" })
    expect(
      planShopeeBaixa({ credited: 38.18, escrow: escrow({ escrow_amount_after_adjustment: 38.18, commission_fee: 9.19 }) }, [aberta(51.37)]),
    ).toMatchObject({ action: "baixa", valorPago: 38.18, taxa: 13.19 })
  })

  it("regras de conta a receber: nenhuma, já paga, duplicada", () => {
    expect(planShopeeBaixa({ credited: 40.18, escrow: escrow() }, [])).toEqual({ action: "receivable_not_found" })
    expect(planShopeeBaixa({ credited: 40.18, escrow: escrow() }, [aberta(51.37, { situacao: "pago", saldo: 0 })])).toEqual({ action: "already_paid", receivableId: 1 })
    expect(
      planShopeeBaixa({ credited: 40.18, escrow: escrow() }, [aberta(51.37), aberta(51.37, { id: 2, situacao: "pago", saldo: 0 })]),
    ).toMatchObject({ action: "divergence", reason: "duplicate_receivables" })
  })

  it("baixa parcial anterior bloqueia", () => {
    expect(planShopeeBaixa({ credited: 40.18, escrow: escrow() }, [aberta(51.37, { saldo: 20 })])).toMatchObject({ action: "divergence", reason: "partial_balance" })
  })

  it("taxa que não bate com as tarifas declaradas bloqueia, com a composição no detalhe", () => {
    const d = planShopeeBaixa({ credited: 40.18, escrow: escrow() }, [aberta(54.08)])
    expect(d).toMatchObject({ action: "divergence", reason: "fee_mismatch" })
    expect(d.action === "divergence" && d.detail).toContain("comissão 7.19")
  })

  it("crédito maior que a conta bloqueia", () => {
    expect(
      planShopeeBaixa({ credited: 60, escrow: escrow({ escrow_amount: 60, commission_fee: 0, service_fee: 0 }) }, [aberta(51.37)]),
    ).toMatchObject({ action: "divergence", reason: "fee_mismatch" })
  })
})

describe("planWithdrawal", () => {
  const base = { state: "ready" as const, amount: 55.84, fee: 0 }

  it("saque concluído sem tarifa vira transferência", () => {
    expect(planWithdrawal(base)).toEqual({ action: "transfer", valor: 55.84 })
  })

  it("tarifa, valor zerado ou saque não concluído bloqueiam", () => {
    expect(planWithdrawal({ ...base, fee: 1 })).toMatchObject({ action: "divergence", reason: "withdrawal_fee" })
    expect(planWithdrawal({ ...base, amount: 0 })).toMatchObject({ action: "divergence", reason: "invalid_amount" })
    expect(planWithdrawal({ ...base, state: "waiting" })).toEqual({ action: "wait" })
  })
})
