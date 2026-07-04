"use client"

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  agregarPorCanal,
  formatBRLCompacto,
  formatData,
  serieDiaria,
  type Pedido,
} from "@/lib/data"

const serieConfig = {
  faturamento: { label: "Faturamento", color: "var(--chart-1)" },
  lucro: { label: "Margem contrib.", color: "var(--chart-3)" },
} satisfies ChartConfig

const canalConfig = {
  faturamento: { label: "Faturamento", color: "var(--chart-1)" },
  lucroBruto: { label: "Margem contrib.", color: "var(--chart-2)" },
} satisfies ChartConfig

export function FaturamentoLucroChart({ pedidos }: { pedidos: Pedido[] }) {
  const dados = serieDiaria(pedidos).map((d) => ({ ...d, label: formatData(d.data).slice(0, 5) }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Faturamento e M.C. por dia</CardTitle>
        <CardDescription>Evolução diária no período selecionado</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={serieConfig} className="aspect-auto h-[280px] w-full">
          <AreaChart data={dados} margin={{ left: 8, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="fillFat" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-faturamento)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-faturamento)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="fillLucro" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-lucro)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-lucro)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={68}
              tickFormatter={(v) => formatBRLCompacto(Number(v))}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        {name === "faturamento" ? "Faturamento" : "Margem contrib."}
                      </span>
                      <span className="font-medium tabular-nums">{formatBRLCompacto(Number(value))}</span>
                    </div>
                  )}
                />
              }
            />
            <Area
              dataKey="faturamento"
              type="monotone"
              stroke="var(--color-faturamento)"
              fill="url(#fillFat)"
              strokeWidth={2}
            />
            <Area
              dataKey="lucro"
              type="monotone"
              stroke="var(--color-lucro)"
              fill="url(#fillLucro)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

export function CanalBarChart({ pedidos }: { pedidos: Pedido[] }) {
  const dados = agregarPorCanal(pedidos).map((c) => ({
    canal: c.canal.replace("Vendedor ", "Vend. "),
    faturamento: Math.round(c.faturamento),
    lucroBruto: Math.round(c.lucroBruto),
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparativo por canal</CardTitle>
        <CardDescription>Faturamento e margem de contribuição por canal de venda</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={canalConfig} className="aspect-auto h-[280px] w-full">
          <BarChart data={dados} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="canal" tickLine={false} axisLine={false} tickMargin={8} interval={0} fontSize={11} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={68}
              tickFormatter={(v) => formatBRLCompacto(Number(v))}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        {name === "faturamento" ? "Faturamento" : "Margem contrib."}
                      </span>
                      <span className="font-medium tabular-nums">{formatBRLCompacto(Number(value))}</span>
                    </div>
                  )}
                />
              }
            />
            <Bar dataKey="faturamento" fill="var(--color-faturamento)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="lucroBruto" fill="var(--color-lucroBruto)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
