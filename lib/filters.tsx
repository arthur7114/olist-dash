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

export type PeriodoOpcao = "7d" | "15d" | "30d" | "tudo" | "custom"

// datas em ISO (YYYY-MM-DD), mesmo formato usado pela API e pelo banco
export interface IntervaloCustom {
  inicio: string
  fim: string
}

export interface FiltrosState {
  periodo: PeriodoOpcao
  intervalo: IntervaloCustom | null
  canal: Canal | "todos"
  vendedor: string | "todos"
  sku: string | "todos"
  formaPagamento: FormaPagamento | "todos"
}

interface FiltrosContextValue {
  filtros: FiltrosState
  setFiltro: <K extends keyof FiltrosState>(chave: K, valor: FiltrosState[K]) => void
  definirIntervalo: (inicio: Date, fim: Date) => void
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
  intervalo: null,
  canal: "todos",
  vendedor: "todos",
  sku: "todos",
  formaPagamento: "todos",
}

const FiltrosContext = createContext<FiltrosContextValue | null>(null)

function paraIso(data: Date): string {
  return data.toISOString().slice(0, 10)
}

export function FiltrosProvider({ children }: { children: ReactNode }) {
  const [filtros, setFiltros] = useState<FiltrosState>(padrao)
  const [pedidos, setPedidos] = useState<Pedido[]>(PEDIDOS)
  const [carregando, setCarregando] = useState(true)
  const [fonteDados, setFonteDados] = useState<"mock" | "real">("mock")
  const [autenticado, setAutenticado] = useState(false)
  const [mensagemDados, setMensagemDados] = useState<string>()

  useEffect(() => {
    // período "custom" selecionado mas sem intervalo definido ainda (usuário está escolhendo as datas)
    if (filtros.periodo === "custom" && !filtros.intervalo) return

    let ativo = true

    async function carregarPedidos() {
      setCarregando(true)
      try {
        const params = new URLSearchParams()
        if (filtros.periodo === "custom" && filtros.intervalo) {
          params.set("inicio", filtros.intervalo.inicio)
          params.set("fim", filtros.intervalo.fim)
        } else {
          params.set("periodo", filtros.periodo)
        }
        const response = await fetch(`/api/olist/orders?${params.toString()}`, { cache: "no-store" })
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
  }, [filtros.periodo, filtros.intervalo])

  const setFiltro = <K extends keyof FiltrosState>(chave: K, valor: FiltrosState[K]) => {
    setFiltros((prev) => {
      const next = { ...prev, [chave]: valor }
      // ao trocar de canal, reseta vendedor
      if (chave === "canal") next.vendedor = "todos"
      return next
    })
  }

  // usado pelo date range picker: define o intervalo e já muda o período para "custom" numa só atualização
  const definirIntervalo = (inicio: Date, fim: Date) => {
    setFiltros((prev) => ({ ...prev, periodo: "custom", intervalo: { inicio: paraIso(inicio), fim: paraIso(fim) } }))
  }

  const limpar = () => setFiltros(padrao)

  // a janela de datas já vem filtrada do servidor (inclusive para o intervalo personalizado);
  // aqui só sobram os filtros complementares (canal, vendedor, SKU, forma de pagamento)
  const pedidosFiltrados = useMemo(() => {
    return pedidos.filter((p) => {
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
    definirIntervalo,
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
