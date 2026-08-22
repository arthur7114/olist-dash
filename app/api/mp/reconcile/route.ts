import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { hasDatabase } from "@/lib/db/client"
import { runMpReconcile } from "@/lib/mp-reconcile"

export const runtime = "nodejs"
export const maxDuration = 300

// Concilia a liberação do Mercado Pago com o contas a receber da Olist: pedidos
// ML com dinheiro liberado (money_release) ganham baixa automática no ERP.
// Resumível: rode até completed=true. `?dryRun=1` só relata o que seria baixado.
// `?full=1` habilita o lançamento de contas de NF para pedidos Full (mutação
// extra na Olist) — DESLIGADO por padrão: o cron faz só as baixas comuns e os
// Full aptos aparecem em `notasALancar` para lote controlado.
export async function POST(request: Request) {
  return handle(request)
}
export async function GET(request: Request) {
  return handle(request)
}

async function handle(request: Request) {
  const secret = process.env.OLIST_SYNC_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: "OLIST_SYNC_SECRET não configurado." }, { status: 500 })
  }
  const url = new URL(request.url)
  const auth = request.headers.get("authorization") ?? ""
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("key") ?? ""
  if (!safeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 })
  }
  if (!hasDatabase()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL não configurado." }, { status: 500 })
  }

  const dryRun = url.searchParams.get("dryRun") === "1"
  const days = Number(url.searchParams.get("days")) || undefined
  const enableFullLancamento = url.searchParams.get("full") === "1"

  try {
    const summary = await runMpReconcile({ dryRun, days, enableFullLancamento })
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
