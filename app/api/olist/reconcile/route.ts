import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { hasDatabase } from "@/lib/db/client"
import { getOrdersForReconcile } from "@/lib/db/orders"
import { getSyncState } from "@/lib/db/syncState"
import { normalizarPeriodo, rangePeriodo, rangePersonalizado } from "@/lib/periodo"
import { reconciliar } from "@/lib/reconcile"

// Relatório de reconciliação dash × Olist para uma janela: soma o período sob todas
// as definições de faturamento que a Olist expõe, quebrado por situação. Diagnóstico
// somente-leitura — compare com a tela da Olist para achar qual definição bate.
//
//   GET /api/olist/reconcile?key=$OLIST_SYNC_SECRET&periodo=30d
//   GET /api/olist/reconcile?key=$OLIST_SYNC_SECRET&de=2026-07-01&ate=2026-07-25
export const runtime = "nodejs"

export async function GET(request: Request) {
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

  const de = url.searchParams.get("de")
  const ate = url.searchParams.get("ate")
  // Janela ancorada em HOJE (não na maior data do dataset), para casar com o que a
  // tela da Olist mostra quando o usuário pede "últimos N dias".
  const range =
    de && ate ? rangePersonalizado(de, ate) : rangePeriodo(normalizarPeriodo(url.searchParams.get("periodo")), new Date())

  if (!range.inicio || !range.fim) {
    return NextResponse.json({ ok: false, error: "Janela inválida (use periodo, ou de+ate em yyyy-mm-dd)." }, { status: 400 })
  }

  try {
    const [rows, state] = await Promise.all([
      getOrdersForReconcile(range.inicio, range.fim),
      getSyncState(),
    ])
    return NextResponse.json({
      ok: true,
      // Sync atrasado é causa comum de divergência: a janela do dash existe, mas
      // os pedidos dos últimos dias ainda não foram gravados.
      sync: {
        status: state?.status ?? null,
        lastSuccessAt: state?.lastSuccessAt ?? null,
        cursorData: state?.cursorData ?? null,
        ordersSynced: state?.ordersSynced ?? null,
      },
      ...reconciliar(rows, { de: range.inicio, ate: range.fim }),
    })
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
