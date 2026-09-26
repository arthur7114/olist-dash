// Lançamentos crus da carteira Shopee → eventos que a conciliação sabe tratar (puro).
// - income: renda de pedido liberada (ESCROW_VERIFIED_ADD concluída), um por pedido;
// - withdrawal: saque, juntando CREATED (valor), COMPLETED (libera) e CANCELLED;
// - other: o resto (ads, ajustes, reembolso, Pix...), guardado só para auditoria.

import type { ShopeeWalletTxn } from "@/lib/shopee-api"

export type WalletEventKind = "income" | "withdrawal" | "other"
export type WalletEventState = "ready" | "waiting" | "cancelled" | "ignored"

export type WalletEvent = {
  key: string
  kind: WalletEventKind
  transactionType: string
  orderSn: string | null
  withdrawalId: number | null
  /** income: valor creditado; withdrawal: valor que saiu da carteira; other: com sinal. */
  amount: number
  fee: number
  txnTime: Date
  state: WalletEventState
  raw: ShopeeWalletTxn[]
}

const cents = (v: number) => Math.round(v * 100) / 100
const at = (sec: number | undefined) => new Date((sec ?? 0) * 1000)

export function toWalletEvents(txns: ShopeeWalletTxn[]): WalletEvent[] {
  const income = new Map<string, WalletEvent>()
  const saques = new Map<number, ShopeeWalletTxn[]>()
  const outros: WalletEvent[] = []

  // A mesma transação pode vir em duas janelas de consulta (borda): conta uma vez só.
  const vistos = new Set<string>()
  for (const t of txns) {
    const id = [t.transaction_type, t.create_time, t.amount, t.order_sn, t.withdrawal_id, t.refund_sn, t.status].join("|")
    if (vistos.has(id)) continue
    vistos.add(id)
    const type = t.transaction_type ?? ""
    if (type === "ESCROW_VERIFIED_ADD" && t.order_sn) {
      if (t.status !== "COMPLETED") continue
      const cur = income.get(t.order_sn)
      if (cur) {
        cur.amount = cents(cur.amount + Number(t.amount ?? 0))
        cur.raw.push(t)
      } else {
        income.set(t.order_sn, {
          key: `income:${t.order_sn}`,
          kind: "income",
          transactionType: type,
          orderSn: t.order_sn,
          withdrawalId: null,
          amount: cents(Number(t.amount ?? 0)),
          fee: 0,
          txnTime: at(t.create_time),
          state: "ready",
          raw: [t],
        })
      }
    } else if (type.startsWith("WITHDRAWAL_") && typeof t.withdrawal_id === "number") {
      if (t.status === "FAILED") continue
      saques.set(t.withdrawal_id, [...(saques.get(t.withdrawal_id) ?? []), t])
    } else {
      outros.push({
        key: `other:${type}:${t.create_time ?? 0}:${t.amount ?? 0}:${t.order_sn ?? t.refund_sn ?? ""}`,
        kind: "other",
        transactionType: type,
        orderSn: t.order_sn || null,
        withdrawalId: null,
        amount: cents(Number(t.amount ?? 0)),
        fee: cents(Number(t.transaction_fee ?? 0)),
        txnTime: at(t.create_time),
        state: "ignored",
        raw: [t],
      })
    }
  }

  const withdrawals: WalletEvent[] = []
  for (const [id, list] of saques) {
    const find = (type: string) => list.find((t) => t.transaction_type === type)
    const created = find("WITHDRAWAL_CREATED")
    const completed = find("WITHDRAWAL_COMPLETED")
    const cancelled = find("WITHDRAWAL_CANCELLED")
    const valor = Math.abs(Number(created?.amount ?? 0)) || Math.abs(Number(completed?.amount ?? 0))
    withdrawals.push({
      key: `withdrawal:${id}`,
      kind: "withdrawal",
      transactionType: (completed ?? cancelled ?? created)?.transaction_type ?? "WITHDRAWAL",
      orderSn: null,
      withdrawalId: id,
      amount: cents(valor),
      fee: cents(Math.max(...list.map((t) => Number(t.transaction_fee ?? 0)))),
      txnTime: at((completed ?? cancelled ?? created)?.create_time),
      state: cancelled ? "cancelled" : completed ? "ready" : "waiting",
      raw: list,
    })
  }

  return [...income.values(), ...withdrawals, ...outros]
}
