// Períodos do filtro global. Todas as datas são yyyy-mm-dd INCLUSIVAS (UTC).
// A janela "anterior" tem a mesma duração da atual e termina no dia anterior
// ao início dela — base do comparativo "vs. período anterior" dos KPIs.

export type PeriodoOpcao = "7d" | "15d" | "30d" | "90d" | "mes" | "mes-anterior" | "tudo"

export interface RangePeriodo {
  inicio: string | null
  fim: string | null
  inicioAnterior: string | null
  fimAnterior: string | null
}

export const PERIODOS_VALIDOS: PeriodoOpcao[] = ["7d", "15d", "30d", "90d", "mes", "mes-anterior", "tudo"]

const DIAS: Partial<Record<PeriodoOpcao, number>> = { "7d": 7, "15d": 15, "30d": 30, "90d": 90 }

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDias(d: Date, n: number): Date {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}

function inicioDoMes(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function fimDoMesAnterior(d: Date): Date {
  return addDias(inicioDoMes(d), -1)
}

// Mesmo dia no mês anterior, limitado ao último dia daquele mês (31/03 → 28/02).
function mesmoDiaMesAnterior(d: Date): Date {
  const fimAnt = fimDoMesAnterior(d)
  const dia = Math.min(d.getUTCDate(), fimAnt.getUTCDate())
  return new Date(Date.UTC(fimAnt.getUTCFullYear(), fimAnt.getUTCMonth(), dia))
}

export function rangePeriodo(periodo: PeriodoOpcao, referencia: Date): RangePeriodo {
  const ref = new Date(iso(referencia) + "T00:00:00Z")

  const dias = DIAS[periodo]
  if (dias) {
    return {
      inicio: iso(addDias(ref, -(dias - 1))),
      fim: iso(ref),
      inicioAnterior: iso(addDias(ref, -(2 * dias - 1))),
      fimAnterior: iso(addDias(ref, -dias)),
    }
  }

  if (periodo === "mes") {
    return {
      inicio: iso(inicioDoMes(ref)),
      fim: iso(ref),
      inicioAnterior: iso(inicioDoMes(fimDoMesAnterior(ref))),
      fimAnterior: iso(mesmoDiaMesAnterior(ref)),
    }
  }

  if (periodo === "mes-anterior") {
    const fim = fimDoMesAnterior(ref)
    const inicio = inicioDoMes(fim)
    const fimRetrasado = addDias(inicio, -1)
    return {
      inicio: iso(inicio),
      fim: iso(fim),
      inicioAnterior: iso(inicioDoMes(fimRetrasado)),
      fimAnterior: iso(fimRetrasado),
    }
  }

  return { inicio: null, fim: null, inicioAnterior: null, fimAnterior: null }
}

export function normalizarPeriodo(valor: string | null): PeriodoOpcao {
  return PERIODOS_VALIDOS.includes(valor as PeriodoOpcao) ? (valor as PeriodoOpcao) : "30d"
}
