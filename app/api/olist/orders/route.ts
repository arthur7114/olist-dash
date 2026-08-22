import { NextResponse } from "next/server"
import { PEDIDOS } from "@/lib/data"
import { hasDatabase } from "@/lib/db/client"
import { getOrdersByPeriod } from "@/lib/db/orders"
import { getItemsByOrderIds } from "@/lib/db/orderItems"
import { getSyncState } from "@/lib/db/syncState"
import { normalizarPeriodo, rangePeriodo, rangePersonalizado } from "@/lib/periodo"

export const runtime = "nodejs"

// O dashboard lê do banco (preenchido pelo job de sync) — sem chamadas à Olist aqui.
// Busca desde o início da janela ANTERIOR para o cliente montar o comparativo.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const periodo = normalizarPeriodo(url.searchParams.get("periodo"))
  const de = url.searchParams.get("de")
  const ate = url.searchParams.get("ate")
  const baseValor = url.searchParams.get("base") === "nota" ? "nota" : "venda"

  if (!hasDatabase()) {
    return NextResponse.json({
      source: "mock",
      authenticated: false,
      pedidos: PEDIDOS,
      message: "Banco não configurado. Mostrando dados de exemplo.",
    })
  }

  try {
    const range = periodo === "custom" && de && ate ? rangePersonalizado(de, ate) : rangePeriodo(periodo, new Date())
    const dataInicial = range.inicioAnterior ?? range.inicio ?? "1970-01-01"
    const [pedidos, state] = await Promise.all([getOrdersByPeriod(dataInicial, baseValor), getSyncState()])
    const itensPorPedido = await getItemsByOrderIds(pedidos.map((p) => p.id))
    const pedidosComItens = pedidos.map((p) => ({ ...p, itens: itensPorPedido.get(p.id) ?? [] }))

    // Uma consulta válida por NF pode não ter resultados. Nesse caso o vazio é dado
    // real — nunca substitua por pedidos mockados, que não respeitariam o filtro fiscal.
    if (!pedidosComItens.length && baseValor === "nota") {
      return NextResponse.json({
        source: "real",
        authenticated: Boolean(state),
        pedidos: [],
        message: "Nenhuma nota fiscal emitida no período.",
        lastSync: state?.lastSuccessAt ?? null,
      })
    }

    if (!pedidosComItens.length) {
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
      pedidos: pedidosComItens,
      message: `${pedidosComItens.length} pedidos carregados do banco.`,
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
