"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"
import { TableHead } from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type Direcao = "asc" | "desc"

export type EstadoOrdenacao<K extends string> = {
  campo: K
  direcao: Direcao
  alternar: (campo: K) => void
}

/**
 * Hook genérico de ordenação para tabelas.
 * Retorna as linhas ordenadas e o estado para o cabeçalho clicável.
 */
export function useOrdenacao<T, K extends string>(
  linhas: T[],
  valor: (linha: T, campo: K) => string | number,
  inicial: K,
  direcaoInicial: Direcao = "desc",
): { ordenadas: T[]; ordenacao: EstadoOrdenacao<K> } {
  const [campo, setCampo] = useState<K>(inicial)
  const [direcao, setDirecao] = useState<Direcao>(direcaoInicial)

  const alternar = (novoCampo: K) => {
    if (novoCampo === campo) {
      setDirecao((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setCampo(novoCampo)
      setDirecao("desc")
    }
  }

  const ordenadas = useMemo(() => {
    const copia = [...linhas]
    copia.sort((a, b) => {
      const va = valor(a, campo)
      const vb = valor(b, campo)
      if (typeof va === "number" && typeof vb === "number") {
        return direcao === "asc" ? va - vb : vb - va
      }
      const sa = String(va)
      const sb = String(vb)
      return direcao === "asc"
        ? sa.localeCompare(sb, "pt-BR")
        : sb.localeCompare(sa, "pt-BR")
    })
    return copia
  }, [linhas, campo, direcao, valor])

  return { ordenadas, ordenacao: { campo, direcao, alternar } }
}

export function SortableHead<K extends string>({
  campo,
  ordenacao,
  children,
  alinhar = "left",
  className,
}: {
  campo: K
  ordenacao: EstadoOrdenacao<K>
  children: React.ReactNode
  alinhar?: "left" | "right"
  className?: string
}) {
  const ativo = ordenacao.campo === campo
  return (
    <TableHead className={cn(alinhar === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => ordenacao.alternar(campo)}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium transition-colors hover:text-foreground",
          alinhar === "right" && "flex-row-reverse",
          ativo ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {children}
        {ativo ? (
          ordenacao.direcao === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        )}
      </button>
    </TableHead>
  )
}
