"use client"

import { useMemo, useState } from "react"
import { CalendarIcon, RotateCcw } from "lucide-react"
import { ptBR } from "date-fns/locale"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { VENDEDORES_POR_CANAL, formatData } from "@/lib/data"
import { useFiltros } from "@/lib/filters"
import type { PeriodoOpcao } from "@/lib/periodo"
import { cn } from "@/lib/utils"

const PERIODOS: { valor: PeriodoOpcao; label: string }[] = [
  { valor: "7d", label: "Últimos 7 dias" },
  { valor: "15d", label: "Últimos 15 dias" },
  { valor: "30d", label: "Últimos 30 dias" },
  { valor: "90d", label: "Últimos 90 dias" },
  { valor: "mes", label: "Mês atual" },
  { valor: "mes-anterior", label: "Mês anterior" },
  { valor: "tudo", label: "Todo o período" },
  { valor: "custom", label: "Personalizado" },
]

function dataParaChave(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function GlobalFilters() {
  const { filtros, setFiltro, setPeriodoPersonalizado, limpar, opcoes } = useFiltros()
  const [popoverAberto, setPopoverAberto] = useState(false)
  const [rascunho, setRascunho] = useState<DateRange | undefined>(undefined)

  const vendedoresDisponiveis = useMemo(() => {
    if (filtros.canal === "todos") {
      return opcoes.vendedores
    }
    return VENDEDORES_POR_CANAL[filtros.canal] ?? opcoes.vendedores
  }, [filtros.canal, filtros.vendedor, opcoes.vendedores])

  const rotuloPersonalizado =
    filtros.customInicio && filtros.customFim
      ? `${formatData(filtros.customInicio)} – ${formatData(filtros.customFim)}`
      : "Selecionar datas"

  return (
    <section className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <Select
        value={filtros.periodo}
        onValueChange={(v) => {
          setFiltro("periodo", v as PeriodoOpcao)
          if (v === "custom") setPopoverAberto(true)
        }}
      >
        <SelectTrigger size="sm" className="w-[150px] bg-background" aria-label="Período">
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

      {filtros.periodo === "custom" && (
        <Popover
          open={popoverAberto}
          onOpenChange={(aberto) => {
            setPopoverAberto(aberto)
            if (aberto) {
              setRascunho(
                filtros.customInicio && filtros.customFim
                  ? { from: new Date(filtros.customInicio + "T00:00:00"), to: new Date(filtros.customFim + "T00:00:00") }
                  : undefined,
              )
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn("gap-1.5 bg-background font-normal", !filtros.customInicio && "text-muted-foreground")}
            >
              <CalendarIcon className="size-3.5" />
              {rotuloPersonalizado}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              locale={ptBR}
              numberOfMonths={2}
              selected={rascunho}
              onSelect={setRascunho}
              disabled={{ after: new Date() }}
            />
            <div className="flex items-center justify-between gap-2 border-t border-border p-3">
              <span className="text-xs text-muted-foreground">
                {rascunho?.from
                  ? `${formatData(dataParaChave(rascunho.from))} – ${rascunho.to ? formatData(dataParaChave(rascunho.to)) : "?"}`
                  : "Selecione o início e o fim"}
              </span>
              <Button
                size="sm"
                disabled={!rascunho?.from || !rascunho?.to}
                onClick={() => {
                  if (!rascunho?.from || !rascunho?.to) return
                  setPeriodoPersonalizado(dataParaChave(rascunho.from), dataParaChave(rascunho.to))
                  setPopoverAberto(false)
                }}
              >
                Aplicar
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}

      <Select value={filtros.canal} onValueChange={(v) => setFiltro("canal", v as never)}>
        <SelectTrigger size="sm" className="w-[150px] bg-background" aria-label="Canal">
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

      <Select value={filtros.vendedor} onValueChange={(v) => setFiltro("vendedor", v as never)}>
        <SelectTrigger size="sm" className="w-[160px] bg-background" aria-label="Vendedor">
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

      <Select value={filtros.sku} onValueChange={(v) => setFiltro("sku", v as never)}>
        <SelectTrigger size="sm" className="w-[140px] bg-background" aria-label="SKU">
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

      <Select value={filtros.formaPagamento} onValueChange={(v) => setFiltro("formaPagamento", v as never)}>
        <SelectTrigger size="sm" className="w-[160px] bg-background" aria-label="Forma de pagamento">
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

      <Button variant="ghost" size="sm" onClick={limpar} className="ml-auto gap-1.5 text-muted-foreground">
        <RotateCcw className="size-3.5" />
        Limpar
      </Button>
    </section>
  )
}
