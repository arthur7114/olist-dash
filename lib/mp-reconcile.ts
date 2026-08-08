// Conciliação Mercado Pago → Olist: quando o dinheiro de um pedido ML é
// liberado (money_release_status=released, o que só acontece depois da entrega),
// dá baixa na conta a receber correspondente no ERP da Olist.
//
// Fluxo por pedido: numeroPedidoEcommerce (raw da Olist) → order/pack no ML →
// payments → money_release no MP → conta a receber via "OC nº" no historico →
// POST /contas-receber/{id}/baixar. Estado em mp_releases (idempotente).

import { getMlAccessToken } from "@/lib/ml-api"
import { fetchMlOrderRelease } from "@/lib/mp-release"
import {
  baixarContaReceber,
  extractOcNumber,
  fetchReceivablesByEmissionRange,
  isReceivableOpen,
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
  mlNotFound: number
  errors: number
  completed: boolean
  planned: BaixaPlanejada[]
  stats: { total: number; released: number; baixados: number; pendentes: number }
  elapsedMs: number
}

export async function runMpReconcile(opts: { dryRun?: boolean; days?: number } = {}): Promise<MpReconcileSummary> {
  const startedAt = Date.now()
  const deadline = startedAt + BUDGET_MS
  const dryRun = opts.dryRun ?? false
  const days = opts.days && opts.days > 0 ? opts.days : DEFAULT_DAYS

  const sinceDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const candidates = await getMpReleaseCandidates(sinceDate, MAX_CANDIDATES)

  let checked = 0
  let released = 0
  let baixados = 0
  let alreadyPaid = 0
  let receivableNotFound = 0
  let mlNotFound = 0
  let errors = 0
  let completed = true
  const planned: BaixaPlanejada[] = []

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
      }

      if (release.releaseStatus !== "released") {
        await upsertMpRelease(base)
        await delay(INTERVALO_MS)
        continue
      }
      released += 1

      const contas = receivablesByOc.get(candidate.mlOrderId) ?? []
      const abertas = contas.filter(isReceivableOpen)
      const pagas = contas.filter((c) => c.situacao === "pago")

      if (!abertas.length) {
        if (pagas.length) {
          alreadyPaid += 1
          await upsertMpRelease({ ...base, receivableId: pagas[0].id ?? null, baixaStatus: "already_paid" })
        } else {
          receivableNotFound += 1
          await upsertMpRelease({
            ...base,
            baixaStatus: "receivable_not_found",
            lastError: contas.length ? `contas em situação: ${contas.map((c) => c.situacao).join(", ")}` : null,
          })
        }
        await delay(INTERVALO_MS)
        continue
      }

      const historico = `Baixa automática: liberação Mercado Pago do pedido ${candidate.mlOrderId}`
      if (dryRun) {
        for (const conta of abertas) {
          planned.push({
            olistId: candidate.olistId,
            mlOrderId: candidate.mlOrderId,
            receivableId: conta.id ?? 0,
            valorConta: toNumber(conta.valor),
            saldo: toNumber(conta.saldo),
            amountMp: release.amount,
            releaseDate: release.releaseDate,
            historico,
          })
        }
        // Persiste o veredito de liberação, mas mantém baixa pendente.
        await upsertMpRelease({ ...base, receivableId: abertas[0].id ?? null, baixaStatus: "pending" })
        await delay(INTERVALO_MS)
        continue
      }

      try {
        for (const conta of abertas) {
          if (!conta.id) continue
          const valorPago = toNumber(conta.saldo) || toNumber(conta.valor)
          await baixarContaReceber(olistToken, conta.id, {
            valorPago,
            data: release.releaseDate ? new Date(release.releaseDate) : new Date(),
            historico,
          })
        }
        baixados += 1
        await upsertMpRelease({ ...base, receivableId: abertas[0].id ?? null, baixaStatus: "done", baixaAt: new Date() })
      } catch (err) {
        errors += 1
        const message = err instanceof Error ? err.message : String(err)
        await upsertMpRelease({ ...base, receivableId: abertas[0].id ?? null, baixaStatus: "error", lastError: message })
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
    mlNotFound,
    errors,
    completed,
    planned: planned.slice(0, 100),
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
