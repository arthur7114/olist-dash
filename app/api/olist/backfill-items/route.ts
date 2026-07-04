import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { hasDatabase } from "@/lib/db/client"
import { getAllProductCosts } from "@/lib/db/productCosts"
import { getOrdersWithoutItems, replaceOrderItems } from "@/lib/db/orderItems"
import { extractOrderItems } from "@/lib/olist-items"
import type { TinyOrderDetail } from "@/lib/olist-v3"

export const runtime = "nodejs"
export const maxDuration = 300

const BUDGET_MS = 230_000

// Extrai itens do `raw` de pedidos já sincronizados — SEM chamar a Olist.
// Resumível: rode repetidas vezes até remaining=0.
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
  const custos = await getAllProductCosts()
  const porId = new Map<number, number>()
  const porSku = new Map<string, number>()
  for (const { ref, custo } of custos) {
    if (ref.startsWith("id:")) porId.set(Number(ref.slice(3)), custo)
    else if (ref.startsWith("sku:")) porSku.set(ref.slice(4), custo)
  }
  const custoDe = (id?: number, sku?: string) =>
    (id !== undefined ? porId.get(id) : undefined) ?? (sku ? porSku.get(sku) : undefined) ?? 0

  let processed = 0
  let itensGravados = 0
  let completed = true

  while (true) {
    if (Date.now() >= deadline) {
      completed = false
      break
    }
    const lote = await getOrdersWithoutItems(300)
    if (!lote.length) break
    itensGravados += await replaceOrderItems(
      lote.map((o) => ({
        olistId: o.olistId,
        data: o.data,
        itens: extractOrderItems(o.raw as TinyOrderDetail, custoDe),
      })),
    )
    processed += lote.length
    if (lote.length < 300) break
  }

  const restante = await getOrdersWithoutItems(1)
  return NextResponse.json({ ok: true, processed, itensGravados, remaining: restante.length, completed })
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
