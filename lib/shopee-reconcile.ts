// Conciliação carteira Shopee → Olist (spec 2026-09-26). Por execução:
// 1. lê a carteira da janela e grava os eventos (lib/shopee-events);
// 2. renda de pedido liberada → acha a conta a receber pelo "OC nº <order_sn>" →
//    decisão pura (planShopeeBaixa) → baixa na conta Shopee pelo líquido + taxa;
// 3. saque concluído → saída na conta Shopee e entrada no banco, cada metade gravada
//    no estado assim que criada (retomável sem duplicar).
// Nada é lançado na dúvida: divergência fica no estado com o motivo.

import {
  fetchEscrowDetail,
  fetchWalletTransactions,
  hasShopeeConfig,
  refreshShopeeToken,
  type ShopeeAuth,
} from "@/lib/shopee-api"
import { toWalletEvents } from "@/lib/shopee-events"
import { extractShopeeOc, planShopeeBaixa, planWithdrawal } from "@/lib/shopee-baixa-plan"
import {
  baixarContaReceber,
  createCaixaLancamento,
  fetchCategoriasReceitaDespesa,
  fetchContasFinanceiras,
  fetchReceivablesByEmissionRange,
  findCaixaLancamentos,
  formatDateIso,
  toNumber,
  type NamedRef,
  type TinyReceivable,
} from "@/lib/olist-v3"
import { getOlistAccessToken } from "@/lib/olist-token"
import {
  getShopeeCredentials,
  getWalletEventsToProcess,
  getWalletEventStats,
  saveShopeeCredentials,
  updateWalletEvent,
  upsertWalletEvents,
  type WalletEventRow,
} from "@/lib/db/shopee"

const BUDGET_MS = Number(process.env.SHOPEE_RECONCILE_BUDGET_MS) || 230_000
const DEFAULT_DAYS = Number(process.env.SHOPEE_RECONCILE_DAYS) || 30
// Conta a receber nasce na emissão da NF; a Shopee libera semanas depois.
const EMISSAO_FOLGA_DIAS = 60

export type ShopeePlanned = {
  key: string
  acao: "baixa" | "transferencia"
  valor: number
  taxa?: number
  receivableId?: number
  historico: string
}

export type ShopeeReconcileSummary = {
  ok: true
  skipped?: "shopee_sem_app" | "shopee_nao_conectada"
  dryRun: boolean
  days: number
  transacoes: number
  eventos: number
  processados: number
  baixados: number
  jaPagos: number
  semConta: number
  divergencias: number
  transferencias: number
  erros: number
  completed: boolean
  planned: ShopeePlanned[]
  stats: Record<string, number>
  elapsedMs: number
}

type OlistIds = { contaShopee: number; contaBanco: number | null; vendasShopee: number; transferencia: number | null }

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase()

function pick(list: NamedRef[], envName: string, nome: string): number | null {
  const fromEnv = Number(process.env[envName])
  if (fromEnv) return fromEnv
  return list.find((i) => norm(i.descricao) === norm(nome))?.id ?? null
}

// Contas e categorias por nome (override por env). Conta Shopee e categoria de venda
// são obrigatórias; banco e transferência só travam os saques.
async function resolveOlistIds(token: string): Promise<OlistIds> {
  const [contas, categorias] = await Promise.all([fetchContasFinanceiras(token), fetchCategoriasReceitaDespesa(token)])
  const contaShopee = pick(contas, "OLIST_SHOPEE_CONTA_ID", "Shopee")
  const vendasShopee = pick(categorias, "OLIST_SHOPEE_VENDAS_CATEGORIA_ID", "VENDAS SHOPEE")
  const faltando = [
    contaShopee ? null : 'conta financeira "Shopee"',
    vendasShopee ? null : 'categoria "VENDAS SHOPEE"',
  ].filter(Boolean)
  if (faltando.length) throw new Error(`Falta na Olist: ${faltando.join(" e ")}. Crie e rode de novo.`)
  return {
    contaShopee: contaShopee!,
    vendasShopee: vendasShopee!,
    contaBanco: pick(contas, "OLIST_SHOPEE_BANCO_CONTA_ID", "Banco do Brasil"),
    transferencia: pick(categorias, "OLIST_TRANSFERENCIA_CATEGORIA_ID", "Transferência entre contas"),
  }
}

