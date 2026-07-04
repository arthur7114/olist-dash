"use client"

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis, BarChart } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { formatBRLCompacto, formatPercent } from "@/lib/data"
import type { DevolucaoCanal, DevolucaoMensal } from "@/lib/devolucao-analytics"

const mensalConfig = {
  valorDevolvido: { label: "Valor devolvido", color: "var(--chart-3)" },
  taxa: { label: "Taxa de devolução", color: "var(--chart-5)" },
} satisfies ChartConfig

export function DevolucaoMensalChart({ meses }: { meses: DevolucaoMensal[] }) {
  const dados = meses.map((m) => ({ ...m, label: `${m.mes.slice(5)}/${m.mes.slice(2, 4)}` }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Devoluções por mês</CardTitle>
        <CardDescription>Valor devolvido (barras) e taxa sobre o faturamento (linha)</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={mensalConfig} className="aspect-auto h-[280px] w-full">
          <ComposedChart data={dados} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis yAxisId="valor" tickLine={false} axisLine={false} width={68} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
            <YAxis yAxisId="taxa" orientation="right" tickLine={false} axisLine={false} width={52} tickFormatter={(v) => formatPercent(Number(v), 0)} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) =>
                    name === "taxa" ? formatPercent(Number(value)) : formatBRLCompacto(Number(value))
                  }
                />
              }
            />
            <Bar yAxisId="valor" dataKey="valorDevolvido" fill="var(--color-valorDevolvido)" radius={[4, 4, 0, 0]} />
            <Line yAxisId="taxa" dataKey="taxa" stroke="var(--color-taxa)" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

const canalConfig = {
  valorDevolvido: { label: "Valor devolvido", color: "var(--chart-3)" },
} satisfies ChartConfig

export function DevolucaoPorCanalChart({ canais }: { canais: DevolucaoCanal[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Devoluções por canal</CardTitle>
        <CardDescription>Valor devolvido no período por canal de venda</CardDescription>
      </CardHeader>
      <CardContent>
        {canais.length === 0 ? (
          <p className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            Nenhuma devolução no período — bom sinal 👍
          </p>
        ) : (
          <ChartContainer config={canalConfig} className="aspect-auto h-[280px] w-full">
            <BarChart data={canais} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="canal" tickLine={false} axisLine={false} fontSize={11} interval={0} />
              <YAxis tickLine={false} axisLine={false} width={68} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
              <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatBRLCompacto(Number(v))} />} />
              <Bar dataKey="valorDevolvido" fill="var(--color-valorDevolvido)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
