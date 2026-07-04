import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { hasDatabase } from "@/lib/db/client"
import { getOrdersMissingMlCost, upsertMlOrderCost } from "@/lib/db/mlOrderCosts"
import { fetchMlOrderCost, getMlAccessToken } from "@/lib/ml-api"

export const runtime = "nodejs"
export const maxDuration = 300

const BUDGET_MS = 230_000
const INTERVALO_MS = 150 // ~2 chamadas ML por pedido; folga sob o rate limit

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Importa tarifas (sale_fee) e frete do vendedor da API do ML para pedidos que
// ainda não têm custo real. Resumível: rode até remaining=0; agende junto do sync Olist.
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

  const deadline = Date.now() + BUDGET_MS
  let processed = 0
  let notFound = 0
  let errors = 0
  let completed = true

  try {
    const token = await getMlAccessToken()
    const pendentes = await getOrdersMissingMlCost(2000)

    for (const { olistId, mlOrderId } of pendentes) {
      if (Date.now() >= deadline) {
        completed = false
        break
      }
      try {
        const cost = await fetchMlOrderCost(mlOrderId, token)
        if (!cost) {
          notFound += 1
          // Grava tombstone com valores 0 p/ não rebuscar eternamente um id inválido.
          await upsertMlOrderCost({ mlOrderId, olistId, saleFee: 0, shippingCost: 0, listingType: null, mlStatus: "not_found", raw: null })
        } else {
          await upsertMlOrderCost({ ...cost, olistId })
          processed += 1
        }
      } catch {
        errors += 1
        if (errors > 20) {
          completed = false
          break // API instável — para e deixa a próxima execução continuar
        }
      }
      await delay(INTERVALO_MS)
    }

    const restante = await getOrdersMissingMlCost(1)
    return NextResponse.json({ ok: true, processed, notFound, errors, remaining: restante.length, completed })
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
