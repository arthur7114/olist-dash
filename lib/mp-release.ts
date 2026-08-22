// Liberação de dinheiro do Mercado Pago para pedidos do Mercado Livre.
// O token client_credentials do ML (lib/ml-api.ts) é aceito pela API do Mercado
// Pago: GET /v1/payments/{id} devolve money_release_status/money_release_date
// dos pagamentos da conta — validado ao vivo na conta OEMPARTSOFICIAL.

import { resolveMlOrders } from "@/lib/ml-api"

const MP_API_URL = "https://api.mercadopago.com"

export type MpChargeDetail = { name: string; type: string; amount: number }

export type MpPaymentRelease = {
  paymentId: number
  status: string | null
  moneyReleaseStatus: string | null
  moneyReleaseDate: string | null
  amount: number
  // Líquido recebido (transaction_details.net_received_amount). A tarifa vem em
  // charges_details, mas bruto − líquido é a definição estável (fee_details vem
  // vazio e cashback não deduz do vendedor — validado ao vivo).
  netAmount: number
  refundedAmount: number
  // Breakdown de charges do MP, preservado para auditoria (não entra no cálculo).
  charges: MpChargeDetail[]
}

// "disputed" = algum pagamento em mediação/chargeback (mesmo com outros
// aprovados — revisão 22/08: a disputa pode reverter dinheiro do pack inteiro,
// então nada libera enquanto ela existir), ou nenhum aprovado e algum em
// análise. Separado de "no_payments" porque a conta a receber correspondente
// fica legitimamente aberta e precisa ser auditável.
export type ReleaseStatus = "released" | "pending" | "disputed" | "no_payments" | "not_found"

// Bloqueiam o pack inteiro, aprovados inclusos.
const DISPUTE_STATUS = ["in_mediation", "charged_back"]
// Ainda podem virar aprovados: seguram o pack em pending quando há aprovados.
const UNSETTLED_STATUS = ["pending", "in_process", "authorized"]
const DISPUTED_PAYMENT_STATUS = [...DISPUTE_STATUS, ...UNSETTLED_STATUS]

export type MlOrderRelease = {
  mlOrderId: string
  releaseStatus: ReleaseStatus
  // Última money_release_date entre os pagamentos aprovados (um pack pode ter vários).
  releaseDate: string | null
  amount: number
  // Somas dos pagamentos APROVADOS: líquido, tarifa (bruto − líquido) e estornos.
  netAmount: number
  feeAmount: number
  refundedAmount: number
  payments: MpPaymentRelease[]
  // Envios do pedido/pack (frete é por pacote) — usado p/ checar Full no ML.
  shipmentIds?: number[]
}

type MpPayment = {
  id?: number
  status?: string
  money_release_status?: string
  money_release_date?: string
  transaction_amount?: number
  transaction_amount_refunded?: number
  transaction_details?: {
    net_received_amount?: number
  }
  charges_details?: Array<{
    name?: string
    type?: string
    amounts?: { original?: number }
  }>
}

// Agrega os pagamentos de um pedido/pack num veredito único. Só pagamentos
// aprovados contam: released exige TODOS os aprovados liberados (um pack com um
// pagamento pendente ainda não pode ser baixado). Sem nenhum aprovado, não há o
// que conciliar (cancelado/devolvido fica de fora — devolução é outro fluxo),
// exceto quando há disputa em curso, que ganha veredito próprio.
const round2 = (v: number) => Math.round(v * 100) / 100

