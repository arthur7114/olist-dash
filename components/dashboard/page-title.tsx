import type { ReactNode } from "react"

interface PageTitleProps {
  titulo: string
  descricao: string
  acao?: ReactNode
}

export function PageTitle({ titulo, descricao, acao }: PageTitleProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-foreground">{titulo}</h1>
        <p className="text-sm text-muted-foreground text-pretty">{descricao}</p>
      </div>
      {acao}
    </div>
  )
}
