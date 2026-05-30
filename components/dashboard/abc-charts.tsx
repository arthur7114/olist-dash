"use client"

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { formatBRLCompacto, formatNumero, type LinhaABC } from "@/lib/data"

const topConfig = {
  valorVendido: { label: "Valor vendido", color: "var(--chart-1)" },
} satisfies ChartConfig

const classeCor: Record<string, string> = {
  A: "var(--chart-1)",
  B: "var(--chart-3)",
  C: "var(--chart-2)",
}

export function TopProdutosChart({ linhas }: { linhas: LinhaABC[] }) {
  const dados = [...linhas]
    .sort((a, b) => b.valorVendido - a.valorVendido)
    .slice(0, 8)
    .map((l) => ({ produto: l.produto.length > 18 ? l.produto.slice(0, 17) + "…" : l.produto, valorVendido: Math.round(l.valorVendido), classe: l.classe }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top produtos por valor vendido</CardTitle>
        <CardDescription>8 maiores SKUs em faturamento</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={topConfig} className="aspect-auto h-[300px] w-full">
          <BarChart data={dados} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
            <YAxis type="category" dataKey="produto" tickLine={false} axisLine={false} width={120} fontSize={11} />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(v) => <span className="font-medium">{formatBRLCompacto(Number(v))}</span>} />}
            />
            <Bar dataKey="valorVendido" radius={[0, 4, 4, 0]}>
              {dados.map((d, i) => (
                <Cell key={i} fill={classeCor[d.classe]} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

const distConfig = {
  A: { label: "Classe A", color: "var(--chart-1)" },
  B: { label: "Classe B", color: "var(--chart-3)" },
  C: { label: "Classe C", color: "var(--chart-2)" },
} satisfies ChartConfig

export function DistribuicaoClassesChart({ linhas }: { linhas: LinhaABC[] }) {
  const agrupado = (["A", "B", "C"] as const).map((classe) => {
    const itens = linhas.filter((l) => l.classe === classe)
    return {
      classe,
      qtd: itens.length,
      faturamento: itens.reduce((s, l) => s + l.valorVendido, 0),
      fill: classeCor[classe],
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Distribuição entre classes</CardTitle>
        <CardDescription>Participação de cada classe no faturamento</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <ChartContainer config={distConfig} className="aspect-square h-[220px]">
          <PieChart>
            <ChartTooltip
              content={<ChartTooltipContent nameKey="classe" formatter={(v) => <span className="font-medium">{formatBRLCompacto(Number(v))}</span>} />}
            />
            <Pie data={agrupado} dataKey="faturamento" nameKey="classe" innerRadius={55} strokeWidth={3}>
              {agrupado.map((d) => (
                <Cell key={d.classe} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <div className="space-y-2">
          {agrupado.map((d) => (
            <div key={d.classe} className="flex items-center gap-2 text-sm">
              <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: d.fill }} />
              <span className="font-medium text-foreground">Classe {d.classe}</span>
              <span className="text-muted-foreground">
                {formatNumero(d.qtd)} SKUs · {formatBRLCompacto(d.faturamento)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
