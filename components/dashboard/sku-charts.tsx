"use client"

import { Bar, BarChart, CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { formatBRLCompacto, formatPercent } from "@/lib/data"
import { prepararMatrizMargem, type LinhaSku } from "@/lib/sku-analytics"

const topConfig = {
  valor: { label: "Valor", color: "var(--chart-1)" },
} satisfies ChartConfig

export function TopSkusChart({
  linhas,
  titulo,
  descricao,
  metrica,
}: {
  linhas: LinhaSku[]
  titulo: string
  descricao: string
  metrica: "faturamento" | "devolucaoValor"
}) {
  const dados = [...linhas]
    .sort((a, b) => b[metrica] - a[metrica])
    .slice(0, 10)
    .filter((l) => l[metrica] > 0)
    .map((l) => ({ sku: l.sku, valor: Math.round(l[metrica]), produto: l.produto }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardContent>
        {dados.length === 0 ? (
          <p className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            Sem dados no período selecionado.
          </p>
        ) : (
          <ChartContainer config={topConfig} className="aspect-auto h-[280px] w-full">
            <BarChart data={dados} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
              <YAxis type="category" dataKey="sku" tickLine={false} axisLine={false} width={90} fontSize={11} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.produto ?? ""}
                    formatter={(value) => formatBRLCompacto(Number(value))}
                  />
                }
              />
              <Bar dataKey="valor" fill="var(--color-valor)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

const matrizConfig = {
  ok: { label: "Saudável", color: "var(--chart-1)" },
  alerta: { label: "Com alerta", color: "var(--chart-3)" },
} satisfies ChartConfig

// Matriz faturamento × margem %: canto inferior direito = vende muito com margem
// ruim (prioridade de correção de preço/custo).
export function MatrizFaturamentoMargemChart({ linhas }: { linhas: LinhaSku[] }) {
  const { pontos, dominioY } = prepararMatrizMargem(linhas)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Matriz faturamento × margem</CardTitle>
        <CardDescription>Cada ponto é um SKU — pontos âmbar têm alerta (sem custo, margem baixa ou alta devolução)</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={matrizConfig} className="aspect-auto h-[300px] w-full">
          <ScatterChart margin={{ left: 8, right: 16, top: 8 }}>
            <CartesianGrid />
            <XAxis type="number" dataKey="x" name="Faturamento" tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
            <YAxis type="number" dataKey="y" name="Margem %" domain={dominioY} allowDataOverflow tickLine={false} axisLine={false} width={68} tickFormatter={(v) => formatPercent(Number(v), 0)} />
            <ZAxis range={[50, 51]} />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.sku ?? ""}
                  formatter={(value, name, item) =>
                    name === "Margem %"
                      ? formatPercent(Number(item?.payload?.yReal ?? value)) + (item?.payload?.foraDaEscala ? " · fora da escala" : "")
                      : formatBRLCompacto(Number(value))
                  }
                />
              }
            />
            <Scatter data={pontos.filter((p) => !p.alerta)} fill="var(--color-ok)" />
            <Scatter data={pontos.filter((p) => p.alerta)} fill="var(--color-alerta)" />
          </ScatterChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
