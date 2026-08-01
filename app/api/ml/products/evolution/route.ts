import { NextResponse } from "next/server"
import { hasDatabase } from "@/lib/db/client"
import {
  getMlEvolutionCoveredMonths,
  getMlEvolutionSyncState,
  getMlProductMonths,
} from "@/lib/db/mlProductEvolution"
import {
  ML_EVOLUTION_TIMEZONE,
  completeMonthWindow,
  groupMonthlyMetrics,
  type MlProductEvolutionResponse,
} from "@/lib/ml-product-evolution"

export const runtime = "nodejs"

export async function GET() {
  const months = completeMonthWindow()
  const empty: MlProductEvolutionResponse = {
    source: "mercado_livre",
    window: {
      months,
      startMonth: months[0],
      endMonth: months.at(-1)!,
      timezone: ML_EVOLUTION_TIMEZONE,
      complete: false,
    },
    sync: {
      status: "unavailable",
      coveredMonths: [],
      lastRun: null,
      lastSuccess: null,
    },
    lastSync: null,
    stale: true,
    products: [],
  }

  if (!hasDatabase()) {
    return NextResponse.json(
      { ...empty, message: "Banco não configurado para a evolução do Mercado Livre." },
      { status: 503 },
    )
  }

  try {
    const [rows, state, coveredMonths] = await Promise.all([
      getMlProductMonths(months),
      getMlEvolutionSyncState(),
      getMlEvolutionCoveredMonths(months),
    ])
    const lastSync = state?.lastSuccessAt?.toISOString() ?? null
    const stale = !state?.lastSuccessAt || Date.now() - state.lastSuccessAt.getTime() > 36 * 60 * 60_000
    const complete = months.every((month) => coveredMonths.includes(month))
    const response: MlProductEvolutionResponse = {
      source: "mercado_livre",
      window: { ...empty.window, complete },
      sync: {
        status: state?.status ?? "idle",
        coveredMonths,
        lastRun: state?.lastRunAt?.toISOString() ?? null,
        lastSuccess: lastSync,
      },
      lastSync,
      stale,
      message: !rows.length
        ? "A sincronização direta do Mercado Livre ainda não carregou nenhum mês."
        : !complete
          ? `Cobertura parcial: ${coveredMonths.length} de ${months.length} meses carregados.`
          : undefined,
      products: groupMonthlyMetrics(rows, months),
    }
    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, max-age=0, s-maxage=300, stale-while-revalidate=60" },
    })
  } catch (error) {
    return NextResponse.json(
      { ...empty, message: safeMessage(error) },
      { status: 500 },
    )
  }
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Não foi possível carregar a evolução de produtos."
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300)
}
