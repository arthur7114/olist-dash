"use client"

import { Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// Tooltip didático padrão: ícone discreto ao lado de títulos de KPI/coluna.
export function InfoTooltip({ texto }: { texto: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="O que é isto?"
            className="inline-flex cursor-help text-muted-foreground/70 hover:text-muted-foreground"
          >
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72 text-pretty leading-relaxed">
          {texto}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