// Access token dura 4 h; o refresh é de uso único, então o novo é salvo antes de usar.
async function getShopeeAuth(creds: NonNullable<Awaited<ReturnType<typeof getShopeeCredentials>>>): Promise<ShopeeAuth> {
  if (creds.accessToken && creds.accessExpiresAt && creds.accessExpiresAt.getTime() > Date.now() + 300_000) {
    return { accessToken: creds.accessToken, shopId: creds.shopId }
  }
  const token = await refreshShopeeToken(creds.refreshToken, creds.shopId)
  await saveShopeeCredentials(creds.shopId, token)
  return { accessToken: token.accessToken, shopId: creds.shopId }
}

function indexByShopeeOc(receivables: TinyReceivable[]): Map<string, TinyReceivable[]> {
  const map = new Map<string, TinyReceivable[]>()
  for (const r of receivables) {
    const oc = extractShopeeOc(r.historico)
    if (oc) map.set(oc, [...(map.get(oc) ?? []), r])
  }
  return map
}

const shiftDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

export async function runShopeeReconcile(opts: { dryRun?: boolean; days?: number } = {}): Promise<ShopeeReconcileSummary> {
  const startedAt = Date.now()
  const deadline = startedAt + BUDGET_MS
  const dryRun = opts.dryRun ?? false
  const days = opts.days && opts.days > 0 ? opts.days : DEFAULT_DAYS
  const summary: ShopeeReconcileSummary = {
    ok: true,
    dryRun,
    days,
    transacoes: 0,
    eventos: 0,
    processados: 0,
    baixados: 0,
    jaPagos: 0,
    semConta: 0,
    divergencias: 0,
    transferencias: 0,
    erros: 0,
    completed: true,
    planned: [],
    stats: {},
    elapsedMs: 0,
  }
  const finish = async () => ({ ...summary, stats: await getWalletEventStats(), elapsedMs: Date.now() - startedAt })

  // Sem app ou sem loja conectada não é falha: o cron roda todo dia até o app sair.
  if (!hasShopeeConfig()) return { ...summary, skipped: "shopee_sem_app", elapsedMs: Date.now() - startedAt }
  const creds = await getShopeeCredentials()
  if (!creds) return { ...summary, skipped: "shopee_nao_conectada", elapsedMs: Date.now() - startedAt }

  const auth = await getShopeeAuth(creds)
  const nowSec = Math.floor(Date.now() / 1000)
  const txns = await fetchWalletTransactions(auth, nowSec - days * 86_400, nowSec)
  const events = toWalletEvents(txns)
  summary.transacoes = txns.length
  summary.eventos = events.length
  await upsertWalletEvents(events)

  const fila = await getWalletEventsToProcess()
  if (!fila.length) return finish()

  const olistToken = await getOlistAccessToken()
  const ids = await resolveOlistIds(olistToken)

  const rendas = fila.filter((e) => e.kind === "income")
  let byOc = new Map<string, TinyReceivable[]>()
  if (rendas.length) {
    const maisAntiga = rendas.reduce((min, e) => (e.txnTime < min ? e.txnTime : min), rendas[0].txnTime)
    byOc = indexByShopeeOc(
      await fetchReceivablesByEmissionRange(olistToken, formatDateIso(shiftDays(maisAntiga, -EMISSAO_FOLGA_DIAS)), formatDateIso(new Date())),
    )
  }

  for (const ev of fila) {
    if (Date.now() >= deadline) {
      summary.completed = false
      break
    }
    summary.processados += 1
    try {
      if (ev.kind === "income") await processIncome(ev)
      else await processWithdrawal(ev)
    } catch (err) {
      summary.erros += 1
      await updateWalletEvent(ev.key, { status: "error", lastError: err instanceof Error ? err.message.slice(0, 500) : String(err) })
    }
  }
  return finish()

  async function processIncome(ev: WalletEventRow) {
    const orderSn = ev.orderSn!
    const escrow = await fetchEscrowDetail(auth, orderSn)
    const contas = byOc.get(orderSn.toUpperCase()) ?? []
    const decision = planShopeeBaixa({ credited: ev.amount, escrow }, contas)
    const detail = { orderIncome: escrow.order_income ?? null, returns: escrow.return_order_sn_list ?? [] }

    if (decision.action === "already_paid") {
      summary.jaPagos += 1
      await updateWalletEvent(ev.key, { status: "already_paid", receivableId: decision.receivableId, detail, lastError: null })
      return
    }
    if (decision.action === "receivable_not_found") {
      summary.semConta += 1
      await updateWalletEvent(ev.key, { status: "receivable_not_found", detail, lastError: `nenhuma conta a receber com OC nº ${orderSn}` })
      return
    }
    if (decision.action === "divergence") {
      summary.divergencias += 1
      await updateWalletEvent(ev.key, { status: "divergence", detail, lastError: `${decision.reason}: ${decision.detail}` })
      return
    }

    const conta = contas.find((c) => c.id === decision.receivableId)
    const historico = `Baixa Shopee: pedido ${orderSn} bruto ${toNumber(conta?.valor).toFixed(2)} líquido ${decision.valorPago.toFixed(2)} tarifa ${decision.taxa.toFixed(2)}`
    if (dryRun) {
      summary.planned.push({ key: ev.key, acao: "baixa", valor: decision.valorPago, taxa: decision.taxa, receivableId: decision.receivableId, historico })
      await updateWalletEvent(ev.key, { receivableId: decision.receivableId, detail })
      return
    }
    await baixarContaReceber(olistToken, decision.receivableId, {
      valorPago: decision.valorPago,
      taxa: decision.taxa,
      contaDestino: { id: ids.contaShopee },
      categoria: { id: ids.vendasShopee },
      data: ev.txnTime,
      historico,
    })
    summary.baixados += 1
    await updateWalletEvent(ev.key, { status: "done", receivableId: decision.receivableId, detail, lastError: null, doneAt: new Date() })
  }

  async function processWithdrawal(ev: WalletEventRow) {
    const decision = planWithdrawal({ state: ev.walletState, amount: ev.amount, fee: ev.fee })
    if (decision.action === "wait") return
    if (decision.action === "divergence") {
      summary.divergencias += 1
      await updateWalletEvent(ev.key, { status: "divergence", lastError: `${decision.reason}: ${decision.detail}` })
      return
    }
    const faltando = [ids.contaBanco ? null : 'conta financeira "Banco do Brasil"', ids.transferencia ? null : 'categoria "Transferência entre contas"'].filter(Boolean)
    if (faltando.length) throw new Error(`Falta na Olist: ${faltando.join(" e ")}.`)

    const historico = `Saque Shopee #${ev.withdrawalId}`
    if (dryRun) {
      summary.planned.push({ key: ev.key, acao: "transferencia", valor: decision.valor, historico })
      return
    }

    // Antes de criar, procura pelo histórico: protege contra queda entre o POST e o registro.
    const lancar = async (tipo: "D" | "C", contaId: number): Promise<number> => {
      const existentes = await findCaixaLancamentos(olistToken, {
        historico,
        contaId,
        dataInicial: formatDateIso(shiftDays(ev.txnTime, -3)),
        dataFinal: formatDateIso(shiftDays(ev.txnTime, 3)),
      })
      const achado = existentes.find((l) => l.historico === historico && (!l.tipo || l.tipo === tipo))
      if (achado?.id) return achado.id
      const id = await createCaixaLancamento(olistToken, { data: ev.txnTime, historico, valor: decision.valor, tipo, contaId, categoriaId: ids.transferencia! })
      if (!id) throw new Error(`Olist não devolveu o id do lançamento ${tipo} de ${historico}`)
      return id
    }

    const saidaId = ev.caixaSaidaId ?? (await lancar("D", ids.contaShopee))
    if (!ev.caixaSaidaId) await updateWalletEvent(ev.key, { caixaSaidaId: saidaId })
    const entradaId = ev.caixaEntradaId ?? (await lancar("C", ids.contaBanco!))
    summary.transferencias += 1
    await updateWalletEvent(ev.key, { status: "done", caixaSaidaId: saidaId, caixaEntradaId: entradaId, lastError: null, doneAt: new Date() })
  }
}
