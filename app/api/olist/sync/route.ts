import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { runSync } from "@/lib/olist-sync"
import { hasDatabase } from "@/lib/db/client"
import { saveSyncState } from "@/lib/db/syncState"

// Carga a frio/backfill pode demorar; roda em Node e com folga de tempo.
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

  const full = url.searchParams.get("full") === "1"
  try {
    const summary = await runSync({ full })
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    try {
      await saveSyncState({ lastRunAt: new Date(), status: "error", lastError: message })
    } catch {
      // não mascara o erro original
    }
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
