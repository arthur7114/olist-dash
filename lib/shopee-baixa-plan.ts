// Decisões puras da conciliação Shopee → Olist (sem I/O), em centavos inteiros.
// Renda: baixa pelo líquido creditado na carteira, com taxa = valor da conta − líquido,
// e só se essa taxa bater com as tarifas que a própria Shopee declara no escrow.
// A regra é estrita de propósito (spec 2026-09-26): frete e subsídios da Shopee BR
// só serão conhecidos com dados reais; até lá, o que não fecha vai para divergência.

import { resolveOpenReceivable, type DivergenceReason } from "@/lib/mp-baixa-plan"
import type { ShopeeEscrowDetail } from "@/lib/shopee-api"
import { toNumber, type TinyReceivable } from "@/lib/olist-v3"
import type { WalletEventState } from "@/lib/shopee-events"

const TOLERANCE_CENTS = 1
const toCents = (v: number) => Math.round(v * 100)
const fmt = (c: number) => (c / 100).toFixed(2)

// Número do pedido Shopee no histórico da conta ("… - OC nº 260921K0XWYY4U"). O
// extractOcNumber do MP só aceita dígitos; o da Shopee é alfanumérico.
export function extractShopeeOc(historico: string | undefined): string | undefined {
  return historico?.match(/OC\s*n[ºo°.]*\s*([0-9A-Z]{8,})/i)?.[1]?.toUpperCase()
}

export type ShopeeDivergenceReason = DivergenceReason | "net_mismatch" | "fee_mismatch"

export type ShopeeBaixaDecision =
  | { action: "already_paid"; receivableId: number | null }
  | { action: "receivable_not_found" }
  | { action: "divergence"; reason: ShopeeDivergenceReason; detail: string }
  | { action: "baixa"; receivableId: number; valorPago: number; taxa: number }

export function planShopeeBaixa(
  input: { credited: number; escrow: ShopeeEscrowDetail },
  contas: TinyReceivable[],
): ShopeeBaixaDecision {
  const inc = input.escrow.order_income ?? {}
  const n = (v: unknown) => toCents(toNumber(v))

  if ((input.escrow.return_order_sn_list?.length ?? 0) > 0 || n(inc.seller_return_refund) !== 0 || n(inc.drc_adjustable_refund) !== 0) {
    return {
      action: "divergence",
      reason: "refund_present",
      detail: `pedido com devolução/estorno (retornos: ${(input.escrow.return_order_sn_list ?? []).join(", ") || "-"}, reembolso ${toNumber(inc.seller_return_refund).toFixed(2)}, disputa ${toNumber(inc.drc_adjustable_refund).toFixed(2)})`,
    }
  }

  const creditedCents = toCents(input.credited)
  const escrowCents = inc.escrow_amount_after_adjustment !== undefined ? n(inc.escrow_amount_after_adjustment) : n(inc.escrow_amount)
  if (creditedCents <= 0 || Math.abs(creditedCents - escrowCents) > TOLERANCE_CENTS) {
    return {
      action: "divergence",
      reason: "net_mismatch",
      detail: `creditado na carteira ${fmt(creditedCents)} != escrow ${fmt(escrowCents)}`,
    }
  }

  const resolved = resolveOpenReceivable(contas)
  if (resolved.action !== "open") return resolved
  const conta = resolved.conta

  const valorCents = n(conta.valor)
  if (Math.abs(n(conta.saldo) - valorCents) > TOLERANCE_CENTS) {
    return {
      action: "divergence",
      reason: "partial_balance",
      detail: `conta ${conta.id} com saldo ${toNumber(conta.saldo).toFixed(2)} != valor ${toNumber(conta.valor).toFixed(2)} — baixa parcial anterior, resolver manualmente`,
    }
  }

  const tarifas = {
    comissão: n(inc.commission_fee),
    serviço: n(inc.service_fee),
    transação: n(inc.seller_transaction_fee),
    afiliados: n(inc.order_ams_commission_fee),
  }
  const tarifasCents = Object.values(tarifas).reduce((a, b) => a + b, 0)
  const taxaCents = valorCents - creditedCents
  if (taxaCents < 0 || Math.abs(taxaCents - tarifasCents) > TOLERANCE_CENTS) {
    const composicao = Object.entries(tarifas).map(([k, v]) => `${k} ${fmt(v)}`).join(", ")
    return {
      action: "divergence",
      reason: "fee_mismatch",
      detail: `conta ${fmt(valorCents)} − líquido ${fmt(creditedCents)} = ${fmt(taxaCents)}, mas a Shopee declara ${fmt(tarifasCents)} (${composicao}; frete comprador ${toNumber(inc.buyer_paid_shipping_fee).toFixed(2)}, frete final ${toNumber(inc.final_shipping_fee).toFixed(2)})`,
    }
  }

  return { action: "baixa", receivableId: conta.id, valorPago: creditedCents / 100, taxa: taxaCents / 100 }
}

export type WithdrawalDecision =
  | { action: "wait" }
  | { action: "divergence"; reason: "withdrawal_fee" | "invalid_amount"; detail: string }
  | { action: "transfer"; valor: number }

export function planWithdrawal(event: { state: WalletEventState; amount: number; fee: number }): WithdrawalDecision {
  if (event.state !== "ready") return { action: "wait" }
  if (toCents(event.amount) <= 0) return { action: "divergence", reason: "invalid_amount", detail: `saque com valor ${event.amount}` }
  // Ainda não sabemos se a tarifa sai do valor do saque ou do saldo: não chutar.
  if (toCents(event.fee) > 0) {
    return { action: "divergence", reason: "withdrawal_fee", detail: `saque de ${event.amount.toFixed(2)} com tarifa ${event.fee.toFixed(2)}` }
  }
  return { action: "transfer", valor: toCents(event.amount) / 100 }
}