export function aggregateRelease(mlOrderId: string, payments: MpPaymentRelease[]): MlOrderRelease {
  const approved = payments.filter((p) => p.status === "approved")

  // Mediação/chargeback em qualquer pagamento contamina o pack: mesmo o valor
  // já aprovado pode ser revertido pela disputa. Nada libera até resolver.
  const emDisputa = payments.filter((p) => DISPUTE_STATUS.includes(p.status ?? ""))
  if (emDisputa.length) {
    return {
      mlOrderId,
      releaseStatus: "disputed",
      releaseDate: null,
      amount: round2((approved.length ? approved : emDisputa).reduce((sum, p) => sum + p.amount, 0)),
      netAmount: 0,
      feeAmount: 0,
      refundedAmount: 0,
      payments,
    }
  }

  if (!approved.length) {
    const disputed = payments.filter((p) => DISPUTED_PAYMENT_STATUS.includes(p.status ?? ""))
    if (disputed.length) {
      return {
        mlOrderId,
        releaseStatus: "disputed",
        releaseDate: null,
        amount: round2(disputed.reduce((sum, p) => sum + p.amount, 0)),
        netAmount: 0,
        feeAmount: 0,
        refundedAmount: 0,
        payments,
      }
    }
    return {
      mlOrderId,
      releaseStatus: "no_payments",
      releaseDate: null,
      amount: 0,
      netAmount: 0,
      feeAmount: 0,
      refundedAmount: 0,
      payments,
    }
  }

  // Pagamento ainda em curso (pending/in_process/authorized) ao lado de
  // aprovados: o pack ainda não está inteiro liberado.
  const emCurso = payments.some((p) => UNSETTLED_STATUS.includes(p.status ?? ""))
  const released = !emCurso && approved.every((p) => p.moneyReleaseStatus === "released")
  const releaseDate = approved.reduce<string | null>(
    (max, p) => (p.moneyReleaseDate && (!max || p.moneyReleaseDate > max) ? p.moneyReleaseDate : max),
    null,
  )
  const amount = round2(approved.reduce((sum, p) => sum + p.amount, 0))
  const netAmount = round2(approved.reduce((sum, p) => sum + p.netAmount, 0))
  return {
    mlOrderId,
    releaseStatus: released ? "released" : "pending",
    releaseDate,
    amount,
    netAmount,
    feeAmount: round2(amount - netAmount),
    refundedAmount: round2(approved.reduce((sum, p) => sum + p.refundedAmount, 0)),
    payments,
  }
}

export async function fetchMlOrderRelease(
  mlOrderId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<MlOrderRelease> {
  const resolved = await resolveMlOrders(mlOrderId, accessToken, fetchFn)
  if (!resolved) {
    return {
      mlOrderId,
      releaseStatus: "not_found",
      releaseDate: null,
      amount: 0,
      netAmount: 0,
      feeAmount: 0,
      refundedAmount: 0,
      payments: [],
      shipmentIds: [],
    }
  }

  const paymentIds = Array.from(
    new Set(
      resolved.orders.flatMap((order) =>
        (order.payments ?? []).map((p) => p.id).filter((id): id is number => typeof id === "number"),
      ),
    ),
  )

  const headers = { Authorization: `Bearer ${accessToken}` }
  const payments: MpPaymentRelease[] = []
  for (const paymentId of paymentIds) {
    const res = await fetchFn(`${MP_API_URL}/v1/payments/${paymentId}`, { headers, cache: "no-store" })
    if (!res.ok) {
      // Falha em UM pagamento invalida o veredito do pedido inteiro — melhor
      // errar e reprocessar na próxima execução do que baixar sem certeza.
      throw new Error(`MP /v1/payments/${paymentId} retornou ${res.status}: ${await res.text()}`)
    }
    const payment = (await res.json()) as MpPayment
    payments.push({
      paymentId,
      status: payment.status ?? null,
      moneyReleaseStatus: payment.money_release_status ?? null,
      moneyReleaseDate: payment.money_release_date ?? null,
      amount: payment.transaction_amount ?? 0,
      netAmount: payment.transaction_details?.net_received_amount ?? 0,
      refundedAmount: payment.transaction_amount_refunded ?? 0,
      charges: (payment.charges_details ?? []).map((c) => ({
        name: c.name ?? "",
        type: c.type ?? "",
        amount: c.amounts?.original ?? 0,
      })),
    })
  }

  // Frete é por pacote: no pack o shipment é o do pack; fora dele, o de cada pedido.
  const shipmentIds = resolved.packShipmentId
    ? [resolved.packShipmentId]
    : Array.from(
        new Set(
          resolved.orders.map((o) => o.shipping?.id).filter((id): id is number => typeof id === "number"),
        ),
      )

  return { ...aggregateRelease(mlOrderId, payments), shipmentIds }
}
