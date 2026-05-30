import { cn } from "@/lib/utils"
import type { ClasseABC, StatusPagamento } from "@/lib/data"

const statusEstilo: Record<StatusPagamento, string> = {
  Pago: "bg-success/12 text-success border-success/20",
  Pendente: "bg-warning/15 text-warning-foreground border-warning/30",
  Estornado: "bg-destructive/12 text-destructive border-destructive/20",
  Cancelado: "bg-muted text-muted-foreground border-border",
}

export function StatusPagamentoBadge({ status }: { status: StatusPagamento }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        statusEstilo[status],
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "Pago" && "bg-success",
          status === "Pendente" && "bg-warning",
          status === "Estornado" && "bg-destructive",
          status === "Cancelado" && "bg-muted-foreground",
        )}
      />
      {status}
    </span>
  )
}

const classeEstilo: Record<ClasseABC, string> = {
  A: "bg-success/12 text-success border-success/20",
  B: "bg-warning/15 text-warning-foreground border-warning/30",
  C: "bg-muted text-muted-foreground border-border",
}

export function ClasseABCBadge({ classe }: { classe: ClasseABC }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-md border text-xs font-semibold",
        classeEstilo[classe],
      )}
    >
      {classe}
    </span>
  )
}
