// Conciliação Mercado Pago → Olist: quando o dinheiro de um pedido ML é
// liberado (money_release_status=released, o que só acontece depois da entrega),
// dá baixa na conta a receber correspondente no ERP da Olist — pelo esquema
// validado em produção (22/08/2026): valorPago=líquido + taxa=tarifa +
// contaDestino (conta Mercado Pago) + categoria (VENDAS MERCADO LIVRE), que
// quita o título pelo bruto e leva a tarifa a "Taxas e tarifas" na DRE.
//
// Fluxo por pedido: numeroPedidoEcommerce (raw da Olist) → order/pack no ML →
// payments → money_release + líquido no MP → conta a receber via "OC nº" no
// historico (fallback: filtro idNota) → decisão pura em planBaixa →
// POST /contas-receber/{id}/baixar. Pedidos Full sem conta: POST
// /notas/{id}/lancar-contas (uma única vez) e baixa na sequência.
// Estado em mp_releases (idempotente).

import { getMlAccessToken } from "@/lib/ml-api"
import { fetchMlOrderRelease } from "@/lib/mp-release"
import { planBaixa } from "@/lib/mp-baixa-plan"
import {
  baixarContaReceber,
  extractOcNumber,
  fetchReceivablesByEmissionRange,
  fetchReceivablesByNota,
  lancarContasNota,
  refreshAccessToken,
  toNumber,
  type TinyReceivable,
} from "@/lib/olist-v3"
import { getStoredCredentials, saveCredentials } from "@/lib/db/credentials"
import { getMpReleaseCandidates, getMpReleaseStats, upsertMpRelease } from "@/lib/db/mpReleases"

const BUDGET_MS = Number(process.env.MP_RECONCILE_BUDGET_MS) || 230_000
// Janela de pedidos considerados: liberação do ML acontece até ~30 dias depois
// da venda; 90 dias cobre atrasos com folga sem varrer o histórico todo.
const DEFAULT_DAYS = Number(process.env.MP_RECONCILE_DAYS) || 90
// Antes disso o financeiro da Olist não existia (mai/2026 tem só 34 contas):
// pedidos anteriores nunca terão conta a receber — ficam fora da fila.
const FINANCIAL_CUTOVER = "2026-06-01"
const MAX_CANDIDATES = 1000
const INTERVALO_MS = 150 // ritmo das chamadas ML/MP (Olist tem gate próprio)

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type BaixaPlanejada = {
  olistId: string
  mlOrderId: string
  receivableId: number
  valorConta: number
  saldo: number
  amountMp: number
  liquidoMp: number
  tarifaMp: number
  releaseDate: string | null
  historico: string | undefined
}

export type MpReconcileSummary = {
  ok: true
  dryRun: boolean
  days: number
  candidates: number
  checked: number
  released: number
  baixados: number
  alreadyPaid: number
  receivableNotFound: number
  divergences: number
  notasLancadas: number
  mlNotFound: number
  errors: number
  completed: boolean
  planned: BaixaPlanejada[]
  // Pedidos Full sem conta cuja NF teria as contas lançadas (dry-run não lança).
  notasALancar: Array<{ olistId: string; mlOrderId: string; idNotaFiscal: number }>
  stats: { total: number; released: number; baixados: number; pendentes: number }
  elapsedMs: number
}

// Destinos contábeis da baixa, validados ao vivo em 22/08/2026 na conta real:
// sem contaDestino o dinheiro cai na conta padrão (Banco do Brasil) e sem
// categoria o recebimento inteiro é reclassificado. IDs fixos da conta Olist
// da OEM (a API v3 não lista contas financeiras — vieram da UI).
const MP_CONTA_DESTINO_ID = 348321811 // conta financeira "Mercado Pago"
const ML_VENDAS_CATEGORIA_ID = 350314766 // categoria "VENDAS MERCADO LIVRE"

