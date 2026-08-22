// Motor puro da decisão de baixa MP→Olist: dado o veredito financeiro do
// Mercado Pago e as contas a receber do pedido, decide UMA ação — sem I/O.
// Regras de negócio (validadas ao vivo em 22/08/2026):
// - exatamente UMA conta aberta por pedido (config da integração gera 1/venda);
// - bruto do MP deve bater com o VALOR ORIGINAL da conta (tolerância R$ 0,01);
// - estorno/chargeback ou conta parcialmente baixada bloqueiam (divergência);
// - a baixa é valorPago=líquido + taxa=tarifa, que quita o título pelo bruto.
// Toda comparação monetária é feita em CENTAVOS INTEIROS (float 267.38−267.37
// dá 0.010000000000019, que estouraria uma tolerância de 0.01 em float).

import type { MlOrderRelease } from "@/lib/mp-release"
import { isReceivableOpen, toNumber, type TinyReceivable } from "@/lib/olist-v3"

export type DivergenceReason =
  | "refund_present"
  | "multiple_open_receivables"
  | "duplicate_receivables"
  | "ambiguous_receivables"
  | "gross_mismatch"
  | "partial_balance"
  | "invalid_net"
  | "invalid_receivable"

export type BaixaPlanDecision =
  | { action: "skip"; reason: "not_released" }
  | { action: "already_paid"; receivableId: number | null }
  | { action: "receivable_not_found" }
  | { action: "divergence"; reason: DivergenceReason; detail: string }
  | { action: "baixa"; receivableId: number; valorPago: number; taxa: number }

const TOLERANCE_CENTS = 1

const toCents = (v: number) => Math.round(v * 100)

export function planBaixa(release: MlOrderRelease, contas: TinyReceivable[]): BaixaPlanDecision {
  if (release.releaseStatus !== "released") return { action: "skip", reason: "not_released" }

  if (toCents(release.refundedAmount) > 0) {
    return {
      action: "divergence",
      reason: "refund_present",
      detail: `pagamento com estorno de ${release.refundedAmount.toFixed(2)} — não baixar`,
    }
  }

  const abertas = contas.filter(isReceivableOpen)
  const pagas = contas.filter((c) => c.situacao === "pago")

  if (!abertas.length) {
    if (pagas.length) return { action: "already_paid", receivableId: pagas[0].id ?? null }
    return { action: "receivable_not_found" }
  }

  // Conta aberta convivendo com outra JÁ PAGA do mesmo pedido: provável título
  // duplicado — baixar a aberta receberia o mesmo dinheiro duas vezes.
  if (pagas.length) {
    return {
      action: "divergence",
      reason: "duplicate_receivables",
      detail: `conta aberta ${abertas.map((c) => c.id ?? "?").join(", ")} convive com paga ${pagas.map((c) => c.id ?? "?").join(", ")} — possível duplicidade, resolver manualmente`,
    }
  }

  if (abertas.length > 1) {
    return {
      action: "divergence",
      reason: "multiple_open_receivables",
      detail: `${abertas.length} contas abertas (ids: ${abertas.map((c) => c.id ?? "?").join(", ")}) — esperada exatamente 1`,
    }
  }

  // A baixa exige que a aberta seja a ÚNICA conta do pedido: aberta convivendo
  // com cancelada/emissao é ambíguo (re-emissão? duplicata meio-cancelada?).
  if (contas.length > 1) {
    return {
      action: "divergence",
      reason: "ambiguous_receivables",
      detail: `conta aberta ${abertas[0].id ?? "?"} convive com ${contas.length - 1} conta(s) em situação ${contas
        .filter((c) => c !== abertas[0])
        .map((c) => c.situacao ?? "?")
        .join(", ")} — resolver manualmente`,
    }
  }

  const conta = abertas[0]
  if (!conta.id) {
    return { action: "divergence", reason: "invalid_receivable", detail: "conta aberta sem id" }
  }

  const valorCents = toCents(toNumber(conta.valor))
  const saldoCents = toCents(toNumber(conta.saldo))
  const grossCents = toCents(release.amount)
  const netCents = toCents(release.netAmount)
  const feeCents = toCents(release.feeAmount)

  if (Math.abs(grossCents - valorCents) > TOLERANCE_CENTS) {
    return {
      action: "divergence",
      reason: "gross_mismatch",
      detail: `bruto MP ${release.amount.toFixed(2)} != valor da conta ${toNumber(conta.valor).toFixed(2)}`,
    }
  }

  if (Math.abs(saldoCents - valorCents) > TOLERANCE_CENTS) {
    return {
      action: "divergence",
      reason: "partial_balance",
      detail: `conta ${conta.id} com saldo ${toNumber(conta.saldo).toFixed(2)} != valor ${toNumber(conta.valor).toFixed(2)} — baixa parcial anterior, resolver manualmente`,
    }
  }

  if (netCents <= 0 || feeCents < 0 || Math.abs(netCents + feeCents - grossCents) > TOLERANCE_CENTS) {
    return {
      action: "divergence",
      reason: "invalid_net",
      detail: `equação não fecha: bruto ${release.amount.toFixed(2)} − tarifa ${release.feeAmount.toFixed(2)} != líquido ${release.netAmount.toFixed(2)}`,
    }
  }

  return {
    action: "baixa",
    receivableId: conta.id,
    valorPago: release.netAmount,
    taxa: release.feeAmount,
  }
}
