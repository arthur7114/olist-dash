"use client"

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  CANAIS,
  FORMAS_PAGAMENTO,
  PEDIDOS,
  PRODUTOS,
  VENDEDORES_POR_CANAL,
  type Canal,
  type FormaPagamento,
  type Pedido,
  type Produto,
} from "@/lib/data"

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
  carregando: boolean
  fonteDados: "mock" | "real"
  autenticado: boolean
  mensagemDados?: string
  opcoes: {
    canais: Canal[]
    vendedores: string[]
    produtos: Produto[]
    formasPagamento: FormaPagamento[]
  }
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
  const [pedidos, setPedidos] = useState<Pedido[]>(PEDIDOS)
  const [carregando, setCarregando] = useState(true)
  const [fonteDados, setFonteDados] = useState<"mock" | "real">("mock")
  const [autenticado, setAutenticado] = useState(false)
  const [mensagemDados, setMensagemDados] = useState<string>()

  useEffect(() => {
    let ativo = true

    async function carregarPedidos() {
      setCarregando(true)
      try {
        const response = await fetch("/api/olist/orders", { cache: "no-store" })
        const data = (await response.json()) as {
          source?: "mock" | "real"
          authenticated?: boolean
          pedidos?: Pedido[]
          message?: string
        }

        if (!ativo) return
        setPedidos(data.pedidos?.length ? data.pedidos : PEDIDOS)
        setFonteDados(data.source ?? "mock")
        setAutenticado(Boolean(data.authenticated))
        setMensagemDados(data.message)
      } catch {
        if (!ativo) return
        setPedidos(PEDIDOS)
        setFonteDados("mock")
        setAutenticado(false)
        setMensagemDados("Não foi possível consultar a Olist ERP API v3. Usando dados mockados.")
      } finally {
        if (ativo) setCarregando(false)
      }
    }

    carregarPedidos()

    return () => {
      ativo = false
    }
  }, [])

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

    return pedidos.filter((p) => {
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
  }, [filtros, pedidos])

  const opcoes = useMemo(() => {
    const canais = uniqueSorted([...CANAIS, ...pedidos.map((p) => p.canal)])
    const vendedores = uniqueSorted([
      ...Object.values(VENDEDORES_POR_CANAL).flat(),
      ...pedidos.map((p) => p.vendedor),
    ])
    const formasPagamento = uniqueSorted([
      ...FORMAS_PAGAMENTO,
      ...pedidos.map((p) => p.formaPagamento),
    ])
    const produtos = [
      ...PRODUTOS,
      ...pedidos.map((p) => ({
        sku: p.sku,
        nome: p.produto,
        custoMedio: p.custoTotal,
      })),
    ]
    const produtosUnicos = Array.from(new Map(produtos.map((p) => [p.sku, p])).values()).sort((a, b) =>
      a.sku.localeCompare(b.sku, "pt-BR"),
    )

    return { canais, vendedores, formasPagamento, produtos: produtosUnicos }
  }, [pedidos])

  const value: FiltrosContextValue = {
    filtros,
    setFiltro,
    limpar,
    pedidosFiltrados,
    totalSemFiltro: pedidos.length,
    carregando,
    fonteDados,
    autenticado,
    mensagemDados,
    opcoes,
  }

  return <FiltrosContext.Provider value={value}>{children}</FiltrosContext.Provider>
}

function uniqueSorted<T extends string>(items: T[]) {
  return Array.from(new Set(items.filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR"))
}

export function useFiltros() {
  const ctx = useContext(FiltrosContext)
  if (!ctx) throw new Error("useFiltros precisa estar dentro de FiltrosProvider")
  return ctx
}
