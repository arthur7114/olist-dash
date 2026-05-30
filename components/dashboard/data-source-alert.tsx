"use client"

import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFiltros } from "@/lib/filters"

export function DataSourceAlert() {
  const { fonteDados, autenticado, mensagemDados } = useFiltros()

  if (fonteDados === "real" || !mensagemDados) return null

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">
            {autenticado ? "Falha ao carregar dados reais da Olist." : "Dados mockados em uso."}
          </p>
          <p className="mt-1 text-xs opacity-90">{mensagemDados}</p>
        </div>
      </div>
      {!autenticado && (
        <Button asChild size="sm" variant="outline" className="bg-background">
          <Link href="/api/olist/auth/start">Conectar Olist</Link>
        </Button>
      )}
    </div>
  )
}