export async function runMpReconcile(opts: { dryRun?: boolean; days?: number } = {}): Promise<MpReconcileSummary> {
  const startedAt = Date.now()
  const deadline = startedAt + BUDGET_MS
  const dryRun = opts.dryRun ?? false
  const days = opts.days && opts.days > 0 ? opts.days : DEFAULT_DAYS

  const windowStart = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const sinceDate = windowStart > FINANCIAL_CUTOVER ? windowStart : FINANCIAL_CUTOVER
  const candidates = await getMpReleaseCandidates(sinceDate, MAX_CANDIDATES)

  let checked = 0
  let released = 0
  let baixados = 0
  let alreadyPaid = 0
  let receivableNotFound = 0
  let divergences = 0
  let notasLancadas = 0
  let mlNotFound = 0
  let errors = 0
  let completed = true
  const planned: BaixaPlanejada[] = []
  const notasALancar: MpReconcileSummary["notasALancar"] = []

  if (candidates.length) {
    const mlToken = await getMlAccessToken()
    const olistToken = await getOlistAccessToken()

    // Uma única varredura das contas a receber da janela, indexada por OC nº.
    const emissaoInicial = shiftDays(candidates.reduce((min, c) => (c.data < min ? c.data : min), candidates[0].data), -3)
    const emissaoFinal = new Date().toISOString().slice(0, 10)
    const receivablesByOc = indexReceivablesByOc(
      await fetchReceivablesByEmissionRange(olistToken, emissaoInicial, emissaoFinal),
    )

    for (const candidate of candidates) {
      if (Date.now() >= deadline) {
        completed = false
        break
      }

      let release
      try {
        release = await fetchMlOrderRelease(candidate.mlOrderId, mlToken)
      } catch {
        errors += 1
        if (errors > 20) {
          completed = false
          break // API instável — a próxima execução retoma pelo checked_at
        }
        await delay(INTERVALO_MS)
        continue
      }
      checked += 1
      if (release.releaseStatus === "not_found") mlNotFound += 1

      const base = {
        olistId: candidate.olistId,
        mlOrderId: candidate.mlOrderId,
        releaseStatus: release.releaseStatus,
        releaseDate: release.releaseDate ? new Date(release.releaseDate) : null,
        amount: release.amount,
        netAmount: release.netAmount,
        feeAmount: release.feeAmount,
      }

      if (release.releaseStatus !== "released") {
        await upsertMpRelease(base)
        await delay(INTERVALO_MS)
        continue
      }
      released += 1

      let contas = receivablesByOc.get(candidate.mlOrderId) ?? []
      const idNota = Number(candidate.idNotaFiscal) || 0

      // Fallback por NF: contas geradas via lancar-contas podem não trazer o
      // "OC nº" no historico; o filtro idNota é o vínculo determinístico.
      if (!contas.length && idNota) {
        contas = await fetchReceivablesByNota(olistToken, idNota)
      }

      // Pedidos Full: a integração ML→Olist não gera o financeiro. Com NF e
      // NENHUMA conta em qualquer situação, lança as contas da nota (uma única
      // vez por pedido) e baixa na sequência. Em dry-run apenas reporta.
      let contasLancadasAt: Date | null = null
      if (!contas.length && idNota && !candidate.contasLancadasAt) {
        if (dryRun) {
          notasALancar.push({ olistId: candidate.olistId, mlOrderId: candidate.mlOrderId, idNotaFiscal: idNota })
        } else {
          try {
            await lancarContasNota(olistToken, idNota)
            contasLancadasAt = new Date()
            notasLancadas += 1
            contas = await fetchReceivablesByNota(olistToken, idNota)
          } catch (err) {
            errors += 1
            const message = err instanceof Error ? err.message : String(err)
            await upsertMpRelease({
              ...base,
              baixaStatus: "receivable_not_found",
              lastError: `lancar-contas da NF ${idNota} falhou: ${message}`,
            })
            await delay(INTERVALO_MS)
            continue
          }
        }
      }

      const decision = planBaixa(release, contas)

      if (decision.action === "already_paid") {
        alreadyPaid += 1
        await upsertMpRelease({ ...base, receivableId: decision.receivableId, baixaStatus: "already_paid", contasLancadasAt })
        await delay(INTERVALO_MS)
        continue
      }

      if (decision.action === "receivable_not_found") {
        receivableNotFound += 1
        await upsertMpRelease({
          ...base,
          baixaStatus: "receivable_not_found",
          contasLancadasAt,
          lastError: contas.length ? `contas em situação: ${contas.map((c) => c.situacao).join(", ")}` : null,
        })
        await delay(INTERVALO_MS)
        continue
      }

      if (decision.action === "divergence") {
        divergences += 1
        await upsertMpRelease({
          ...base,
          baixaStatus: "divergence",
          contasLancadasAt,
          lastError: `${decision.reason}: ${decision.detail}`,
        })
        await delay(INTERVALO_MS)
        continue
      }

      if (decision.action !== "baixa") {
        // "skip" não acontece aqui (release já filtrado), mas o compilador não sabe.
        await delay(INTERVALO_MS)
        continue
      }

      const conta = contas.find((c) => c.id === decision.receivableId)
      const historico = `Baixa MP: pedido ${candidate.mlOrderId} bruto ${release.amount.toFixed(2)} líquido ${decision.valorPago.toFixed(2)} tarifa ${decision.taxa.toFixed(2)}`

      if (dryRun) {
        planned.push({
          olistId: candidate.olistId,
          mlOrderId: candidate.mlOrderId,
          receivableId: decision.receivableId,
          valorConta: toNumber(conta?.valor),
          saldo: toNumber(conta?.saldo),
          amountMp: release.amount,
          liquidoMp: decision.valorPago,
          tarifaMp: decision.taxa,
          releaseDate: release.releaseDate,
          historico,
        })
        // Persiste o veredito de liberação, mas mantém baixa pendente.
        await upsertMpRelease({ ...base, receivableId: decision.receivableId, baixaStatus: "pending" })
        await delay(INTERVALO_MS)
        continue
      }

      try {
        await baixarContaReceber(olistToken, decision.receivableId, {
          valorPago: decision.valorPago,
          taxa: decision.taxa,
          contaDestino: { id: MP_CONTA_DESTINO_ID },
          categoria: { id: ML_VENDAS_CATEGORIA_ID },
          data: release.releaseDate ? new Date(release.releaseDate) : new Date(),
          historico,
        })
        baixados += 1
        await upsertMpRelease({
          ...base,
          receivableId: decision.receivableId,
          baixaStatus: "done",
          baixaScheme: "net_fee",
          baixaAt: new Date(),
          contasLancadasAt,
        })
      } catch (err) {
        errors += 1
        const message = err instanceof Error ? err.message : String(err)
        await upsertMpRelease({
          ...base,
          receivableId: decision.receivableId,
          baixaStatus: "error",
          contasLancadasAt,
          lastError: message,
        })
      }
      await delay(INTERVALO_MS)
    }
  }

  return {
    ok: true,
    dryRun,
    days,
    candidates: candidates.length,
    checked,
    released,
    baixados,
    alreadyPaid,
    receivableNotFound,
    divergences,
    notasLancadas,
    mlNotFound,
    errors,
    completed,
    planned: planned.slice(0, 100),
    notasALancar: notasALancar.slice(0, 100),
    stats: await getMpReleaseStats(sinceDate),
    elapsedMs: Date.now() - startedAt,
  }
}

// Usa o access token armazenado enquanto válido; só faz refresh (com rotação)
// quando expirou — evita corrida de rotação com o sync que roda a cada 4h.
async function getOlistAccessToken(): Promise<string> {
  const creds = await getStoredCredentials()
  if (!creds) throw new Error("Sem credenciais Olist no banco. Conecte a conta pelo dashboard primeiro.")
  if (creds.accessToken && creds.accessExpiresAt && creds.accessExpiresAt.getTime() > Date.now() + 120_000) {
    return creds.accessToken
  }
  const refreshed = await refreshAccessToken(creds.refreshToken)
  await saveCredentials(refreshed)
  return refreshed.access_token
}

export function indexReceivablesByOc(receivables: TinyReceivable[]): Map<string, TinyReceivable[]> {
  const byOc = new Map<string, TinyReceivable[]>()
  for (const receivable of receivables) {
    const oc = extractOcNumber(receivable.historico)
    if (!oc) continue
    const list = byOc.get(oc)
    if (list) list.push(receivable)
    else byOc.set(oc, [receivable])
  }
  return byOc
}

function shiftDays(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}
