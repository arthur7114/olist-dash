import { describe, expect, it } from "vitest"
import { toWalletEvents } from "@/lib/shopee-events"
import type { ShopeeWalletTxn } from "@/lib/shopee-api"

const T = 1_758_000_000

describe("toWalletEvents", () => {
  it("renda de pedido concluída vira evento income pronto", () => {
    const [e] = toWalletEvents([
      { transaction_type: "ESCROW_VERIFIED_ADD", status: "COMPLETED", amount: 30.5, create_time: T, order_sn: "260921K0XWYY4U" },
    ])
    expect(e).toMatchObject({ key: "income:260921K0XWYY4U", kind: "income", orderSn: "260921K0XWYY4U", amount: 30.5, state: "ready" })
    expect(e.txnTime.getTime()).toBe(T * 1000)
  })

  it("renda ainda não concluída não vira evento", () => {
    expect(toWalletEvents([{ transaction_type: "ESCROW_VERIFIED_ADD", status: "PENDING", amount: 1, create_time: T, order_sn: "A1" }])).toEqual([])
  })

  it("saque só criado espera; criado + concluído fica pronto com o valor do criado e a data da conclusão", () => {
    const criado: ShopeeWalletTxn = { transaction_type: "WITHDRAWAL_CREATED", status: "COMPLETED", amount: -55.84, create_time: T, withdrawal_id: 9 }
    expect(toWalletEvents([criado])[0]).toMatchObject({ key: "withdrawal:9", state: "waiting", amount: 55.84 })

    const [e] = toWalletEvents([
      criado,
      { transaction_type: "WITHDRAWAL_COMPLETED", status: "COMPLETED", amount: 0, create_time: T + 3600, withdrawal_id: 9 },
    ])
    expect(e).toMatchObject({ key: "withdrawal:9", kind: "withdrawal", withdrawalId: 9, amount: 55.84, fee: 0, state: "ready" })
    expect(e.txnTime.getTime()).toBe((T + 3600) * 1000)
  })

  it("saque cancelado fica cancelado", () => {
    const [e] = toWalletEvents([
      { transaction_type: "WITHDRAWAL_CREATED", status: "COMPLETED", amount: -10, create_time: T, withdrawal_id: 7 },
      { transaction_type: "WITHDRAWAL_CANCELLED", status: "COMPLETED", amount: 10, create_time: T + 60, withdrawal_id: 7 },
    ])
    expect(e.state).toBe("cancelled")
  })

  it("tarifa do saque é preservada", () => {
    const [e] = toWalletEvents([
      { transaction_type: "WITHDRAWAL_CREATED", status: "COMPLETED", amount: -100, create_time: T, withdrawal_id: 8, transaction_fee: 2 },
      { transaction_type: "WITHDRAWAL_COMPLETED", status: "COMPLETED", amount: 0, create_time: T + 60, withdrawal_id: 8 },
    ])
    expect(e.fee).toBe(2)
  })

  it("tipos fora do escopo viram other ignorado, com chave estável", () => {
    const txn: ShopeeWalletTxn = { transaction_type: "PAID_ADS_CHARGE", status: "COMPLETED", amount: -20, create_time: T }
    const [a] = toWalletEvents([txn])
    const [b] = toWalletEvents([txn])
    expect(a).toMatchObject({ kind: "other", state: "ignored", amount: -20 })
    expect(a.key).toBe(b.key)
  })
})
