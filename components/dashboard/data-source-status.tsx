"use client"

import Link from "next/link"
import { Database, Loader2, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFiltros } from "@/lib/filters"
import { cn } from "@/lib/utils"

export function DataSourceStatus() {
  const { carregando, fonteDados, autenticado, mensagemDados } = useFiltros()
  const usandoReal = fonteDados === "real"

  return (
    <div className="flex items-center gap-2">
      <span
        title={mensagemDados}
        className={cn(
          "hidden items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium sm:inline-flex",
          usandoReal
            ? "border-success/20 bg-success/10 text-success"
            : "border-warning/30 bg-warning/15 text-warning-foreground",
        )}
      >
        {carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
        {carregando ? "Carregando" : usandoReal ? "Dados reais" : "Mock"}
      </span>

      {autenticado ? (
        <Button asChild variant="outline" size="sm" className="hidden bg-background sm:inline-flex">
          <Link href="/api/olist/auth/logout">
            <LogOut className="h-4 w-4" />
            Sair
          </Link>
        </Button>
      ) : (
        <Button asChild size="sm" className="hidden sm:inline-flex">
          <Link href="/api/olist/auth/start">Conectar Olist</Link>
        </Button>
      )}
    </div>
  )
}
