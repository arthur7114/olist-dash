import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { runBackfillListingCosts } from "@/lib/olist-sync"
import { hasDatabase } from "@/lib/db/client"

// Preenche o custo de anúncios ativos que nunca venderam, buscando no cadastro da Olist por SKU.
// Resumível: rode de novo até remaining = 0. Parâmetro opcional ?limit=N (padrão 500).
export const runtime = "nodejs"
export const maxDuration = 300

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

  try {
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit")) || 500))
    return NextResponse.json(await runBackfillListingCosts({ limit }))
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
