"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  AlertCircle,
  Boxes,
  CalendarRange,
  CircleDollarSign,
  Clock3,
  Info,
  RefreshCw,
  Search,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DataTable } from "@/components/dashboard/data-table"
import { formatBRL, formatBRLCompacto, formatNumero, formatPercent } from "@/lib/data"
import {
  evolutionRows,
  metricValue,
  type EvolutionBasis,
  type EvolutionMetric,
  type EvolutionRow,
  type MlEvolutionProduct,
  type MlProductEvolutionResponse,
} from "@/lib/ml-product-evolution"
import { cn } from "@/lib/utils"

const BASIS_LABEL: Record<EvolutionBasis, string> = {
  paid: "Vendas pagas",
  created: "Pedidos criados",
}

const METRIC_LABEL: Record<EvolutionMetric, string> = {
  revenue: "Faturamento",
  orders: "Pedidos",
  units: "Unidades",
}

export function ProductEvolution() {
  const [data, setData] = useState<MlProductEvolutionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [basis, setBasis] = useState<EvolutionBasis>("paid")
  const [metric, setMetric] = useState<EvolutionMetric>("revenue")
  const [search, setSearch] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/ml/products/evolution", { cache: "no-store" })
      const payload = (await response.json()) as MlProductEvolutionResponse
      if (!response.ok) throw new Error(payload.message || "Não foi possível carregar a evolução.")
      setData(payload)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar a evolução.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <EvolutionLoading />
  if (error || !data) return <EvolutionError message={error ?? "Dados indisponíveis."} onRetry={load} />

  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR")
  const products = normalizedSearch
    ? data.products.filter((product) =>
        `${product.productKey} ${product.title}`.toLocaleLowerCase("pt-BR").includes(normalizedSearch),
      )
    : data.products
  const rows = evolutionRows(products, data.window.months, basis, metric)
  const growing = rows.filter((row) => row.status === "growth" || row.status === "new")
  const falling = rows.filter((row) => row.status === "decline" || row.status === "inactive")
  const stableCount = rows.filter((row) => row.status === "stable").length
  const latestMonth = data.window.months.at(-1)!
  const paidLatest = totalForMonth(data.products, latestMonth, "paid", metric)
  const createdLatest = totalForMonth(data.products, latestMonth, "created", metric)

  return (
    <div className="space-y-6">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-2">
            <div className="flex items-center gap-2">
              <CalendarRange className="size-5 text-primary" />
              <h2 className="text-lg font-semibold tracking-tight">Sete meses fechados</h2>
              <Badge variant="outline" className="font-normal text-muted-foreground">
                Direto do Mercado Livre
              </Badge>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Compare a evolução mensal com uma definição financeira explícita. O mês em andamento não entra nos rankings.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Base da análise</span>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={basis}
                onValueChange={(value) => value && setBasis(value as EvolutionBasis)}
                aria-label="Base da análise"
              >
                <ToggleGroupItem value="paid" aria-label="Vendas pagas">
                  <CircleDollarSign /> Pagas
                </ToggleGroupItem>
                <ToggleGroupItem value="created" aria-label="Pedidos criados">
                  <ShoppingCart /> Criadas
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Métrica</span>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={metric}
                onValueChange={(value) => value && setMetric(value as EvolutionMetric)}
                aria-label="Métrica da análise"
              >
                <ToggleGroupItem value="revenue" aria-label="Faturamento"><CircleDollarSign /></ToggleGroupItem>
                <ToggleGroupItem value="orders" aria-label="Pedidos"><ShoppingCart /></ToggleGroupItem>
                <ToggleGroupItem value="units" aria-label="Unidades"><Boxes /></ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>

        <div className="grid border-t border-border bg-muted/20 sm:grid-cols-[1fr_1fr_1.35fr]">
          <BasisValue
            active={basis === "paid"}
            label="Vendas pagas"
            value={formatMetric(paidLatest, metric)}
            description="paid/confirmed, sem cancelados ou devolvidos"
          />
          <BasisValue
            active={basis === "created"}
            label="Pedidos criados"
            value={formatMetric(createdLatest, metric)}
            description="inclui pedidos cancelados posteriormente"
          />
          <div className="flex items-center gap-3 border-t border-border px-5 py-4 sm:border-l sm:border-t-0">
            <Info className="size-4 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Base ativa: <strong className="text-foreground">{BASIS_LABEL[basis]}</strong>. A diferença de {formatMetric(Math.max(0, createdLatest - paidLatest), metric)} explica o efeito de pedidos não elegíveis em {monthLabel(latestMonth)}.
            </p>
          </div>
        </div>
      </Card>

      {(data.message || data.stale || !data.window.complete) && (
        <Alert className="border-warning/40 bg-warning/10 text-warning-foreground">
          <Clock3 />
          <AlertTitle>{data.stale ? "Sincronização desatualizada" : "Cobertura em processamento"}</AlertTitle>
          <AlertDescription className="text-warning-foreground/80">
            {data.message || "Os últimos dados válidos continuam visíveis enquanto a atualização é concluída."}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar SKU ou produto"
            className="bg-card pl-9"
            aria-label="Buscar SKU ou produto na evolução"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{formatNumero(products.length)} produtos</span>
          <span>{formatNumero(stableCount)} estáveis</span>
          <span>Atualizado {formatLastSync(data.lastSync)}</span>
        </div>
      </div>

      <ProductHeatmap products={products} months={data.window.months} basis={basis} metric={metric} />

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TrendTable kind="growth" rows={growing} months={data.window.months} basis={basis} metric={metric} />
        <TrendTable kind="decline" rows={falling} months={data.window.months} basis={basis} metric={metric} />
      </section>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Visitas vêm do endpoint de audiência por anúncio. A conversão é aproximada porque visitas e pedidos podem seguir janelas de atribuição diferentes.
      </p>
    </div>
  )
}

function BasisValue({
  active,
  label,
  value,
  description,
}: {
  active: boolean
  label: string
  value: string
  description: string
}) {
  return (
    <div className={cn("px-5 py-4 transition-colors sm:border-r sm:border-border", active && "bg-accent/70")}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {active && <Badge className="h-5 px-1.5 text-[10px]">Ativa</Badge>}
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{description}</p>
    </div>
  )
}

function ProductHeatmap({
  products,
  months,
  basis,
  metric,
}: {
  products: MlEvolutionProduct[]
  months: string[]
  basis: EvolutionBasis
  metric: EvolutionMetric
}) {
  const top = useMemo(
    () =>
      [...products]
        .sort(
          (a, b) =>
            b.monthly.reduce((sum, row) => sum + metricValue(row, basis, metric), 0) -
            a.monthly.reduce((sum, row) => sum + metricValue(row, basis, metric), 0),
        )
        .filter((product) => product.monthly.some((row) => metricValue(row, basis, metric) > 0))
        .slice(0, 15),
    [products, basis, metric],
  )
  const maximum = Math.max(
    0,
    ...top.flatMap((product) => product.monthly.map((row) => metricValue(row, basis, metric))),
  )

  return (
    <Card className="gap-4 overflow-hidden py-5">
      <CardHeader className="px-5">
        <CardTitle>Mapa de calor da evolução</CardTitle>
        <CardDescription>
          Top 15 por {METRIC_LABEL[metric].toLocaleLowerCase("pt-BR")} em {BASIS_LABEL[basis].toLocaleLowerCase("pt-BR")}. Passe o cursor ou navegue pelo teclado para ver o valor exato.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {!top.length ? (
          <div className="flex h-52 items-center justify-center px-6 text-sm text-muted-foreground">
            Nenhum produto encontrado para a busca e a métrica selecionadas.
          </div>
        ) : (
          <div className="overflow-x-auto border-y border-border">
            <div className="min-w-[900px]" role="table" aria-label="Evolução mensal dos produtos">
              <div className="grid grid-cols-[minmax(280px,1.6fr)_repeat(7,minmax(78px,0.55fr))] bg-muted/45" role="row">
                <div className="sticky left-0 z-10 bg-muted px-5 py-3 text-xs font-medium text-muted-foreground" role="columnheader">
                  Produto
                </div>
                {months.map((month) => (
                  <div key={month} className="px-2 py-3 text-center text-xs font-medium text-muted-foreground" role="columnheader">
                    {monthLabel(month)}
                  </div>
                ))}
              </div>
              {top.map((product) => (
                <div key={product.productKey} className="grid grid-cols-[minmax(280px,1.6fr)_repeat(7,minmax(78px,0.55fr))] border-t border-border first:border-t-0" role="row">
                  <div className="sticky left-0 z-10 flex min-w-0 items-center gap-3 bg-card px-5 py-2.5" role="rowheader">
                    <span className="w-20 shrink-0 truncate font-mono text-[11px] text-primary">{product.productKey}</span>
                    <span className="truncate text-xs" title={product.title}>{product.title}</span>
                  </div>
                  {months.map((month, index) => {
                    const current = product.monthly.find((row) => row.month === month)
                    const previous = product.monthly.find((row) => row.month === months[index - 1])
                    const value = metricValue(current, basis, metric)
                    const previousValue = metricValue(previous, basis, metric)
                    const delta = previousValue > 0 ? (value - previousValue) / previousValue : null
                    return (
                      <Tooltip key={month}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="m-1.5 min-h-10 rounded-md px-2 text-center text-[11px] font-medium tabular-nums text-foreground shadow-xs outline-none transition-[filter,box-shadow] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring"
                            style={{
                              backgroundColor: heatColor(value, maximum),
                              color: heatTextColor(value, maximum),
                            } as CSSProperties}
                            aria-label={`${product.title}, ${monthLabel(month)}: ${formatMetric(value, metric)}`}
                          >
                            {value > 0 ? compactMetric(value, metric) : "—"}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent sideOffset={6} className="max-w-64 space-y-1 bg-foreground px-3 py-2 text-background">
                          <p className="font-medium">{product.title}</p>
                          <p>{monthLabel(month)} · {formatMetric(value, metric)}</p>
                          <p className="text-background/70">
                            {index === 0 ? "Primeiro mês da janela" : delta === null ? "Sem base no mês anterior" : `${delta >= 0 ? "+" : ""}${formatPercent(delta)} vs. mês anterior`}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 px-5 pt-4 text-[11px] text-muted-foreground">
          <span>Zero</span>
          {[0, 0.1, 0.3, 0.55, 0.8, 1].map((value) => (
            <span key={value} className="size-3.5 rounded-sm" style={{ backgroundColor: heatColor(value, 1) }} />
          ))}
          <span>Maior</span>
        </div>
      </CardContent>
    </Card>
  )
}

function TrendTable({
  kind,
  rows,
  months,
  basis,
  metric,
}: {
  kind: "growth" | "decline"
  rows: EvolutionRow[]
  months: string[]
  basis: EvolutionBasis
  metric: EvolutionMetric
}) {
  const previousMonth = months.at(-2)!
  const currentMonth = months.at(-1)!
  const columns = useMemo<ColumnDef<EvolutionRow, unknown>[]>(
    () => [
      {
        accessorKey: "productKey",
        header: "SKU",
        meta: { filtro: "none" },
        cell: ({ row }) => <span className="font-mono text-[11px] text-primary">{row.original.productKey}</span>,
      },
      {
        accessorKey: "title",
        header: "Produto",
        meta: { filtro: "none" },
        cell: ({ row }) => (
          <div className="min-w-48 max-w-64">
            <span className="block truncate text-xs font-medium" title={row.original.title}>{row.original.title}</span>
            <TrendBadge status={row.original.status} />
          </div>
        ),
      },
      {
        accessorKey: "previous",
        header: monthLabel(previousMonth),
        meta: { filtro: "none", alinhar: "right" },
        cell: ({ row }) => <span className="tabular-nums">{compactMetric(row.original.previous, metric)}</span>,
      },
      {
        accessorKey: "current",
        header: monthLabel(currentMonth),
        meta: { filtro: "none", alinhar: "right" },
        cell: ({ row }) => <span className="font-medium tabular-nums">{compactMetric(row.original.current, metric)}</span>,
      },
      {
        accessorKey: "percentChange",
        header: "Variação",
        meta: { filtro: "none", alinhar: "right" },
        cell: ({ row }) => <TrendPercent row={row.original} />,
      },
      {
        accessorKey: "absoluteChange",
        header: "Impacto",
        meta: { filtro: "none", alinhar: "right" },
        cell: ({ row }) => (
          <span className={cn("font-medium tabular-nums", row.original.absoluteChange >= 0 ? "text-success" : "text-destructive")}>
            {row.original.absoluteChange > 0 ? "+" : ""}{formatMetric(row.original.absoluteChange, metric)}
          </span>
        ),
      },
      {
        id: "revenue7m",
        accessorFn: (row) => sumMetric(row, basis, "revenue"),
        header: "Receita 7m",
        meta: { filtro: "none", alinhar: "right" },
        cell: ({ row }) => <span className="tabular-nums">{formatBRLCompacto(sumMetric(row.original, basis, "revenue"))}</span>,
      },
      {
        id: "orders7m",
        accessorFn: (row) => sumMetric(row, basis, "orders"),
        header: "Pedidos 7m",
        meta: { filtro: "none", alinhar: "right" },
        cell: ({ row }) => <span className="tabular-nums">{formatNumero(sumMetric(row.original, basis, "orders"))}</span>,
      },
      {
        accessorKey: "visits",
        header: "Visitas",
        meta: { filtro: "none", alinhar: "right" },
        cell: ({ row }) => <span className="tabular-nums">{row.original.visits === null ? "—" : formatNumero(row.original.visits)}</span>,
      },
      {
        accessorKey: "conversion",
        header: "Conversão aprox.",
        meta: { filtro: "none", alinhar: "right" },
        cell: ({ row }) => <span className="tabular-nums">{row.original.conversion === null ? "—" : formatPercent(row.original.conversion, 2)}</span>,
      },
    ],
    [basis, currentMonth, metric, previousMonth],
  )
  const isGrowth = kind === "growth"

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            {isGrowth ? <TrendingUp className="size-4 text-success" /> : <TrendingDown className="size-4 text-destructive" />}
            <h3 className="font-semibold">{isGrowth ? "Produtos em subida" : "Produtos em queda"}</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isGrowth ? "Crescimento acima de 15% e produtos novos." : "Variação inferior a -15% e produtos inativos."}
          </p>
        </div>
        <Badge variant="secondary">{formatNumero(rows.length)}</Badge>
      </div>
      <DataTable
        tableId={`ml-evolution-${kind}`}
        columns={columns}
        data={rows}
        mostrarBusca={false}
        vazio={isGrowth ? "Nenhum produto em crescimento para esta seleção." : "Nenhum produto em queda para esta seleção."}
        csv={{
          nome: `mercado-livre-produtos-${kind}`,
          linhas: (currentRows) =>
            currentRows.map((row) => ({
              SKU: row.productKey,
              Produto: row.title,
              Base: BASIS_LABEL[basis],
              Métrica: METRIC_LABEL[metric],
              [previousMonth]: row.previous,
              [currentMonth]: row.current,
              "Variação %": row.percentChange ?? "",
              Impacto: row.absoluteChange,
              "Receita 7m": sumMetric(row, basis, "revenue"),
              "Pedidos 7m": sumMetric(row, basis, "orders"),
              Visitas: row.visits ?? "",
              "Conversão aproximada": row.conversion ?? "",
              Situação: row.status,
            })),
        }}
      />
    </Card>
  )
}

function TrendBadge({ status }: { status: EvolutionRow["status"] }) {
  const labels: Partial<Record<EvolutionRow["status"], string>> = {
    growth: "Em crescimento",
    decline: "Em queda",
    new: "Novo",
    inactive: "Inativo",
  }
  return (
    <span className={cn("mt-1 inline-block text-[10px] font-medium", status === "growth" || status === "new" ? "text-success" : "text-destructive")}>
      {labels[status]}
    </span>
  )
}

function TrendPercent({ row }: { row: EvolutionRow }) {
  if (row.status === "new") return <span className="font-medium text-success">Novo</span>
  const value = row.percentChange ?? (row.status === "inactive" ? -1 : null)
  if (value === null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn("font-medium tabular-nums", value >= 0 ? "text-success" : "text-destructive")}>
      {value > 0 ? "+" : ""}{formatPercent(value)}
    </span>
  )
}

function EvolutionLoading() {
  return (
    <div className="space-y-6" aria-label="Carregando evolução de produtos">
      <Card className="gap-4 p-5">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-20 w-full" />
      </Card>
      <Card className="gap-3 p-5">
        <Skeleton className="h-5 w-64" />
        {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}
      </Card>
    </div>
  )
}

function EvolutionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive" className="py-4">
      <AlertCircle />
      <AlertTitle>Não foi possível carregar a evolução</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> Tentar novamente
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function sumMetric(row: EvolutionRow, basis: EvolutionBasis, metric: EvolutionMetric): number {
  return row.totals[basis][metric]
}

function totalForMonth(
  products: MlEvolutionProduct[],
  month: string,
  basis: EvolutionBasis,
  metric: EvolutionMetric,
): number {
  return products.reduce(
    (sum, product) => sum + metricValue(product.monthly.find((row) => row.month === month), basis, metric),
    0,
  )
}

function monthLabel(month: string): string {
  const date = new Date(`${month}-01T12:00:00.000Z`)
  const value = new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "")
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatLastSync(lastSync: string | null): string {
  if (!lastSync) return "ainda não disponível"
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Fortaleza",
  }).format(new Date(lastSync))
}

function formatMetric(value: number, metric: EvolutionMetric): string {
  if (metric === "revenue") return formatBRL(value)
  return formatNumero(value)
}

function compactMetric(value: number, metric: EvolutionMetric): string {
  if (metric === "revenue") return formatBRLCompacto(value)
  return value.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 })
}

function heatColor(value: number, maximum: number): string {
  if (value <= 0 || maximum <= 0) return "var(--muted)"
  const intensity = Math.log1p(value) / Math.log1p(maximum)
  const percentage = Math.round(14 + intensity * 78)
  return `color-mix(in oklab, var(--primary) ${percentage}%, var(--muted))`
}

function heatTextColor(value: number, maximum: number): string {
  if (value <= 0 || maximum <= 0) return "var(--muted-foreground)"
  const intensity = Math.log1p(value) / Math.log1p(maximum)
  return intensity > 0.72 ? "var(--primary-foreground)" : "var(--foreground)"
}
