import type { LucideIcon } from "lucide-react"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"

interface KpiCardProps {
  titulo: string
  valor: string
  icone: LucideIcon
  variacao?: number // ex: 0.082 = +8,2%
  destaque?: "default" | "positivo" | "alerta"
  legenda?: string
}

export function KpiCard({ titulo, valor, icone: Icone, variacao, destaque = "default", legenda }: KpiCardProps) {
  const positiva = (variacao ?? 0) >= 0

  return (
    <Card className="gap-0 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{titulo}</span>
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            destaque === "positivo" && "bg-success/10 text-success",
            destaque === "alerta" && "bg-destructive/10 text-destructive",
            destaque === "default" && "bg-accent text-accent-foreground",
          )}
        >
          <Icone className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{valor}</div>
      <div className="mt-1 flex items-center gap-1.5">
        {variacao !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              positiva ? "text-success" : "text-destructive",
            )}
          >
            {positiva ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {Math.abs(variacao).toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          </span>
        )}
        {legenda && <span className="text-xs text-muted-foreground">{legenda}</span>}
      </div>
    </Card>
  )
}
