// Liberação de dinheiro do Mercado Pago para pedidos do Mercado Livre.
// O token client_credentials do ML (lib/ml-api.ts) é aceito pela API do Mercado
// Pago: GET /v1/payments/{id} devolve money_release_status/money_release_date
// dos pagamentos da conta — validado ao vivo na conta OEMPARTSOFICIAL.

import { resolveMlOrders } from "@/lib/ml-api"

const MP_API_URL = "https://api.mercadopago.com"

export type MpPaymentRelease = {
  paymentId: number
  status: string | null
  moneyReleaseStatus: string | null
  moneyReleaseDate: string | null
  amount: number
}

export type ReleaseStatus = "released" | "pending" | "no_payments" | "not_found"

export type MlOrderRelease = {
  mlOrderId: string
  releaseStatus: ReleaseStatus
  // Última money_release_date entre os pagamentos aprovados (um pack pode ter vários).
  releaseDate: string | null
  amount: number
  payments: MpPaymentRelease[]
}

type MpPayment = {
  id?: number
  status?: string
  money_release_status?: string
  money_release_date?: string
  transaction_amount?: number
}

// Agrega os pagamentos de um pedido/pack num veredito único. Só pagamentos
// aprovados contam: released exige TODOS os aprovados liberados (um pack com um
// pagamento pendente ainda não pode ser baixado). Sem nenhum aprovado, não há o
// que conciliar (cancelado/devolvido fica de fora — devolução é outro fluxo).
export function aggregateRelease(mlOrderId: string, payments: MpPaymentRelease[]): MlOrderRelease {
  const approved = payments.filter((p) => p.status === "approved")
  if (!approved.length) {
    return { mlOrderId, releaseStatus: "no_payments", releaseDate: null, amount: 0, payments }
  }
  const released = approved.every((p) => p.moneyReleaseStatus === "released")
  const releaseDate = approved.reduce<string | null>(
    (max, p) => (p.moneyReleaseDate && (!max || p.moneyReleaseDate > max) ? p.moneyReleaseDate : max),
    null,
  )
  const amount = approved.reduce((sum, p) => sum + p.amount, 0)
  return {
    mlOrderId,
    releaseStatus: released ? "released" : "pending",
    releaseDate,
    amount: Math.round(amount * 100) / 100,
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
    return { mlOrderId, releaseStatus: "not_found", releaseDate: null, amount: 0, payments: [] }
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
    })
  }

  return aggregateRelease(mlOrderId, payments)
}
