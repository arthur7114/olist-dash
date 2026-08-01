import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { hasDatabase } from "@/lib/db/client"
import {
  getMlEvolutionCoveredMonths,
  getMlEvolutionSyncState,
  replaceMlProductMonth,
  saveMlEvolutionSyncState,
} from "@/lib/db/mlProductEvolution"
import { completeMonthWindow, pendingEvolutionMonths } from "@/lib/ml-product-evolution"
import { createMlEvolutionSyncContext, syncMlProductMonth } from "@/lib/ml-product-sync"
import { getMlAccessToken } from "@/lib/ml-api"

export const runtime = "nodejs"
export const maxDuration = 300

const BUDGET_MS = 230_000

export async function POST(request: Request) {
  const authError = authorize(request)
  if (authError) return authError
  if (!hasDatabase()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL não configurado." }, { status: 500 })
  }

  const url = new URL(request.url)
  const full = url.searchParams.get("full") === "1"
  const mode = full ? "backfilling" : "refreshing"
  const windowMonths = completeMonthWindow()
  const deadline = Date.now() + BUDGET_MS
  const processedMonths: string[] = []

  try {
    const previousState = await getMlEvolutionSyncState()
    const { pending } = pendingEvolutionMonths(windowMonths, full, previousState)

    await saveMlEvolutionSyncState({
      status: mode,
      cursorMonth: pending[0] ?? null,
      lastRunAt: new Date(),
      lastError: null,
    })

    const token = await getMlAccessToken()
    const context = await createMlEvolutionSyncContext(token)
    let cursorMonth: string | null = pending[0] ?? null

    for (let index = 0; index < pending.length; index += 1) {
      if (processedMonths.length && Date.now() >= deadline) break
      const month = pending[index]
      cursorMonth = month
      const rows = await syncMlProductMonth(month, context, token)
      await replaceMlProductMonth(month, rows)
      processedMonths.push(month)
      cursorMonth = pending[index + 1] ?? null
      const coveredMonths = await getMlEvolutionCoveredMonths(windowMonths)
      await saveMlEvolutionSyncState({
        status: cursorMonth ? mode : "idle",
        cursorMonth,
        coveredMonths,
        lastSuccessAt: new Date(),
        lastError: null,
      })
    }

    const coveredMonths = await getMlEvolutionCoveredMonths(windowMonths)
    const completed = cursorMonth === null
    return NextResponse.json({
      ok: true,
      mode,
      processedMonths,
      coveredMonths,
      cursorMonth,
      completed,
    })
  } catch (error) {
    const current = await getMlEvolutionSyncState()
    const message = safeMessage(error)
    await saveMlEvolutionSyncState({
      status: `${mode}_error`,
      cursorMonth: current?.cursorMonth ?? null,
      lastError: message,
    })
    return NextResponse.json({ ok: false, processedMonths, error: message }, { status: 500 })
  }
}

function authorize(request: Request): NextResponse | null {
  const secret = process.env.OLIST_SYNC_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: "OLIST_SYNC_SECRET não configurado." }, { status: 500 })
  }
  const auth = request.headers.get("authorization") ?? ""
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 })
  }
  return null
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Falha desconhecida na sincronização."
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300)
}
