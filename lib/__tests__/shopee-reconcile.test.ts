import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WalletEvent } from "@/lib/shopee-events"
import type { WalletEventRow } from "@/lib/db/shopee"

// Estado em memória no lugar do Postgres.
const store = new Map<string, WalletEventRow & { lastError?: string | null }>()
let creds: { shopId: number; refreshToken: string; accessToken?: string; accessExpiresAt?: Date } | null = null

vi.mock("@/lib/olist-token", () => ({ getOlistAccessToken: async () => "olist-token" }))
vi.mock("@/lib/db/shopee", () => ({
  getShopeeCredentials: async () => creds,
  saveShopeeCredentials: async () => {},
  upsertWalletEvents: async (events: WalletEvent[]) => {
    for (const e of events) {
      const cur = store.get(e.key)
      if (cur?.status === "done") continue
      store.set(e.key, {
        key: e.key,
        kind: e.kind as "income" | "withdrawal",
        orderSn: e.orderSn,
        withdrawalId: e.withdrawalId === null ? null : String(e.withdrawalId),
        amount: e.amount,
        fee: e.fee,
        txnTime: e.txnTime,
        walletState: e.state,
        status: cur?.status ?? (e.state === "ignored" || e.state === "cancelled" ? "ignored" : "pending"),
        receivableId: cur?.receivableId ?? null,
        caixaSaidaId: cur?.caixaSaidaId ?? null,
        caixaEntradaId: cur?.caixaEntradaId ?? null,
      })
    }
  },
  getWalletEventsToProcess: async () =>
    [...store.values()].filter(
      (r) => r.kind !== ("other" as string) && r.walletState === "ready" && ["pending", "receivable_not_found", "error"].includes(r.status),
    ),
  updateWalletEvent: async (key: string, patch: Partial<WalletEventRow> & { lastError?: string | null }) => {
    store.set(key, { ...store.get(key)!, ...patch })
  },
  getWalletEventStats: async () => ({}),
}))

const T = Math.floor(Date.now() / 1000) - 86_400
let wallet: unknown[] = []
let receivables: unknown[] = []
let caixa: Array<{ id: number; historico: string; tipo: string; conta: { id: number } }> = []
let posts: Array<{ path: string; body: Record<string, unknown> }> = []
let failCaixaEntrada = false

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

