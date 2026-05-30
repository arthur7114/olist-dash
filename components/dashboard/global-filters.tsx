"use client"

import { useMemo } from "react"
import { RotateCcw, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  VENDEDORES_POR_CANAL,
} from "@/lib/data"
import { useFiltros } from "@/lib/filters"

const PERIODOS: { valor: "7d" | "15d" | "30d" | "tudo"; label: string }[] = [
  { valor: "7d", label: "Últimos 7 dias" },
  { valor: "15d", label: "Últimos 15 dias" },
  { valor: "30d", label: "Últimos 30 dias" },
  { valor: "tudo", label: "Todo o período" },
]

export function GlobalFilters() {
  const { filtros, setFiltro, limpar, opcoes } = useFiltros()

  const vendedoresDisponiveis = useMemo(() => {
    if (filtros.canal === "todos") {
      return opcoes.vendedores
    }
    return VENDEDORES_POR_CANAL[filtros.canal] ?? opcoes.vendedores
  }, [filtros.canal, filtros.vendedor, opcoes.vendedores])

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <SlidersHorizontal className="h-4 w-4" />
        Filtros globais
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Período</Label>
          <Select value={filtros.periodo} onValueChange={(v) => setFiltro("periodo", v as never)}>
            <SelectTrigger className="w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODOS.map((p) => (
                <SelectItem key={p.valor} value={p.valor}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Canal</Label>
          <Select value={filtros.canal} onValueChange={(v) => setFiltro("canal", v as never)}>
            <SelectTrigger className="w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os canais</SelectItem>
              {opcoes.canais.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Vendedor</Label>
          <Select value={filtros.vendedor} onValueChange={(v) => setFiltro("vendedor", v as never)}>
            <SelectTrigger className="w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os vendedores</SelectItem>
              {vendedoresDisponiveis.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">SKU</Label>
          <Select value={filtros.sku} onValueChange={(v) => setFiltro("sku", v as never)}>
            <SelectTrigger className="w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os SKUs</SelectItem>
              {opcoes.produtos.map((p) => (
                <SelectItem key={p.sku} value={p.sku}>
                  {p.sku}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Forma de pagamento</Label>
          <Select
            value={filtros.formaPagamento}
            onValueChange={(v) => setFiltro("formaPagamento", v as never)}
          >
            <SelectTrigger className="w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as formas</SelectItem>
              {opcoes.formasPagamento.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end">
          <Button variant="outline" onClick={limpar} className="w-full gap-2 bg-background">
            <RotateCcw className="h-4 w-4" />
            Limpar
          </Button>
        </div>
      </div>
    </section>
  )
}
