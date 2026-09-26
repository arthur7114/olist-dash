import { NextResponse } from "next/server"
import { hasDatabase } from "@/lib/db/client"
import { runShopeeReconcile } from "@/lib/shopee-reconcile"
import { isSyncAuthorized } from "@/lib/sync-auth"

export const runtime = "nodejs"
export const maxDuration = 300

// Concilia a carteira Shopee com a Olist: renda liberada → baixa na conta Shopee;
// saque concluído → transferência Shopee → banco. Resumível: rode até completed=true.
// `?dryRun=1` só relata. `?days=` muda a janela (padrão 30).
export async function POST(request: Request) {
  return handle(request)
}
export async function GET(request: Request) {
  return handle(request)
}

async function handle(request: Request) {
  if (!process.env.OLIST_SYNC_SECRET) {
    return NextResponse.json({ ok: false, error: "OLIST_SYNC_SECRET não configurado." }, { status: 500 })
  }
  if (!isSyncAuthorized(request)) return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 })
  if (!hasDatabase()) return NextResponse.json({ ok: false, error: "DATABASE_URL não configurado." }, { status: 500 })

  const url = new URL(request.url)
  try {
    const summary = await runShopeeReconcile({
      dryRun: url.searchParams.get("dryRun") === "1",
      days: Number(url.searchParams.get("days")) || undefined,
    })
    return NextResponse.json(summary)
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
