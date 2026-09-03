"use client"

import { BadgeCheck } from "lucide-react"
import { useFiltros } from "@/lib/filters"
import { formatPercent, isCanalMercadoLivre } from "@/lib/data"

// Mostra quantos pedidos ML do período têm tarifa/frete REAIS da API do ML.
// Some quando não há pedidos ML no filtro atual.
export function MlCostCoverage() {
  const { pedidosFiltrados } = useFiltros()
  const ml = pedidosFiltrados.filter((p) => isCanalMercadoLivre(p.canal))
  if (!ml.length) return null
  const reais = ml.filter((p) => p.custoMlReal).length
  const cobertura = reais / ml.length

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <BadgeCheck className="size-3.5 text-success" />
      <span>
        Custo ML real em <span className="font-medium text-foreground">{formatPercent(cobertura, 0)}</span> dos
        pedidos do Mercado Livre no período — o restante usa estimativa.
      </span>
    </div>
  )
}
