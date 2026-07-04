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
import { rangePeriodo, rangePersonalizado, type PeriodoOpcao } from "@/lib/periodo"

export type { PeriodoOpcao } // re-export para os componentes existentes

export interface FiltrosState {
  periodo: PeriodoOpcao
  customInicio: string | null
  customFim: string | null
  canal: Canal | "todos"
  vendedor: string | "todos"
  sku: string | "todos"
  formaPagamento: FormaPagamento | "todos"
}

interface FiltrosContextValue {
  filtros: FiltrosState
  setFiltro: <K extends keyof FiltrosState>(chave: K, valor: FiltrosState[K]) => void
  setPeriodoPersonalizado: (inicio: string, fim: string) => void
  limpar: () => void
  pedidosFiltrados: Pedido[]
  pedidosPeriodoAnterior: Pedido[]
  totalSemFiltro: number
  carregando: boolean
  fonteDados: "mock" | "real"
  autenticado: boolean
  mensagemDados?: string
  lastSync: string | null
  opcoes: {
    canais: Canal[]
    vendedores: string[]
    produtos: Produto[]
    formasPagamento: FormaPagamento[]
  }
}

const padrao: FiltrosState = {
  periodo: "30d",
  customInicio: null,
  customFim: null,
  canal: "todos",
  vendedor: "todos",
  sku: "todos",
  formaPagamento: "todos",
}

const FiltrosContext = createContext<FiltrosContextValue | null>(null)

export function FiltrosProvider({ children }: { children: ReactNode }) {
  const [filtros, setFiltros] = useState<FiltrosState>(padrao)
  const [pedidos, setPedidos] = useState<Pedido[]>(PEDIDOS)
  const [carregando, setCarregando] = useState(true)
  const [fonteDados, setFonteDados] = useState<"mock" | "real">("mock")
  const [autenticado, setAutenticado] = useState(false)
  const [mensagemDados, setMensagemDados] = useState<string>()
  const [lastSync, setLastSync] = useState<string | null>(null)

  // Período customizado ainda sem as duas datas escolhidas: não busca (evita
  // refetch a cada clique no calendário antes do usuário fechar o intervalo).
  const customIncompleto = filtros.periodo === "custom" && !(filtros.customInicio && filtros.customFim)

  useEffect(() => {
    if (customIncompleto) return
    let ativo = true

    async function carregarPedidos() {
      setCarregando(true)
      try {
        const params = new URLSearchParams({ periodo: filtros.periodo })
        if (filtros.periodo === "custom" && filtros.customInicio && filtros.customFim) {
          params.set("de", filtros.customInicio)
          params.set("ate", filtros.customFim)
        }
        const response = await fetch(`/api/olist/orders?${params}`, { cache: "no-store" })
        const data = (await response.json()) as {
          source?: "mock" | "real"
          authenticated?: boolean
          pedidos?: Pedido[]
          message?: string
          lastSync?: string | null
        }

        if (!ativo) return
        setPedidos(data.pedidos?.length ? data.pedidos : PEDIDOS)
        setFonteDados(data.source ?? "mock")
        setAutenticado(Boolean(data.authenticated))
        setMensagemDados(data.message)
        setLastSync(data.lastSync ?? null)
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
  }, [filtros.periodo, filtros.customInicio, filtros.customFim, customIncompleto])

  const setFiltro = <K extends keyof FiltrosState>(chave: K, valor: FiltrosState[K]) => {
    setFiltros((prev) => {
      const next = { ...prev, [chave]: valor }
      // ao trocar de canal, reseta vendedor
      if (chave === "canal") next.vendedor = "todos"
      // ao sair de "custom", limpa as datas escolhidas
      if (chave === "periodo" && valor !== "custom") {
        next.customInicio = null
        next.customFim = null
      }
      return next
    })
  }

  const setPeriodoPersonalizado = (inicio: string, fim: string) =>
    setFiltros((prev) => ({ ...prev, periodo: "custom", customInicio: inicio, customFim: fim }))

  const limpar = () => setFiltros(padrao)

  // Referência = maior data do dataset (funciona p/ mock congelado e p/ dados reais).
  const referencia = useMemo(() => {
    let max = ""
    for (const p of pedidos) if (p.data > max) max = p.data
    return max ? new Date(max + "T00:00:00Z") : new Date()
  }, [pedidos])

  const range = useMemo(() => {
    if (filtros.periodo === "custom" && filtros.customInicio && filtros.customFim) {
      return rangePersonalizado(filtros.customInicio, filtros.customFim)
    }
    return rangePeriodo(filtros.periodo, referencia)
  }, [filtros.periodo, filtros.customInicio, filtros.customFim, referencia])

  const passaDimensoes = useMemo(() => {
    return (p: Pedido) => {
      if (filtros.canal !== "todos" && p.canal !== filtros.canal) return false
      if (filtros.vendedor !== "todos" && p.vendedor !== filtros.vendedor) return false
      if (filtros.sku !== "todos" && p.sku !== filtros.sku) return false
      if (filtros.formaPagamento !== "todos" && p.formaPagamento !== filtros.formaPagamento) return false
      return true
    }
  }, [filtros])

  const pedidosFiltrados = useMemo(
    () =>
      pedidos.filter((p) => {
        if (range.inicio && p.data < range.inicio) return false
        if (range.fim && p.data > range.fim) return false
        return passaDimensoes(p)
      }),
    [pedidos, range, passaDimensoes],
  )

  // Mesmos filtros dimensionais na janela anterior — base do "vs. período anterior".
  const pedidosPeriodoAnterior = useMemo(() => {
    if (!range.inicioAnterior || !range.fimAnterior) return []
    return pedidos.filter(
      (p) => p.data >= range.inicioAnterior! && p.data <= range.fimAnterior! && passaDimensoes(p),
    )
  }, [pedidos, range, passaDimensoes])

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
    setPeriodoPersonalizado,
    limpar,
    pedidosFiltrados,
    pedidosPeriodoAnterior,
    totalSemFiltro: pedidos.length,
    carregando,
    fonteDados,
    autenticado,
    mensagemDados,
    lastSync,
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
