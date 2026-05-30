"use client"

import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import { PEDIDOS, type Canal, type FormaPagamento, type Pedido } from "@/lib/data"

export type PeriodoOpcao = "7d" | "15d" | "30d" | "tudo"

export interface FiltrosState {
  periodo: PeriodoOpcao
  canal: Canal | "todos"
  vendedor: string | "todos"
  sku: string | "todos"
  formaPagamento: FormaPagamento | "todos"
}

interface FiltrosContextValue {
  filtros: FiltrosState
  setFiltro: <K extends keyof FiltrosState>(chave: K, valor: FiltrosState[K]) => void
  limpar: () => void
  pedidosFiltrados: Pedido[]
  totalSemFiltro: number
}

const padrao: FiltrosState = {
  periodo: "30d",
  canal: "todos",
  vendedor: "todos",
  sku: "todos",
  formaPagamento: "todos",
}

const FiltrosContext = createContext<FiltrosContextValue | null>(null)

const DIAS_PERIODO: Record<PeriodoOpcao, number | null> = {
  "7d": 7,
  "15d": 15,
  "30d": 30,
  tudo: null,
}

// data de referência fixa do mock
const HOJE = new Date("2026-05-30")

export function FiltrosProvider({ children }: { children: ReactNode }) {
  const [filtros, setFiltros] = useState<FiltrosState>(padrao)

  const setFiltro = <K extends keyof FiltrosState>(chave: K, valor: FiltrosState[K]) => {
    setFiltros((prev) => {
      const next = { ...prev, [chave]: valor }
      // ao trocar de canal, reseta vendedor
      if (chave === "canal") next.vendedor = "todos"
      return next
    })
  }

  const limpar = () => setFiltros(padrao)

  const pedidosFiltrados = useMemo(() => {
    const dias = DIAS_PERIODO[filtros.periodo]
    const limite = dias !== null ? new Date(HOJE.getTime() - dias * 86400000) : null

    return PEDIDOS.filter((p) => {
      if (limite) {
        const d = new Date(p.data)
        if (d < limite) return false
      }
      if (filtros.canal !== "todos" && p.canal !== filtros.canal) return false
      if (filtros.vendedor !== "todos" && p.vendedor !== filtros.vendedor) return false
      if (filtros.sku !== "todos" && p.sku !== filtros.sku) return false
      if (filtros.formaPagamento !== "todos" && p.formaPagamento !== filtros.formaPagamento) return false
      return true
    })
  }, [filtros])

  const value: FiltrosContextValue = {
    filtros,
    setFiltro,
    limpar,
    pedidosFiltrados,
    totalSemFiltro: PEDIDOS.length,
  }

  return <FiltrosContext.Provider value={value}>{children}</FiltrosContext.Provider>
}

export function useFiltros() {
  const ctx = useContext(FiltrosContext)
  if (!ctx) throw new Error("useFiltros precisa estar dentro de FiltrosProvider")
  return ctx
}