beforeEach(() => {
  process.env.SHOPEE_PARTNER_ID = "1"
  process.env.SHOPEE_PARTNER_KEY = "k"
  process.env.OLIST_MIN_REQUEST_INTERVAL_MS = "1"
  store.clear()
  creds = { shopId: 600000, refreshToken: "r", accessToken: "a", accessExpiresAt: new Date(Date.now() + 3_600_000) }
  receivables = [
    { id: 11, situacao: "aberto", valor: 51.37, saldo: 51.37, historico: "Ref. a NF nº 3096, Naira - OC nº 260921K0XWYY4U" },
  ]
  wallet = [{ transaction_type: "ESCROW_VERIFIED_ADD", status: "COMPLETED", amount: 40.18, create_time: T, order_sn: "260921K0XWYY4U" }]
  caixa = []
  posts = []
  failCaixaEntrada = false
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      const p = url.pathname
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (p.endsWith("/api/v2/payment/get_wallet_transaction_list")) {
        const from = Number(url.searchParams.get("create_time_from"))
        const to = Number(url.searchParams.get("create_time_to"))
        const list = (wallet as Array<{ create_time: number }>).filter((t) => t.create_time >= from && t.create_time <= to)
        return json({ error: "", response: { transaction_list: url.searchParams.get("page_no") === "0" ? list : [], more: false } })
      }
      if (p.endsWith("/api/v2/payment/get_escrow_detail")) {
        return json({
          error: "",
          response: { order_sn: url.searchParams.get("order_sn"), return_order_sn_list: [], order_income: { escrow_amount: 40.18, commission_fee: 7.19, service_fee: 4 } },
        })
      }
      if (p.endsWith("/contas-financeiras")) {
        return json({ itens: [{ id: 501, descricao: "Shopee" }, { id: 502, descricao: "Banco do Brasil" }] })
      }
      if (p.endsWith("/categorias-receita-despesa")) {
        return json({ itens: [{ id: 601, descricao: "VENDAS SHOPEE" }, { id: 602, descricao: "Transferencia entre contas" }] })
      }
      if (p.endsWith("/contas-receber")) return json({ itens: receivables, paginacao: { total: receivables.length } })
      if (/\/contas-receber\/\d+\/baixar$/.test(p)) {
        posts.push({ path: p, body })
        return new Response(null, { status: 204 })
      }
      if (p.endsWith("/caixa") && init?.method === "POST") {
        if (body.tipo === "C" && failCaixaEntrada) return json({ mensagem: "falhou" }, 400)
        posts.push({ path: p, body })
        const id = 900 + caixa.length
        caixa.push({ id, historico: body.historico, tipo: body.tipo, conta: body.conta })
        return json({ id })
      }
      if (p.endsWith("/caixa")) {
        const conta = Number(url.searchParams.get("idContaFinanceira"))
        return json({ itens: caixa.filter((l) => l.conta.id === conta && l.historico === url.searchParams.get("historico")) })
      }
      return json({}, 404)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe("runShopeeReconcile", () => {
  it("sem loja conectada não falha: devolve skipped", async () => {
    creds = null
    const { runShopeeReconcile } = await import("@/lib/shopee-reconcile")
    expect(await runShopeeReconcile()).toMatchObject({ ok: true, skipped: "shopee_nao_conectada" })
  })

  it("renda liberada vira baixa na conta Shopee pelo líquido com a taxa", async () => {
    const { runShopeeReconcile } = await import("@/lib/shopee-reconcile")
    const s = await runShopeeReconcile()
    expect(s).toMatchObject({ baixados: 1, divergencias: 0, erros: 0, completed: true })
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toMatch(/\/contas-receber\/11\/baixar$/)
    expect(posts[0].body).toMatchObject({ valorPago: 40.18, taxa: 11.19, contaDestino: { id: 501 }, categoria: { id: 601 } })
    expect(store.get("income:260921K0XWYY4U")?.status).toBe("done")

    // Rodar de novo não baixa outra vez.
    await runShopeeReconcile()
    expect(posts).toHaveLength(1)
  })

  it("dry-run só planeja", async () => {
    const { runShopeeReconcile } = await import("@/lib/shopee-reconcile")
    const s = await runShopeeReconcile({ dryRun: true })
    expect(s.planned).toMatchObject([{ acao: "baixa", valor: 40.18, taxa: 11.19, receivableId: 11 }])
    expect(posts).toHaveLength(0)
    expect(store.get("income:260921K0XWYY4U")?.status).toBe("pending")
  })

  it("taxa que não fecha vira divergência e nada é lançado", async () => {
    receivables = [{ ...(receivables[0] as object), valor: 54.08, saldo: 54.08 }]
    const { runShopeeReconcile } = await import("@/lib/shopee-reconcile")
    const s = await runShopeeReconcile()
    expect(s).toMatchObject({ baixados: 0, divergencias: 1 })
    expect(posts).toHaveLength(0)
    expect(store.get("income:260921K0XWYY4U")?.lastError).toMatch(/^fee_mismatch/)
  })

  it("saque concluído vira saída na Shopee e entrada no banco; retoma sem duplicar", async () => {
    wallet = [
      { transaction_type: "WITHDRAWAL_CREATED", status: "COMPLETED", amount: -55.84, create_time: T, withdrawal_id: 9 },
      { transaction_type: "WITHDRAWAL_COMPLETED", status: "COMPLETED", amount: 0, create_time: T + 60, withdrawal_id: 9 },
    ]
    failCaixaEntrada = true
    const { runShopeeReconcile } = await import("@/lib/shopee-reconcile")
    const primeira = await runShopeeReconcile()
    expect(primeira.erros).toBe(1)
    expect(store.get("withdrawal:9")).toMatchObject({ status: "error", caixaSaidaId: 900, caixaEntradaId: null })

    failCaixaEntrada = false
    const segunda = await runShopeeReconcile()
    expect(segunda.transferencias).toBe(1)
    expect(caixa.map((l) => [l.tipo, l.conta.id, l.historico])).toEqual([
      ["D", 501, "Saque Shopee #9"],
      ["C", 502, "Saque Shopee #9"],
    ])
    expect(store.get("withdrawal:9")).toMatchObject({ status: "done", caixaSaidaId: 900, caixaEntradaId: 901 })
  })

  it("saque ainda não concluído espera", async () => {
    wallet = [{ transaction_type: "WITHDRAWAL_CREATED", status: "COMPLETED", amount: -55.84, create_time: T, withdrawal_id: 9 }]
    const { runShopeeReconcile } = await import("@/lib/shopee-reconcile")
    const s = await runShopeeReconcile()
    expect(s.transferencias).toBe(0)
    expect(caixa).toHaveLength(0)
  })
})
