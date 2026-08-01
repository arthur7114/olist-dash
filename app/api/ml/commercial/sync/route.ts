import { NextResponse } from "next/server"
import { isExtensionAuthorized } from "@/lib/extension-auth"
import { hasDatabase } from "@/lib/db/client"
import { syncMlCommercialData } from "@/lib/ml-commercial-sync"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(request: Request) {
  if (!isExtensionAuthorized(request, process.env.OLIST_SYNC_SECRET)) {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 })
  }
  if (!hasDatabase()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL não configurado." }, { status: 503 })
  }
  try {
    return NextResponse.json(await syncMlCommercialData())
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
