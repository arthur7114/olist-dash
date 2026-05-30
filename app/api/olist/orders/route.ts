import { NextResponse } from "next/server"
import { PEDIDOS } from "@/lib/data"
import { hasDatabase } from "@/lib/db/client"
import { getOrdersByPeriod } from "@/lib/db/orders"
import { getSyncState } from "@/lib/db/syncState"
import { getOrderDateRange, normalizePeriod } from "@/lib/olist-v3"

export const runtime = "nodejs"

// O dashboard lê do banco (preenchido pelo job de sync) — sem chamadas à Olist aqui.
export async function GET(request: Request) {
  const periodo = new URL(request.url).searchParams.get("periodo") ?? "7d"

  if (!hasDatabase()) {
    return NextResponse.json({
      source: "mock",
      authenticated: false,
      pedidos: PEDIDOS,
      message: "Banco não configurado. Mostrando dados de exemplo.",
    })
  }

  try {
    const dataInicial =
      periodo === "tudo" ? "1970-01-01" : getOrderDateRange(normalizePeriod(periodo)).dataInicial
    const [pedidos, state] = await Promise.all([getOrdersByPeriod(dataInicial), getSyncState()])

    if (!pedidos.length) {
      return NextResponse.json({
        source: "mock",
        authenticated: Boolean(state),
        pedidos: PEDIDOS,
        message:
          state?.status === "backfilling"
            ? "Sincronização em andamento — mostrando dados de exemplo até concluir."
            : "Sem dados no banco ainda. Conecte a Olist e rode o sync.",
        lastSync: state?.lastSuccessAt ?? null,
      })
    }

    return NextResponse.json({
      source: "real",
      authenticated: true,
      pedidos,
      message: `${pedidos.length} pedidos carregados do banco.`,
      lastSync: state?.lastSuccessAt ?? null,
    })
  } catch (err) {
    return NextResponse.json({
      source: "mock",
      authenticated: false,
      pedidos: PEDIDOS,
      message: err instanceof Error ? err.message : "Não foi possível ler o banco.",
    })
  }
}
