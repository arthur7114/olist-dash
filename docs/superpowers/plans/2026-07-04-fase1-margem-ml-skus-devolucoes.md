# Fase 1 — Custo real ML, Produtos/SKUs e Devoluções — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir a margem do Mercado Livre com tarifa/frete reais da API do ML, criar análise por item/SKU (tabela `order_items` derivada do `raw`) e entregar as páginas "Produtos e SKUs" e "Devoluções", além de correções de base (encoding, status, períodos, variação real).

**Architecture:** Mantém o padrão atual do app — sync jobs gravam no Neon Postgres, `/api/olist/orders` devolve pedidos completos e as páginas calculam KPIs no cliente via Context (`lib/filters.tsx`). Adiciona duas tabelas (`order_items`, `ml_order_costs`), um sync novo (`/api/ml/sync`), um backfill (`/api/olist/backfill-items`) e duas páginas novas seguindo o padrão visual existente (shadcn + Recharts + tokens do `globals.css`).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4, shadcn/ui, Recharts 2.15, Drizzle ORM + Neon, Vitest (novo), @tanstack/react-table (novo).

## Global Constraints

- Todo texto de UI em **pt-BR**; moeda via `formatBRL`/`formatPercent` existentes em `lib/data.ts`.
- Cores **somente** via tokens (`var(--chart-1)`, classes `text-success` etc.) — nunca hex hardcoded.
- Nenhuma página/funcionalidade existente pode quebrar; tipo `Pedido` só ganha campos **opcionais**.
- Cálculo no cliente (padrão atual); sem agregação server-side nesta fase.
- Commits pequenos em português, padrão do repo: `feat(escopo): descrição` / `fix(escopo): descrição`.
- Testes com Vitest apenas para `lib/` (páginas verificadas manualmente via preview).
- Rotas de job protegidas por `OLIST_SYNC_SECRET` com `timingSafeEqual` (copiar padrão de `app/api/olist/sync/route.ts`).
- Datas sempre `yyyy-mm-dd` (comparação lexicográfica é segura).
- Segredos ML em env vars: `ML_CLIENT_ID`, `ML_CLIENT_SECRET` (nunca em código; rotacionar o secret após implantação).

---

## Contexto de produto (resumo das decisões do grill)

- **Dados reais**: 2.668 pedidos (23/03–04/07/2026), canais "Mercado Livre" (2.375) e "Olist ERP" (293, mantém o nome). Vendedores só existem no canal Olist ERP.
- **Devolução** = pedido cancelado na Olist (`situacao=2`), sempre total, sem motivo, atribuída ao mês do pedido. Tooltips devem explicar isso.
- **Custo ML**: 100% dos pedidos têm `taxa_comissao=0` e frete 0 no banco → margem ML superestimada. A API do ML devolve `sale_fee` real por item e custo de frete do vendedor por envio. Join: `raw.ecommerce.numeroPedidoEcommerce` (Olist) == `order_id` (ML). Token via `client_credentials` (expira 6h, sem redirect).
- **Meta anual**: fora do escopo. **Auth**: backlog. **Export**: CSV (XLSX backlog).
- **Alertas** (constantes exportadas, configuráveis em fase futura): margem < 10% = "margem baixa"; taxa de devolução > 5% = "alta devolução"; custo 0 = "sem custo".

### Páginas novas — especificação

**/produtos — Produtos e SKUs**
- Objetivo: cruzar venda × devolução × margem por SKU; achar SKUs que vendem muito e devolvem muito, ou vendem muito com margem baixa.
- KPIs (8 cards): SKUs vendidos, SKUs devolvidos, SKUs sem custo, Taxa média de devolução, Top SKU por faturamento, Top SKU por quantidade, Top SKU por margem, Top SKU por devolução.
- Gráficos: Top 10 SKUs por faturamento (barra horizontal), Top 10 SKUs devolvidos por valor (barra horizontal), Matriz faturamento × margem % (scatter, pontos com alerta em cor de aviso).
- Tabela (DataTable): SKU, Produto, Qtd, Qtd dev., Faturamento, Devolução, Margem R$, Margem %, Markup, Ticket, Pedidos, Alertas. Busca, ordenação, paginação (20/pág), export CSV (com todas as colunas, incluindo custo/taxas/frete), totalizadores, clique na linha abre drawer.
- Drawer de SKU: KPIs do SKU, gráfico mensal vendas × devoluções, canais, composição do cálculo da margem (linha a linha), pedidos relacionados, alertas.
- Estado vazio: "Nenhum SKU no período/filtros selecionados." Mobile: cards em 2 colunas, tabela com scroll horizontal, drawer vira full-width.

**/devolucoes — Devoluções**
- Objetivo: dimensionar a perda com devoluções e localizar concentração (canal, SKU, mês).
- KPIs (6 cards): Devoluções (pedidos), Itens devolvidos, SKUs devolvidos, Valor devolvido, Taxa de devolução (% do faturamento), Ticket médio das devoluções.
- Gráficos: Devoluções por mês (barras de valor + linha de taxa %), Devoluções por canal (barras), Top 10 SKUs devolvidos (reuso do componente da página de produtos).
- Tabela (DataTable): Data, Pedido, NF, Canal, Vendedor, Produto/SKU, Itens, Valor devolvido, Status, clique abre drawer do pedido.
- Drawer de pedido: dados do pedido, tabela de itens, composição da margem (negativa), aviso de que tarifas podem ter sido reembolsadas pelo ML.
- Estado vazio: "Nenhuma devolução no período — bom sinal 👍". Mobile: igual ao padrão acima.

### Catálogo de tooltips (copy final)

| Chave | Texto |
|---|---|
| faturamento-bruto | "Soma do valor de venda de todos os pedidos do período, antes de descontar devoluções, taxas e custos." |
| faturamento-liquido | "Faturamento bruto menos o valor das devoluções. É a base usada para calcular a margem." |
| devolucao | "Pedido cancelado na Olist conta como devolução total. O valor aparece no mês da venda original, não no mês do cancelamento." |
| itens-devolvidos | "Quantidade total de unidades nos pedidos devolvidos. Um pedido pode ter mais de um item." |
| skus-devolvidos | "Quantos códigos de produto diferentes apareceram em devoluções no período." |
| taxa-devolucao | "Percentual do faturamento que voltou como devolução. Quanto maior, maior o impacto no resultado." |
| margem-contribuicao | "Quanto sobra da venda depois de descontar custo do produto, frete, devoluções e tarifas do marketplace." |
| margem-pct | "Margem de contribuição dividida pela receita líquida. Diferente do markup, é expressa como % sobre a venda." |
| markup | "Quantas vezes o preço de venda cobre o custo do produto. Markup 2,0x = vendido pelo dobro do custo." |
| custo-ml-real | "Tarifa e frete obtidos direto da API do Mercado Livre para este pedido. Quando não disponíveis, usamos estimativa por percentual." |
| custo-estimado | "Valor estimado por percentual configurado — a tarifa real deste pedido ainda não foi importada do Mercado Livre." |
| sem-custo | "Pedidos sem custo de produto cadastrado na Olist. A margem fica otimista nesses casos." |
| variacao | "Comparação com o período imediatamente anterior de mesma duração." |

---

## Tarefas

### Task 1: Vitest + primeiro teste (`variacaoPct`)

**Files:**
- Create: `vitest.config.ts`
- Create: `lib/__tests__/data.test.ts`
- Modify: `package.json` (script `test`)
- Modify: `lib/data.ts` (adicionar `variacaoPct`)

**Interfaces:**
- Produces: `variacaoPct(atual: number, anterior: number): number | undefined` em `lib/data.ts` (usada na Task 6).

- [ ] **Step 1: Instalar Vitest**

```bash
pnpm add -D vitest
```

- [ ] **Step 2: Criar `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["lib/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
})
```

- [ ] **Step 3: Adicionar script em `package.json`**

Em `"scripts"`, adicionar: `"test": "vitest run"`.

- [ ] **Step 4: Escrever o teste que falha**

`lib/__tests__/data.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { variacaoPct } from "@/lib/data"

describe("variacaoPct", () => {
  it("calcula variação relativa ao período anterior", () => {
    expect(variacaoPct(120, 100)).toBeCloseTo(0.2)
    expect(variacaoPct(80, 100)).toBeCloseTo(-0.2)
  })
  it("retorna undefined quando não há base de comparação", () => {
    expect(variacaoPct(100, 0)).toBeUndefined()
    expect(variacaoPct(100, NaN)).toBeUndefined()
  })
  it("usa valor absoluto da base para não inverter sinal com anterior negativo", () => {
    expect(variacaoPct(-50, -100)).toBeCloseTo(0.5)
  })
})
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `pnpm test`
Expected: FAIL — `variacaoPct` não exportada.

- [ ] **Step 6: Implementar em `lib/data.ts`** (junto das funções de formatação)

```ts
// Variação % vs. período anterior. undefined = sem base de comparação (oculta no card).
export function variacaoPct(atual: number, anterior: number): number | undefined {
  if (!Number.isFinite(anterior) || anterior === 0) return undefined
  return (atual - anterior) / Math.abs(anterior)
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm test` — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml lib/data.ts lib/__tests__/data.test.ts
git commit -m "feat(test): configurar vitest e adicionar variacaoPct"
```

### Task 2: Normalização de formas de pagamento (encoding)

**Files:**
- Create: `lib/pagamento.ts`
- Create: `lib/__tests__/pagamento.test.ts`
- Modify: `lib/olist-v3.ts:851-871` (mapa `getIntegratedPaymentName` com strings corretas)
- Modify: `lib/db/orders.ts` (`rowToPedido` aplica normalização)

**Interfaces:**
- Produces: `normalizarFormaPagamento(nome: string | null | undefined): string` em `lib/pagamento.ts`.

- [ ] **Step 1: Teste que falha** — `lib/__tests__/pagamento.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { normalizarFormaPagamento } from "@/lib/pagamento"

describe("normalizarFormaPagamento", () => {
  it("corrige mojibake UTF-8 duplo", () => {
    expect(normalizarFormaPagamento("CartÃ£o de crÃ©dito")).toBe("Cartão de crédito")
    expect(normalizarFormaPagamento("CartÃ£o de dÃ©bito")).toBe("Cartão de débito")
    expect(normalizarFormaPagamento("DepÃ³sito bancÃ¡rio")).toBe("Depósito bancário")
  })
  it("mantém valores corretos", () => {
    expect(normalizarFormaPagamento("Pix")).toBe("Pix")
    expect(normalizarFormaPagamento("Mercado Livre")).toBe("Mercado Livre")
  })
  it("trata vazio/nulo como Não informado", () => {
    expect(normalizarFormaPagamento("")).toBe("Não informado")
    expect(normalizarFormaPagamento(undefined)).toBe("Não informado")
    expect(normalizarFormaPagamento(null)).toBe("Não informado")
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test`

- [ ] **Step 3: Implementar `lib/pagamento.ts`**

```ts
// Corrige mojibake (UTF-8 lido como Latin-1) vindo de registros antigos do banco
// e padroniza vazio como "Não informado".
const MOJIBAKE: Array<[string, string]> = [
  ["Ã£", "ã"], ["Ã©", "é"], ["Ã³", "ó"], ["Ã­", "í"], ["Ãª", "ê"],
  ["Ã¡", "á"], ["Ã§", "ç"], ["Ãµ", "õ"], ["Ã¢", "â"], ["Ãº", "ú"],
]

export function normalizarFormaPagamento(nome: string | null | undefined): string {
  const bruto = (nome ?? "").trim()
  if (!bruto) return "Não informado"
  let limpo = bruto
  for (const [errado, certo] of MOJIBAKE) limpo = limpo.split(errado).join(certo)
  return limpo
}
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm test`

- [ ] **Step 5: Corrigir a fonte em `lib/olist-v3.ts`** — substituir o mapa de `getIntegratedPaymentName` pelas strings corretas:

```ts
  const paymentTypes: Record<number, string> = {
    1: "Dinheiro",
    2: "Cheque",
    3: "Cartão de crédito",
    4: "Cartão de débito",
    5: "Crédito loja",
    10: "Vale alimentação",
    11: "Vale refeição",
    12: "Vale presente",
    13: "Vale combustível",
    15: "Boleto",
    16: "Depósito bancário",
    17: "Pix",
    18: "Transferência",
  }
```

- [ ] **Step 6: Aplicar na leitura em `lib/db/orders.ts`** — em `rowToPedido`, trocar
`formaPagamento: r.formaPagamento as FormaPagamento` por:

```ts
    formaPagamento: normalizarFormaPagamento(r.formaPagamento) as FormaPagamento,
```

com import `import { normalizarFormaPagamento } from "@/lib/pagamento"`.

- [ ] **Step 7: Commit**

```bash
git add lib/pagamento.ts lib/__tests__/pagamento.test.ts lib/olist-v3.ts lib/db/orders.ts
git commit -m "fix(pagamento): corrigir encoding das formas de pagamento na fonte e na leitura"
```

### Task 3: Status de pagamento derivado da situação (Aprovado = Pago)

Situações Tiny: 0=Em aberto, 1=Faturado, 2=Cancelado, 3=Aprovado, 4=Preparando envio, 5=Enviado, 6=Entregue, 7=Pronto para envio, 8=Dados incompletos. Hoje só [1,5,6]→Pago; 253 pedidos "Aprovado" aparecem como Pendente. Derivar na **leitura** (corrige o histórico sem migração).

**Files:**
- Create: `lib/__tests__/status.test.ts`
- Modify: `lib/data.ts` (nova função `statusPorSituacao`)
- Modify: `lib/db/orders.ts` (`rowToPedido` usa a situação quando presente)
- Modify: `lib/olist-v3.ts:873-882` (`getStatusPagamento` inclui 3, 4 e 7 como Pago)

**Interfaces:**
- Produces: `statusPorSituacao(situacao: number | null | undefined, fallback: StatusPagamento): StatusPagamento` em `lib/data.ts`.

- [ ] **Step 1: Teste que falha** — `lib/__tests__/status.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { statusPorSituacao } from "@/lib/data"

describe("statusPorSituacao", () => {
  it("mapeia situações pagas (faturado/aprovado/logística)", () => {
    for (const s of [1, 3, 4, 5, 6, 7]) expect(statusPorSituacao(s, "Pendente")).toBe("Pago")
  })
  it("cancelado vira Estornado", () => {
    expect(statusPorSituacao(2, "Pago")).toBe("Estornado")
  })
  it("em aberto/incompleto vira Pendente", () => {
    expect(statusPorSituacao(0, "Pago")).toBe("Pendente")
    expect(statusPorSituacao(8, "Pago")).toBe("Pendente")
  })
  it("sem situação usa o fallback persistido", () => {
    expect(statusPorSituacao(null, "Parcial")).toBe("Parcial")
    expect(statusPorSituacao(undefined, "Pago")).toBe("Pago")
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test`

- [ ] **Step 3: Implementar em `lib/data.ts`**

```ts
// Situações Olist/Tiny: 0 Em aberto, 1 Faturado, 2 Cancelado, 3 Aprovado,
// 4 Preparando envio, 5 Enviado, 6 Entregue, 7 Pronto p/ envio, 8 Dados incompletos.
const SITUACOES_PAGAS = new Set([1, 3, 4, 5, 6, 7])

export function statusPorSituacao(
  situacao: number | null | undefined,
  fallback: StatusPagamento,
): StatusPagamento {
  if (situacao === null || situacao === undefined) return fallback
  if (situacao === 2) return "Estornado"
  if (SITUACOES_PAGAS.has(situacao)) return "Pago"
  return "Pendente"
}
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm test`

- [ ] **Step 5: Usar na leitura** — `lib/db/orders.ts`, em `rowToPedido`:

```ts
    statusPagamento: statusPorSituacao(r.situacao, r.statusPagamento as StatusPagamento),
```

(import de `statusPorSituacao` junto aos demais de `@/lib/data`).

- [ ] **Step 6: Alinhar o sync** — em `lib/olist-v3.ts`, `getStatusPagamento`, trocar `if ([1, 5, 6].includes(order.situacao ?? -1))` por `if ([1, 3, 4, 5, 6, 7].includes(order.situacao ?? -1))`.

- [ ] **Step 7: Commit**

```bash
git add lib/data.ts lib/__tests__/status.test.ts lib/db/orders.ts lib/olist-v3.ts
git commit -m "fix(status): derivar status de pagamento da situação (Aprovado conta como Pago)"
```

### Task 4: `lib/periodo.ts` — períodos novos com janela de comparação

**Files:**
- Create: `lib/periodo.ts`
- Create: `lib/__tests__/periodo.test.ts`

**Interfaces:**
- Produces:
  - `type PeriodoOpcao = "7d" | "15d" | "30d" | "90d" | "mes" | "mes-anterior" | "tudo"`
  - `interface RangePeriodo { inicio: string | null; fim: string | null; inicioAnterior: string | null; fimAnterior: string | null }` (datas `yyyy-mm-dd` inclusivas; `null` = sem limite/sem comparação)
  - `rangePeriodo(periodo: PeriodoOpcao, referencia: Date): RangePeriodo`
  - `normalizarPeriodo(valor: string | null): PeriodoOpcao` (fallback `"30d"`)

- [ ] **Step 1: Teste que falha** — `lib/__tests__/periodo.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { normalizarPeriodo, rangePeriodo } from "@/lib/periodo"

const REF = new Date("2026-07-04T15:30:00Z")

describe("rangePeriodo", () => {
  it("janela de N dias com comparação de mesma duração", () => {
    expect(rangePeriodo("7d", REF)).toEqual({
      inicio: "2026-06-28", fim: "2026-07-04",
      inicioAnterior: "2026-06-21", fimAnterior: "2026-06-27",
    })
  })
  it("mês atual compara com mesmo trecho do mês anterior", () => {
    expect(rangePeriodo("mes", REF)).toEqual({
      inicio: "2026-07-01", fim: "2026-07-04",
      inicioAnterior: "2026-06-01", fimAnterior: "2026-06-04",
    })
  })
  it("mês anterior completo compara com o retrasado", () => {
    expect(rangePeriodo("mes-anterior", REF)).toEqual({
      inicio: "2026-06-01", fim: "2026-06-30",
      inicioAnterior: "2026-05-01", fimAnterior: "2026-05-31",
    })
  })
  it("tudo não tem limites nem comparação", () => {
    expect(rangePeriodo("tudo", REF)).toEqual({
      inicio: null, fim: null, inicioAnterior: null, fimAnterior: null,
    })
  })
  it("fim de mês não estoura o mês anterior (31/03 → 28/02)", () => {
    expect(rangePeriodo("mes", new Date("2026-03-31T12:00:00Z")).fimAnterior).toBe("2026-02-28")
  })
})

describe("normalizarPeriodo", () => {
  it("aceita valores válidos e usa 30d como fallback", () => {
    expect(normalizarPeriodo("90d")).toBe("90d")
    expect(normalizarPeriodo("mes")).toBe("mes")
    expect(normalizarPeriodo("xyz")).toBe("30d")
    expect(normalizarPeriodo(null)).toBe("30d")
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test`

- [ ] **Step 3: Implementar `lib/periodo.ts`**

```ts
// Períodos do filtro global. Todas as datas são yyyy-mm-dd INCLUSIVAS (UTC).
// A janela "anterior" tem a mesma duração da atual e termina no dia anterior
// ao início dela — base do comparativo "vs. período anterior" dos KPIs.

export type PeriodoOpcao = "7d" | "15d" | "30d" | "90d" | "mes" | "mes-anterior" | "tudo"

export interface RangePeriodo {
  inicio: string | null
  fim: string | null
  inicioAnterior: string | null
  fimAnterior: string | null
}

export const PERIODOS_VALIDOS: PeriodoOpcao[] = ["7d", "15d", "30d", "90d", "mes", "mes-anterior", "tudo"]

const DIAS: Partial<Record<PeriodoOpcao, number>> = { "7d": 7, "15d": 15, "30d": 30, "90d": 90 }

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDias(d: Date, n: number): Date {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}

function inicioDoMes(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function fimDoMesAnterior(d: Date): Date {
  return addDias(inicioDoMes(d), -1)
}

// Mesmo dia no mês anterior, limitado ao último dia daquele mês (31/03 → 28/02).
function mesmoDiaMesAnterior(d: Date): Date {
  const fimAnt = fimDoMesAnterior(d)
  const dia = Math.min(d.getUTCDate(), fimAnt.getUTCDate())
  return new Date(Date.UTC(fimAnt.getUTCFullYear(), fimAnt.getUTCMonth(), dia))
}

export function rangePeriodo(periodo: PeriodoOpcao, referencia: Date): RangePeriodo {
  const ref = new Date(iso(referencia) + "T00:00:00Z")

  const dias = DIAS[periodo]
  if (dias) {
    return {
      inicio: iso(addDias(ref, -(dias - 1))),
      fim: iso(ref),
      inicioAnterior: iso(addDias(ref, -(2 * dias - 1))),
      fimAnterior: iso(addDias(ref, -dias)),
    }
  }

  if (periodo === "mes") {
    return {
      inicio: iso(inicioDoMes(ref)),
      fim: iso(ref),
      inicioAnterior: iso(inicioDoMes(fimDoMesAnterior(ref))),
      fimAnterior: iso(mesmoDiaMesAnterior(ref)),
    }
  }

  if (periodo === "mes-anterior") {
    const fim = fimDoMesAnterior(ref)
    const inicio = inicioDoMes(fim)
    const fimRetrasado = addDias(inicio, -1)
    return {
      inicio: iso(inicio),
      fim: iso(fim),
      inicioAnterior: iso(inicioDoMes(fimRetrasado)),
      fimAnterior: iso(fimRetrasado),
    }
  }

  return { inicio: null, fim: null, inicioAnterior: null, fimAnterior: null }
}

export function normalizarPeriodo(valor: string | null): PeriodoOpcao {
  return PERIODOS_VALIDOS.includes(valor as PeriodoOpcao) ? (valor as PeriodoOpcao) : "30d"
}
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm test`

- [ ] **Step 5: Commit**

```bash
git add lib/periodo.ts lib/__tests__/periodo.test.ts
git commit -m "feat(periodo): ranges de período com janela de comparação (7/15/30/90d, mês, mês anterior)"
```

### Task 5: Filtros — novos períodos, referência dinâmica e janela anterior

**Files:**
- Modify: `app/api/olist/orders/route.ts` (usa `rangePeriodo`; busca desde `inicioAnterior`)
- Modify: `lib/filters.tsx` (referência = maior data do dataset; expõe `pedidosPeriodoAnterior` e `lastSync`)
- Modify: `components/dashboard/global-filters.tsx` (opções novas de período)

**Interfaces:**
- Consumes: `rangePeriodo`, `normalizarPeriodo`, `PeriodoOpcao` (Task 4).
- Produces no contexto `useFiltros()`: `pedidosPeriodoAnterior: Pedido[]` e `lastSync: string | null` (usados na Task 6). `FiltrosState.periodo` passa a ser `PeriodoOpcao`.

- [ ] **Step 1: API busca a janela estendida** — reescrever o corpo do `GET` em `app/api/olist/orders/route.ts`:

```ts
import { NextResponse } from "next/server"
import { PEDIDOS } from "@/lib/data"
import { hasDatabase } from "@/lib/db/client"
import { getOrdersByPeriod } from "@/lib/db/orders"
import { getSyncState } from "@/lib/db/syncState"
import { normalizarPeriodo, rangePeriodo } from "@/lib/periodo"

export const runtime = "nodejs"

// O dashboard lê do banco (preenchido pelo job de sync) — sem chamadas à Olist aqui.
// Busca desde o início da janela ANTERIOR para o cliente montar o comparativo.
export async function GET(request: Request) {
  const periodo = normalizarPeriodo(new URL(request.url).searchParams.get("periodo"))

  if (!hasDatabase()) {
    return NextResponse.json({
      source: "mock",
      authenticated: false,
      pedidos: PEDIDOS,
      message: "Banco não configurado. Mostrando dados de exemplo.",
    })
  }

  try {
    const range = rangePeriodo(periodo, new Date())
    const dataInicial = range.inicioAnterior ?? range.inicio ?? "1970-01-01"
    const [pedidos, state] = await Promise.all([getOrdersByPeriod(dataInicial), getSyncState()])

    if (!pedidos.length) {
      return NextResponse.json({
        source: "mock",
        authenticated: Boolean(state),
        pedidos: PEDIDOS,
        message:
          state?.status === "backfilling"
            ? "Sincronização em andamento — mostrando dados de exemplo até concluir."
            : "Sem dados no banco ainda. Conecte a Olist e rode o sync.",
        lastSync: state?.lastSuccessAt ?? null,
      })
    }

    return NextResponse.json({
      source: "real",
      authenticated: true,
      pedidos,
      message: `${pedidos.length} pedidos carregados do banco.`,
      lastSync: state?.lastSuccessAt ?? null,
    })
  } catch (err) {
    return NextResponse.json({
      source: "mock",
      authenticated: false,
      pedidos: PEDIDOS,
      message: err instanceof Error ? err.message : "Não foi possível ler o banco.",
    })
  }
}
```

- [ ] **Step 2: Reescrever a filtragem em `lib/filters.tsx`**

Mudanças pontuais (mantendo o restante do arquivo):

```ts
import { rangePeriodo, type PeriodoOpcao } from "@/lib/periodo"

export type { PeriodoOpcao } // re-export para os componentes existentes

export interface FiltrosState {
  periodo: PeriodoOpcao
  canal: Canal | "todos"
  vendedor: string | "todos"
  sku: string | "todos"
  formaPagamento: FormaPagamento | "todos"
}
```

No `FiltrosContextValue`, adicionar:

```ts
  pedidosPeriodoAnterior: Pedido[]
  lastSync: string | null
```

No provider: novo estado `const [lastSync, setLastSync] = useState<string | null>(null)`; no `carregarPedidos`, ler `lastSync` do JSON (`setLastSync(data.lastSync ?? null)` — adicionar `lastSync?: string | null` ao tipo da resposta). Remover a constante `HOJE` e o mapa `DIAS_PERIODO`; substituir o `useMemo` de `pedidosFiltrados` por:

```ts
  // Referência = maior data do dataset (funciona p/ mock congelado e p/ dados reais).
  const referencia = useMemo(() => {
    let max = ""
    for (const p of pedidos) if (p.data > max) max = p.data
    return max ? new Date(max + "T00:00:00Z") : new Date()
  }, [pedidos])

  const range = useMemo(() => rangePeriodo(filtros.periodo, referencia), [filtros.periodo, referencia])

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
```

Incluir `pedidosPeriodoAnterior` e `lastSync` no `value`.

- [ ] **Step 3: Novas opções no seletor** — `components/dashboard/global-filters.tsx`, substituir `PERIODOS`:

```ts
import type { PeriodoOpcao } from "@/lib/periodo"

const PERIODOS: { valor: PeriodoOpcao; label: string }[] = [
  { valor: "7d", label: "Últimos 7 dias" },
  { valor: "15d", label: "Últimos 15 dias" },
  { valor: "30d", label: "Últimos 30 dias" },
  { valor: "90d", label: "Últimos 90 dias" },
  { valor: "mes", label: "Mês atual" },
  { valor: "mes-anterior", label: "Mês anterior" },
  { valor: "tudo", label: "Todo o período" },
]
```

- [ ] **Step 4: Verificar tipos e app**

Run: `pnpm exec tsc --noEmit` — Expected: sem erros.
Iniciar preview (`olist-dash-dev`), trocar o período para "Mês atual" e "90 dias" e confirmar que os KPIs mudam e nada quebra no console.

- [ ] **Step 5: Commit**

```bash
git add app/api/olist/orders/route.ts lib/filters.tsx components/dashboard/global-filters.tsx
git commit -m "feat(filtros): períodos 90d/mês atual/mês anterior com janela de comparação e referência dinâmica"
```

### Task 6: Visão Geral com variação real + última sincronização no header

**Files:**
- Modify: `app/(dashboard)/page.tsx` (variações calculadas)
- Modify: `components/dashboard/data-source-status.tsx` (mostra `lastSync`)
- Modify: `app/(dashboard)/layout.tsx` (remove "Atualizado em 30/05/2026" fixo)

**Interfaces:**
- Consumes: `variacaoPct` (Task 1), `pedidosPeriodoAnterior`/`lastSync` do contexto (Task 5).

- [ ] **Step 1: Variações reais** — em `app/(dashboard)/page.tsx`:

```tsx
  const { pedidosFiltrados, pedidosPeriodoAnterior } = useFiltros()
  const kpi = calcularKPIs(pedidosFiltrados)
  const kpiAnterior = calcularKPIs(pedidosPeriodoAnterior)

  const cards = [
    { titulo: "Faturamento bruto", valor: formatBRL(kpi.faturamentoBruto), icone: DollarSign, variacao: variacaoPct(kpi.faturamentoBruto, kpiAnterior.faturamentoBruto), destaque: "positivo" as const, legenda: "vs. período anterior" },
    { titulo: "Quantidade de pedidos", valor: formatNumero(kpi.quantidadePedidos), icone: ShoppingCart, variacao: variacaoPct(kpi.quantidadePedidos, kpiAnterior.quantidadePedidos), destaque: "default" as const, legenda: "vs. período anterior" },
    { titulo: "Valor total de frete", valor: formatBRL(kpi.totalFrete), icone: Truck, variacao: variacaoPct(kpi.totalFrete, kpiAnterior.totalFrete), destaque: "default" as const, legenda: "custo logístico" },
    { titulo: "Valor de devoluções", valor: formatBRL(kpi.totalDevolucoes), icone: Undo2, variacao: variacaoPct(kpi.totalDevolucoes, kpiAnterior.totalDevolucoes), destaque: "alerta" as const, legenda: "vs. período anterior" },
    { titulo: "Margem de contribuição", valor: formatBRL(kpi.lucroBruto), icone: TrendingUp, variacao: variacaoPct(kpi.lucroBruto, kpiAnterior.lucroBruto), destaque: "positivo" as const, legenda: "receita − custos/taxas variáveis" },
    { titulo: "Ticket médio", valor: formatBRL(kpi.ticketMedio), icone: Receipt, variacao: variacaoPct(kpi.ticketMedio, kpiAnterior.ticketMedio), destaque: "default" as const, legenda: "por pedido" },
    { titulo: "Margem de contribuição %", valor: formatPercent(kpi.margemMedia), icone: Percent, variacao: variacaoPct(kpi.margemMedia, kpiAnterior.margemMedia), destaque: "positivo" as const, legenda: "M.C. / receita líquida" },
    { titulo: "Markup médio", valor: formatMarkup(kpi.markupMedio), icone: Layers, variacao: variacaoPct(kpi.markupMedio, kpiAnterior.markupMedio), destaque: "default" as const, legenda: "venda / custo" },
  ]
```

(adicionar `variacaoPct` ao import de `@/lib/data`). O `KpiCard` já oculta a seta quando `variacao === undefined` — conferir que a condição é `variacao !== undefined`.

- [ ] **Step 2: `lastSync` real** — em `components/dashboard/data-source-status.tsx`, ler `lastSync` do contexto e acrescentar após o badge:

```tsx
      {lastSync && (
        <span className="hidden text-xs text-muted-foreground md:inline">
          Atualizado {new Date(lastSync).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
```

- [ ] **Step 3: Remover o texto fixo** — em `app/(dashboard)/layout.tsx`, apagar a linha
`<span className="hidden text-xs text-muted-foreground sm:inline">Atualizado em 30/05/2026</span>`.

- [ ] **Step 4: Verificar no preview** — Visão Geral deve mostrar setas coerentes (ex: comparar "Mês atual" contra o trecho equivalente do mês anterior) e o horário real da última sincronização no header. `pnpm exec tsc --noEmit` sem erros.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/page.tsx" components/dashboard/data-source-status.tsx "app/(dashboard)/layout.tsx"
git commit -m "feat(visao-geral): variação real vs. período anterior e última sincronização no header"
```

### Task 7: Schema `order_items` + migração

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/0002_*.sql` (gerada)

**Interfaces:**
- Produces: tabela `orderItems` exportada de `lib/db/schema.ts` com colunas `{ id, olistId, sku, produtoOlistId, descricao, quantidade, valorUnitario, custoUnitario, data, updatedAt }`.

- [ ] **Step 1: Adicionar ao `lib/db/schema.ts`**

```ts
// Itens de pedido, extraídos do JSON `raw` de orders. 1 linha por item.
// `data` e denormalizada do pedido p/ filtrar por período sem join.
export const orderItems = pgTable(
  "order_items",
  {
    id: text("id").primaryKey(), // `${olistId}:${indice}`
    olistId: text("olist_id").notNull(),
    sku: text("sku").notNull().default("sem-sku"),
    produtoOlistId: integer("produto_olist_id"),
    descricao: text("descricao").notNull().default(""),
    quantidade: integer("quantidade").notNull().default(1),
    valorUnitario: numeric("valor_unitario", { precision: 14, scale: 2 }).notNull().default("0"),
    custoUnitario: numeric("custo_unitario", { precision: 14, scale: 2 }).notNull().default("0"),
    data: date("data").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    olistIdx: index("order_items_olist_idx").on(t.olistId),
    dataIdx: index("order_items_data_idx").on(t.data),
    skuIdx: index("order_items_sku_idx").on(t.sku),
  }),
)
```

- [ ] **Step 2: Gerar e aplicar a migração**

```bash
pnpm db:generate
pnpm db:migrate
```

Expected: nova migração em `drizzle/` criando `order_items`; `db:migrate` aplica sem erro (usa `DATABASE_URL` do `.env.local` — exportar antes: `export $(grep '^DATABASE_URL' .env.local | head -1)` se necessário).

- [ ] **Step 3: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(db): tabela order_items para análise por item/SKU"
```

### Task 8: Extração de itens do `raw` (`extractOrderItems`)

**Files:**
- Create: `lib/olist-items.ts`
- Create: `lib/__tests__/olist-items.test.ts`
- Modify: `lib/olist-v3.ts` (exportar `toNumber` e o tipo `TinyOrderDetail`)

**Interfaces:**
- Consumes: `TinyOrderDetail`, `toNumber` de `lib/olist-v3.ts`.
- Produces em `lib/olist-items.ts`:
  - `type SyncOrderItem = { sku: string; produtoOlistId: number | null; descricao: string; quantidade: number; valorUnitario: number; custoUnitario: number }`
  - `extractOrderItems(detail: TinyOrderDetail, custoDe: (id?: number, sku?: string) => number): SyncOrderItem[]`

- [ ] **Step 1: Exportar dependências** — em `lib/olist-v3.ts`: trocar `type TinyOrderDetail = ...` por `export type TinyOrderDetail = ...` e `function toNumber(` por `export function toNumber(`.

- [ ] **Step 2: Teste que falha** — `lib/__tests__/olist-items.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { extractOrderItems } from "@/lib/olist-items"
import type { TinyOrderDetail } from "@/lib/olist-v3"

const DETALHE: TinyOrderDetail = {
  id: 123,
  itens: [
    { produto: { id: 10, sku: "6103", descricao: "ALAVANCA COMPLETA" }, quantidade: 2, valorUnitario: 100 },
    { produto: { id: 11, sku: "", descricao: "CABO" }, quantidade: 1, valorUnitario: 50 },
  ],
}

describe("extractOrderItems", () => {
  it("extrai itens com custo do lookup", () => {
    const itens = extractOrderItems(DETALHE, (id) => (id === 10 ? 40 : 0))
    expect(itens).toEqual([
      { sku: "6103", produtoOlistId: 10, descricao: "ALAVANCA COMPLETA", quantidade: 2, valorUnitario: 100, custoUnitario: 40 },
      { sku: "sem-sku", produtoOlistId: 11, descricao: "CABO", quantidade: 1, valorUnitario: 50, custoUnitario: 0 },
    ])
  })
  it("pedido sem itens retorna lista vazia", () => {
    expect(extractOrderItems({ id: 1 }, () => 0)).toEqual([])
  })
  it("quantidade mínima é 1 e valores string são convertidos", () => {
    const itens = extractOrderItems(
      { id: 2, itens: [{ produto: { sku: "X" }, quantidade: 0, valorUnitario: "12,50" as unknown as number }] },
      () => 0,
    )
    expect(itens[0].quantidade).toBe(1)
    expect(itens[0].valorUnitario).toBe(12.5)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar** — `pnpm test`

- [ ] **Step 4: Implementar `lib/olist-items.ts`**

```ts
import { toNumber, type TinyOrderDetail } from "@/lib/olist-v3"

// Item de pedido pronto para persistir em order_items.
export type SyncOrderItem = {
  sku: string
  produtoOlistId: number | null
  descricao: string
  quantidade: number
  valorUnitario: number
  custoUnitario: number
}

// Extrai os itens do detalhe da Olist. `custoDe` resolve o custo unitário
// (cache product_costs) por id do produto e/ou sku — 0 quando desconhecido.
export function extractOrderItems(
  detail: TinyOrderDetail,
  custoDe: (id?: number, sku?: string) => number,
): SyncOrderItem[] {
  return (detail.itens ?? []).map((item) => {
    const sku = item.produto?.sku?.trim() || "sem-sku"
    const produtoOlistId = typeof item.produto?.id === "number" ? item.produto.id : null
    return {
      sku,
      produtoOlistId,
      descricao: item.produto?.descricao?.trim() ?? "",
      quantidade: Math.max(1, toNumber(item.quantidade)),
      valorUnitario: toNumber(item.valorUnitario),
      custoUnitario: custoDe(produtoOlistId ?? undefined, sku === "sem-sku" ? undefined : sku),
    }
  })
}
```

- [ ] **Step 5: Rodar e ver passar** — `pnpm test`

- [ ] **Step 6: Commit**

```bash
git add lib/olist-items.ts lib/__tests__/olist-items.test.ts lib/olist-v3.ts
git commit -m "feat(itens): extração de itens de pedido a partir do raw da Olist"
```

### Task 9: Persistência de itens + sync grava itens

**Files:**
- Create: `lib/db/orderItems.ts`
- Modify: `lib/olist-v3.ts` (`SyncOrder` ganha `itens`; `flush` os monta)
- Modify: `lib/db/orders.ts` (`upsertOrders` grava itens)

**Interfaces:**
- Consumes: `orderItems` (Task 7), `extractOrderItems`/`SyncOrderItem` (Task 8).
- Produces em `lib/db/orderItems.ts`:
  - `replaceOrderItems(porPedido: Array<{ olistId: string; data: string; itens: SyncOrderItem[] }>): Promise<number>`
  - `getOrdersWithoutItems(limit: number): Promise<Array<{ olistId: string; data: string; raw: unknown }>>`
  - `getItemsByPeriod(dataInicial: string): Promise<Map<string, ItemPedido[]>>`
- `SyncOrder` (em `lib/olist-v3.ts`) ganha campo `itens: SyncOrderItem[]`.
- `ItemPedido` em `lib/data.ts`: `{ sku: string; descricao: string; quantidade: number; valorUnitario: number; custoUnitario: number }`.

- [ ] **Step 1: Tipo `ItemPedido` em `lib/data.ts`** (junto ao tipo `Pedido`):

```ts
export interface ItemPedido {
  sku: string
  descricao: string
  quantidade: number
  valorUnitario: number
  custoUnitario: number
}
```

E em `Pedido`, adicionar campos opcionais:

```ts
  itens?: ItemPedido[]
  custoMlReal?: boolean // taxa/frete vieram da API do Mercado Livre (Task 15)
```

- [ ] **Step 2: Criar `lib/db/orderItems.ts`**

```ts
import { gte, inArray, sql } from "drizzle-orm"
import { getDb } from "./client"
import { orderItems } from "./schema"
import type { ItemPedido } from "@/lib/data"
import type { SyncOrderItem } from "@/lib/olist-items"

// Substitui os itens dos pedidos informados (delete + insert): pedidos editados
// na Olist podem perder/ganhar itens, e o upsert puro deixaria linhas órfãs.
export async function replaceOrderItems(
  porPedido: Array<{ olistId: string; data: string; itens: SyncOrderItem[] }>,
): Promise<number> {
  if (!porPedido.length) return 0
  const db = getDb()
  const ids = porPedido.map((p) => p.olistId)
  const rows = porPedido.flatMap((p) =>
    p.itens.map((item, i) => ({
      id: `${p.olistId}:${i}`,
      olistId: p.olistId,
      sku: item.sku,
      produtoOlistId: item.produtoOlistId,
      descricao: item.descricao,
      quantidade: item.quantidade,
      valorUnitario: String(item.valorUnitario),
      custoUnitario: String(item.custoUnitario),
      data: p.data,
    })),
  )

  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    await db.delete(orderItems).where(inArray(orderItems.olistId, ids.slice(i, i + CHUNK)))
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(orderItems).values(rows.slice(i, i + CHUNK))
  }
  return rows.length
}

// Pedidos com raw salvo e nenhum item extraído — alvo do backfill.
export async function getOrdersWithoutItems(
  limit: number,
): Promise<Array<{ olistId: string; data: string; raw: unknown }>> {
  const db = getDb()
  return db.execute(sql`
    select o.olist_id as "olistId", o.data::text as "data", o.raw as "raw"
    from orders o
    where o.raw is not null
      and not exists (select 1 from order_items i where i.olist_id = o.olist_id)
    order by o.data desc
    limit ${limit}
  `) as unknown as Promise<Array<{ olistId: string; data: string; raw: unknown }>>
}

// Itens agrupados por pedido para o período — anexados aos Pedidos pela API.
export async function getItemsByPeriod(dataInicial: string): Promise<Map<string, ItemPedido[]>> {
  const db = getDb()
  const rows = await db.select().from(orderItems).where(gte(orderItems.data, dataInicial))
  const mapa = new Map<string, ItemPedido[]>()
  for (const r of rows) {
    const lista = mapa.get(r.olistId) ?? []
    lista.push({
      sku: r.sku,
      descricao: r.descricao,
      quantidade: r.quantidade,
      valorUnitario: Number(r.valorUnitario),
      custoUnitario: Number(r.custoUnitario),
    })
    mapa.set(r.olistId, lista)
  }
  return mapa
}
```

Nota: se `db.execute` do driver neon-http retornar `{ rows }`, ajustar para `const res = await db.execute(...); return res.rows` — verificar no Step 5.

- [ ] **Step 3: `SyncOrder` ganha itens** — em `lib/olist-v3.ts`:

```ts
import { extractOrderItems, type SyncOrderItem } from "@/lib/olist-items"

export type SyncOrder = {
  pedido: Pedido
  situacao?: number
  detailLevel: "full" | "summary"
  raw: TinyOrderDetail
  itens: SyncOrderItem[]
}
```

No `flush()` de `syncOrdersIncremental`, montar o lookup e incluir itens:

```ts
    const custoDe = (id?: number, sku?: string) =>
      (id !== undefined ? productCosts.byId.get(id) : undefined) ??
      (sku ? productCosts.bySku.get(sku) : undefined) ??
      0
    const mapped: SyncOrder[] = batch.map((detail) => ({
      pedido: mapOrderToPedido(detail, productCosts, noPayments),
      situacao: detail.situacao,
      detailLevel: "full",
      raw: detail,
      itens: extractOrderItems(detail, custoDe),
    }))
```

- [ ] **Step 4: `upsertOrders` grava itens** — em `lib/db/orders.ts`, ao final de `upsertOrders` (antes do `return`):

```ts
  await replaceOrderItems(
    items.map(({ pedido, itens }) => ({ olistId: pedido.id, data: pedido.data, itens })),
  )
```

com `import { replaceOrderItems } from "./orderItems"`.

- [ ] **Step 5: Verificar tipos** — `pnpm exec tsc --noEmit` e `pnpm test`. Expected: sem erros (ajustar `db.execute` se necessário, conforme nota do Step 2).

- [ ] **Step 6: Commit**

```bash
git add lib/db/orderItems.ts lib/olist-v3.ts lib/db/orders.ts lib/data.ts
git commit -m "feat(itens): sync passa a gravar itens de pedido em order_items"
```

### Task 10: Rota de backfill de itens + execução

**Files:**
- Create: `app/api/olist/backfill-items/route.ts`

**Interfaces:**
- Consumes: `getOrdersWithoutItems`, `replaceOrderItems` (Task 9), `extractOrderItems` (Task 8), `getAllProductCosts` de `lib/db/productCosts.ts`.

- [ ] **Step 1: Criar a rota** — `app/api/olist/backfill-items/route.ts`:

```ts
import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { hasDatabase } from "@/lib/db/client"
import { getAllProductCosts } from "@/lib/db/productCosts"
import { getOrdersWithoutItems, replaceOrderItems } from "@/lib/db/orderItems"
import { extractOrderItems } from "@/lib/olist-items"
import type { TinyOrderDetail } from "@/lib/olist-v3"

export const runtime = "nodejs"
export const maxDuration = 300

const BUDGET_MS = 230_000

// Extrai itens do `raw` de pedidos já sincronizados — SEM chamar a Olist.
// Resumível: rode repetidas vezes até remaining=0.
export async function POST(request: Request) {
  return handle(request)
}
export async function GET(request: Request) {
  return handle(request)
}

async function handle(request: Request) {
  const secret = process.env.OLIST_SYNC_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: "OLIST_SYNC_SECRET não configurado." }, { status: 500 })
  }
  const url = new URL(request.url)
  const auth = request.headers.get("authorization") ?? ""
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("key") ?? ""
  if (!safeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 })
  }
  if (!hasDatabase()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL não configurado." }, { status: 500 })
  }

  const deadline = Date.now() + BUDGET_MS
  const custos = await getAllProductCosts()
  const porId = new Map<number, number>()
  const porSku = new Map<string, number>()
  for (const { ref, custo } of custos) {
    if (ref.startsWith("id:")) porId.set(Number(ref.slice(3)), custo)
    else if (ref.startsWith("sku:")) porSku.set(ref.slice(4), custo)
  }
  const custoDe = (id?: number, sku?: string) =>
    (id !== undefined ? porId.get(id) : undefined) ?? (sku ? porSku.get(sku) : undefined) ?? 0

  let processed = 0
  let itensGravados = 0
  let completed = true

  while (true) {
    if (Date.now() >= deadline) {
      completed = false
      break
    }
    const lote = await getOrdersWithoutItems(300)
    if (!lote.length) break
    itensGravados += await replaceOrderItems(
      lote.map((o) => ({
        olistId: o.olistId,
        data: o.data,
        itens: extractOrderItems(o.raw as TinyOrderDetail, custoDe),
      })),
    )
    processed += lote.length
    if (lote.length < 300) break
  }

  const restante = await getOrdersWithoutItems(1)
  return NextResponse.json({ ok: true, processed, itensGravados, remaining: restante.length, completed })
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
```

Atenção: pedidos cujo `raw.itens` é vazio geram 0 itens e continuariam elegíveis no `getOrdersWithoutItems` — como `extractOrderItems` de raws minimal sempre gera ≥1 item (o `itemToMinimalDetail` cria 1 item sintético) isso não trava na prática; se travar (mesmo `processed` repetindo), adicionar guarda de `processed` estagnado no loop (`if (loteAnterior === processed) break`).

- [ ] **Step 2: Testar localmente**

```bash
pnpm exec tsc --noEmit
# com o dev server rodando (porta do preview):
curl -s "http://localhost:PORTA/api/olist/backfill-items?key=$OLIST_SYNC_SECRET" | head -c 400
```

Expected: JSON `{ ok: true, processed: N, itensGravados: M, remaining: 0, completed: true }` (o `.env.local` aponta para o banco de produção — o backfill roda direto na base real; repetir até `remaining: 0`).

- [ ] **Step 3: Commit**

```bash
git add app/api/olist/backfill-items/route.ts
git commit -m "feat(itens): rota de backfill de order_items a partir do raw"
```

### Task 11: API de pedidos retorna itens

**Files:**
- Modify: `app/api/olist/orders/route.ts` (anexa itens)

**Interfaces:**
- Consumes: `getItemsByPeriod` (Task 9).
- Produces: cada `Pedido` da resposta ganha `itens: ItemPedido[]` (páginas das Tasks 19–25 dependem disso).

- [ ] **Step 1: Anexar itens** — no `try` da rota, após buscar pedidos:

```ts
    const [pedidos, state, itensPorPedido] = await Promise.all([
      getOrdersByPeriod(dataInicial),
      getSyncState(),
      getItemsByPeriod(dataInicial),
    ])
    const pedidosComItens = pedidos.map((p) => ({ ...p, itens: itensPorPedido.get(p.id) ?? [] }))
```

e usar `pedidosComItens` no `NextResponse.json` (os dois retornos).

- [ ] **Step 2: Verificar** — `pnpm exec tsc --noEmit`; no preview, `curl "http://localhost:PORTA/api/olist/orders?periodo=7d"` deve trazer `"itens":[...]` nos pedidos.

- [ ] **Step 3: Commit**

```bash
git add app/api/olist/orders/route.ts
git commit -m "feat(api): pedidos retornam itens para análise por SKU"
```

### Task 12: Schema `ml_order_costs` + migração + envs

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/0003_*.sql` (gerada)
- Modify: `.env.local` (local) e envs no painel Vercel

**Interfaces:**
- Produces: tabela `mlOrderCosts` com `{ mlOrderId, olistId, saleFee, shippingCost, listingType, mlStatus, raw, fetchedAt }`.

- [ ] **Step 1: Adicionar ao `lib/db/schema.ts`**

```ts
// Custos reais por pedido vindos da API do Mercado Livre (sale_fee + frete do vendedor).
// Join com orders via olist_id; ml_order_id = raw.ecommerce.numeroPedidoEcommerce.
export const mlOrderCosts = pgTable("ml_order_costs", {
  mlOrderId: text("ml_order_id").primaryKey(),
  olistId: text("olist_id").notNull().unique(),
  saleFee: numeric("sale_fee", { precision: 14, scale: 2 }).notNull().default("0"),
  shippingCost: numeric("shipping_cost", { precision: 14, scale: 2 }).notNull().default("0"),
  listingType: text("listing_type"),
  mlStatus: text("ml_status"),
  raw: jsonb("raw"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 2: Migrar**

```bash
pnpm db:generate && pnpm db:migrate
```

- [ ] **Step 3: Configurar credenciais**

No `.env.local`, adicionar (valores fornecidos pelo usuário na sessão — depois **rotacionar o secret** no painel dev do ML):

```
ML_CLIENT_ID=5847570196667447
ML_CLIENT_SECRET=<secret>
```

No painel da Vercel (projeto olist-dash → Settings → Environment Variables), criar as duas para Production/Preview/Development. Atenção: `vercel env pull` sobrescreve `.env.local` — adicionar na Vercel PRIMEIRO e rodar `vercel env pull .env.local` para manter tudo em sincronia.

- [ ] **Step 4: Commit**

```bash
git add lib/db/schema.ts drizzle/
git commit -m "feat(db): tabela ml_order_costs para tarifas e frete reais do Mercado Livre"
```

### Task 13: Cliente da API do Mercado Livre

**Files:**
- Create: `lib/ml-api.ts`
- Create: `lib/__tests__/ml-api.test.ts`

**Interfaces:**
- Produces em `lib/ml-api.ts`:
  - `getMlAccessToken(fetchFn?: typeof fetch): Promise<string>` (cache em módulo até expirar)
  - `type MlOrderCost = { mlOrderId: string; saleFee: number; shippingCost: number; listingType: string | null; mlStatus: string | null; raw: unknown }`
  - `fetchMlOrderCost(mlOrderId: string, accessToken: string, fetchFn?: typeof fetch): Promise<MlOrderCost | null>` (null quando o pedido não existe no ML)
  - `_resetTokenCache(): void` (só para testes)

- [ ] **Step 1: Teste que falha** — `lib/__tests__/ml-api.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import { _resetTokenCache, fetchMlOrderCost, getMlAccessToken } from "@/lib/ml-api"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

beforeEach(() => {
  _resetTokenCache()
  process.env.ML_CLIENT_ID = "id"
  process.env.ML_CLIENT_SECRET = "secret"
})

describe("getMlAccessToken", () => {
  it("busca token e reusa do cache até expirar", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ access_token: "tok", expires_in: 21600 }))
    expect(await getMlAccessToken(fetchFn as unknown as typeof fetch)).toBe("tok")
    expect(await getMlAccessToken(fetchFn as unknown as typeof fetch)).toBe("tok")
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe("fetchMlOrderCost", () => {
  it("soma sale_fee por quantidade e busca custo de frete do vendedor", async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("/orders/")) {
        return Promise.resolve(
          jsonResponse({
            id: 2000017243866816,
            status: "paid",
            shipping: { id: 47444074544 },
            order_items: [
              { quantity: 2, sale_fee: 13.63, listing_type_id: "gold_pro" },
              { quantity: 1, sale_fee: 5.0, listing_type_id: "gold_special" },
            ],
          }),
        )
      }
      return Promise.resolve(jsonResponse({ senders: [{ cost: 12.35 }] }))
    })
    const result = await fetchMlOrderCost("2000017243866816", "tok", fetchFn as unknown as typeof fetch)
    expect(result).toEqual({
      mlOrderId: "2000017243866816",
      saleFee: 32.26, // 13.63*2 + 5.00
      shippingCost: 12.35,
      listingType: "gold_pro",
      mlStatus: "paid",
      raw: expect.anything(),
    })
  })
  it("pedido inexistente (404) retorna null", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: "not_found" }, 404))
    expect(await fetchMlOrderCost("999", "tok", fetchFn as unknown as typeof fetch)).toBeNull()
  })
  it("sem shipping id o frete é 0", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ id: 1, status: "paid", order_items: [{ quantity: 1, sale_fee: 10 }] }),
    )
    const result = await fetchMlOrderCost("1", "tok", fetchFn as unknown as typeof fetch)
    expect(result?.shippingCost).toBe(0)
    expect(result?.saleFee).toBe(10)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test`

- [ ] **Step 3: Implementar `lib/ml-api.ts`**

```ts
// Cliente mínimo da API do Mercado Livre para custos reais por pedido.
// Token via client_credentials (a app da conta OEMPARTSOFICIAL já tem escopo de
// orders/shipments) — expira em ~6h; cache em módulo com folga de 60s.

const ML_API_URL = "https://api.mercadolibre.com"

let tokenCache: { token: string; expiresAt: number } | null = null

export function _resetTokenCache(): void {
  tokenCache = null
}

export async function getMlAccessToken(fetchFn: typeof fetch = fetch): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token

  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("ML_CLIENT_ID e ML_CLIENT_SECRET precisam estar configurados.")
  }

  const response = await fetchFn(`${ML_API_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  })
  if (!response.ok) {
    throw new Error(`Falha ao obter token do Mercado Livre (${response.status}): ${await response.text()}`)
  }
  const data = (await response.json()) as { access_token: string; expires_in?: number }
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 21600) * 1000 }
  return data.access_token
}

export type MlOrderCost = {
  mlOrderId: string
  saleFee: number
  shippingCost: number
  listingType: string | null
  mlStatus: string | null
  raw: unknown
}

type MlOrder = {
  id?: number
  status?: string
  shipping?: { id?: number }
  order_items?: Array<{ quantity?: number; sale_fee?: number; listing_type_id?: string }>
}

type MlShipmentCosts = { senders?: Array<{ cost?: number }> }

export async function fetchMlOrderCost(
  mlOrderId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<MlOrderCost | null> {
  const headers = { Authorization: `Bearer ${accessToken}` }

  const orderRes = await fetchFn(`${ML_API_URL}/orders/${mlOrderId}`, { headers, cache: "no-store" })
  if (orderRes.status === 404) return null
  if (!orderRes.ok) {
    throw new Error(`ML /orders/${mlOrderId} retornou ${orderRes.status}: ${await orderRes.text()}`)
  }
  const order = (await orderRes.json()) as MlOrder

  const saleFee = (order.order_items ?? []).reduce(
    (sum, item) => sum + (item.sale_fee ?? 0) * Math.max(1, item.quantity ?? 1),
    0,
  )

  let shippingCost = 0
  const shippingId = order.shipping?.id
  if (shippingId) {
    const costsRes = await fetchFn(`${ML_API_URL}/shipments/${shippingId}/costs`, { headers, cache: "no-store" })
    if (costsRes.ok) {
      const costs = (await costsRes.json()) as MlShipmentCosts
      shippingCost = (costs.senders ?? []).reduce((sum, s) => sum + (s.cost ?? 0), 0)
    }
  }

  return {
    mlOrderId,
    saleFee: Math.round(saleFee * 100) / 100,
    shippingCost: Math.round(shippingCost * 100) / 100,
    listingType: order.order_items?.[0]?.listing_type_id ?? null,
    mlStatus: order.status ?? null,
    raw: order,
  }
}
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm test`

- [ ] **Step 5: Commit**

```bash
git add lib/ml-api.ts lib/__tests__/ml-api.test.ts
git commit -m "feat(ml): cliente da API do Mercado Livre (token + sale_fee + frete do vendedor)"
```

### Task 14: Persistência ML + rota `/api/ml/sync` + execução

**Files:**
- Create: `lib/db/mlOrderCosts.ts`
- Create: `app/api/ml/sync/route.ts`

**Interfaces:**
- Consumes: `mlOrderCosts` (Task 12), `getMlAccessToken`/`fetchMlOrderCost` (Task 13).
- Produces em `lib/db/mlOrderCosts.ts`:
  - `upsertMlOrderCost(row: { mlOrderId: string; olistId: string; saleFee: number; shippingCost: number; listingType: string | null; mlStatus: string | null; raw: unknown }): Promise<void>`
  - `getOrdersMissingMlCost(limit: number): Promise<Array<{ olistId: string; mlOrderId: string }>>`

- [ ] **Step 1: Criar `lib/db/mlOrderCosts.ts`**

```ts
import { sql } from "drizzle-orm"
import { getDb } from "./client"
import { mlOrderCosts } from "./schema"

export async function upsertMlOrderCost(row: {
  mlOrderId: string
  olistId: string
  saleFee: number
  shippingCost: number
  listingType: string | null
  mlStatus: string | null
  raw: unknown
}): Promise<void> {
  const db = getDb()
  await db
    .insert(mlOrderCosts)
    .values({
      mlOrderId: row.mlOrderId,
      olistId: row.olistId,
      saleFee: String(row.saleFee),
      shippingCost: String(row.shippingCost),
      listingType: row.listingType,
      mlStatus: row.mlStatus,
      raw: row.raw as never,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: mlOrderCosts.mlOrderId,
      set: {
        saleFee: sql`excluded.sale_fee`,
        shippingCost: sql`excluded.shipping_cost`,
        listingType: sql`excluded.listing_type`,
        mlStatus: sql`excluded.ml_status`,
        raw: sql`excluded.raw`,
        fetchedAt: sql`excluded.fetched_at`,
      },
    })
}

// Pedidos ML sem custo real importado, mais recentes primeiro.
// O id do pedido no ML vem do raw da Olist (ecommerce.numeroPedidoEcommerce).
export async function getOrdersMissingMlCost(
  limit: number,
): Promise<Array<{ olistId: string; mlOrderId: string }>> {
  const db = getDb()
  const res = await db.execute(sql`
    select o.olist_id as "olistId",
           o.raw->'ecommerce'->>'numeroPedidoEcommerce' as "mlOrderId"
    from orders o
    where o.canal = 'Mercado Livre'
      and coalesce(o.raw->'ecommerce'->>'numeroPedidoEcommerce', '') <> ''
      and not exists (select 1 from ml_order_costs m where m.olist_id = o.olist_id)
    order by o.data desc
    limit ${limit}
  `)
  return res as unknown as Array<{ olistId: string; mlOrderId: string }>
}
```

(mesma nota da Task 9 sobre `db.execute` retornar `{ rows }` no driver — ajustar se preciso).

- [ ] **Step 2: Criar `app/api/ml/sync/route.ts`**

```ts
import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { hasDatabase } from "@/lib/db/client"
import { getOrdersMissingMlCost, upsertMlOrderCost } from "@/lib/db/mlOrderCosts"
import { fetchMlOrderCost, getMlAccessToken } from "@/lib/ml-api"

export const runtime = "nodejs"
export const maxDuration = 300

const BUDGET_MS = 230_000
const INTERVALO_MS = 150 // ~2 chamadas ML por pedido; folga sob o rate limit

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Importa tarifas (sale_fee) e frete do vendedor da API do ML para pedidos que
// ainda não têm custo real. Resumível: rode até remaining=0; agende junto do sync Olist.
export async function POST(request: Request) {
  return handle(request)
}
export async function GET(request: Request) {
  return handle(request)
}

async function handle(request: Request) {
  const secret = process.env.OLIST_SYNC_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: "OLIST_SYNC_SECRET não configurado." }, { status: 500 })
  }
  const url = new URL(request.url)
  const auth = request.headers.get("authorization") ?? ""
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("key") ?? ""
  if (!safeEqual(provided, secret)) {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 })
  }
  if (!hasDatabase()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL não configurado." }, { status: 500 })
  }

  const deadline = Date.now() + BUDGET_MS
  let processed = 0
  let notFound = 0
  let errors = 0
  let completed = true

  try {
    const token = await getMlAccessToken()
    const pendentes = await getOrdersMissingMlCost(2000)

    for (const { olistId, mlOrderId } of pendentes) {
      if (Date.now() >= deadline) {
        completed = false
        break
      }
      try {
        const cost = await fetchMlOrderCost(mlOrderId, token)
        if (!cost) {
          notFound += 1
          // Grava tombstone com valores 0 p/ não rebuscar eternamente um id inválido.
          await upsertMlOrderCost({ mlOrderId, olistId, saleFee: 0, shippingCost: 0, listingType: null, mlStatus: "not_found", raw: null })
        } else {
          await upsertMlOrderCost({ ...cost, olistId })
          processed += 1
        }
      } catch {
        errors += 1
        if (errors > 20) {
          completed = false
          break // API instável — para e deixa a próxima execução continuar
        }
      }
      await delay(INTERVALO_MS)
    }

    const restante = await getOrdersMissingMlCost(1)
    return NextResponse.json({ ok: true, processed, notFound, errors, remaining: restante.length, completed })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
```

- [ ] **Step 3: Rodar contra produção**

```bash
pnpm exec tsc --noEmit
# com dev server ativo (usa DATABASE_URL + ML_* do .env.local):
curl -s "http://localhost:PORTA/api/ml/sync?key=$OLIST_SYNC_SECRET" | head -c 400
```

Expected: `{ ok: true, processed: ~600-900, ..., completed: false }` na primeira execução (2.375 pedidos × ~0,45s ≈ 4 execuções). Repetir até `remaining: 0`.

- [ ] **Step 4: Agendar em produção** — no workflow/cron que já chama `/api/olist/sync` (GitHub Actions em `.github/workflows/`), adicionar chamada subsequente a `/api/ml/sync` com o mesmo secret. Abrir o workflow existente e replicar o step de curl, mudando a URL.

- [ ] **Step 5: Commit**

```bash
git add lib/db/mlOrderCosts.ts app/api/ml/sync/route.ts .github/
git commit -m "feat(ml): sync resumível de tarifas e frete reais do Mercado Livre"
```

### Task 15: Custo real no cálculo + indicador de cobertura

**Files:**
- Modify: `lib/db/orders.ts` (`getOrdersByPeriod` com LEFT JOIN; `rowToPedido` aplica custo real)
- Create: `components/dashboard/ml-cost-coverage.tsx`
- Modify: `app/(dashboard)/page.tsx` (exibe cobertura)

**Interfaces:**
- Consumes: `mlOrderCosts` (Task 12), campo `Pedido.custoMlReal` (Task 9/Step 1).
- Produces: pedidos do canal ML com `taxaComissao`/`valorFrete` reais e `custoMlReal: true` quando importados.

- [ ] **Step 1: JOIN na leitura** — em `lib/db/orders.ts`:

```ts
import { mlOrderCosts, orders } from "./schema"
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm"

export async function getOrdersByPeriod(dataInicial: string): Promise<Pedido[]> {
  const db = getDb()
  const rows = await db
    .select({ order: orders, mlSaleFee: mlOrderCosts.saleFee, mlShipping: mlOrderCosts.shippingCost })
    .from(orders)
    .leftJoin(mlOrderCosts, eq(mlOrderCosts.olistId, orders.olistId))
    .where(gte(orders.data, dataInicial))
    .orderBy(desc(orders.data))
  return rows.map((r) => rowToPedido(r.order, r.mlSaleFee, r.mlShipping))
}
```

E `rowToPedido` passa a receber os custos reais:

```ts
function rowToPedido(
  r: typeof orders.$inferSelect,
  mlSaleFee?: string | null,
  mlShipping?: string | null,
): Pedido {
  const saleFee = Number(mlSaleFee ?? 0)
  const custoMlReal = saleFee > 0
  return {
    id: r.olistId,
    numeroPedido: r.numeroPedido,
    numeroNF: r.numeroNf,
    sku: r.sku,
    produto: r.produto,
    canal: r.canal,
    vendedor: r.vendedor,
    formaPagamento: normalizarFormaPagamento(r.formaPagamento) as FormaPagamento,
    valorVenda: Number(r.valorVenda),
    // Custo real do ML quando importado; senão valores da Olist (frete 0 no ML).
    valorFrete: custoMlReal ? Number(mlShipping ?? 0) : Number(r.valorFrete),
    devolucao: Number(r.devolucao),
    taxaComissao: custoMlReal ? saleFee : Number(r.taxaComissao),
    custoTotal: Number(r.custoTotal),
    quantidade: Number(r.quantidade),
    statusPagamento: statusPorSituacao(r.situacao, r.statusPagamento as StatusPagamento),
    data: r.data,
    custoMlReal,
  }
}
```

- [ ] **Step 2: Indicador de cobertura** — `components/dashboard/ml-cost-coverage.tsx`:

```tsx
"use client"

import { BadgeCheck } from "lucide-react"
import { useFiltros } from "@/lib/filters"
import { formatPercent } from "@/lib/data"

// Mostra quantos pedidos ML do período têm tarifa/frete REAIS da API do ML.
// Some quando não há pedidos ML no filtro atual.
export function MlCostCoverage() {
  const { pedidosFiltrados } = useFiltros()
  const ml = pedidosFiltrados.filter((p) => p.canal === "Mercado Livre")
  if (!ml.length) return null
  const reais = ml.filter((p) => p.custoMlReal).length
  const cobertura = reais / ml.length

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <BadgeCheck className="size-3.5 text-success" />
      <span>
        Custo ML real em <span className="font-medium text-foreground">{formatPercent(cobertura, 0)}</span> dos
        pedidos do Mercado Livre no período — o restante usa estimativa.
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Exibir na Visão Geral** — em `app/(dashboard)/page.tsx`, logo após `<GlobalFilters />`:

```tsx
      <MlCostCoverage />
```

- [ ] **Step 4: Verificar no preview** — Visão Geral deve mostrar a linha de cobertura; margem de contribuição do ML deve CAIR visivelmente (agora desconta tarifa+frete reais). Comparar o card de M.C. antes/depois e anotar a diferença para o commit.

- [ ] **Step 5: Commit**

```bash
git add lib/db/orders.ts components/dashboard/ml-cost-coverage.tsx "app/(dashboard)/page.tsx"
git commit -m "feat(ml): margem usa tarifa e frete reais do ML com indicador de cobertura"
```

### Task 16: `InfoTooltip` + `KpiCard` com tooltip

**Files:**
- Create: `components/dashboard/info-tooltip.tsx`
- Modify: `components/dashboard/kpi-card.tsx`

**Interfaces:**
- Produces:
  - `InfoTooltip({ texto }: { texto: string })` — ícone ⓘ com tooltip didático.
  - `KpiCard` ganha prop opcional `tooltip?: string`.

- [ ] **Step 1: Criar `components/dashboard/info-tooltip.tsx`**

```tsx
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
```

- [ ] **Step 2: `KpiCard` com tooltip** — em `components/dashboard/kpi-card.tsx`, adicionar à interface `tooltip?: string` e trocar o span do título por:

```tsx
        <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          {titulo}
          {tooltip && <InfoTooltip texto={tooltip} />}
        </span>
```

(com import da `InfoTooltip`; adicionar `tooltip` na desestruturação das props).

- [ ] **Step 3: Aplicar na Visão Geral** — em `app/(dashboard)/page.tsx`, adicionar `tooltip` aos cards usando o catálogo (seção "Catálogo de tooltips" deste plano). Exemplos:

```ts
    { titulo: "Faturamento bruto", tooltip: "Soma do valor de venda de todos os pedidos do período, antes de descontar devoluções, taxas e custos.", ... },
    { titulo: "Margem de contribuição", tooltip: "Quanto sobra da venda depois de descontar custo do produto, frete, devoluções e tarifas do marketplace.", ... },
    { titulo: "Markup médio", tooltip: "Quantas vezes o preço de venda cobre o custo do produto. Markup 2,0x = vendido pelo dobro do custo.", ... },
```

(aplicar a todos os 8 cards com os textos do catálogo).

- [ ] **Step 4: Verificar no preview** — hover no ⓘ mostra o texto; layout dos cards não quebra.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/info-tooltip.tsx components/dashboard/kpi-card.tsx "app/(dashboard)/page.tsx"
git commit -m "feat(ui): tooltips didáticos nos KPIs (InfoTooltip)"
```

### Task 17: Export CSV

**Files:**
- Create: `lib/export-csv.ts`
- Create: `lib/__tests__/export-csv.test.ts`

**Interfaces:**
- Produces:
  - `gerarCsv(linhas: Record<string, string | number>[]): string` (BOM + `;` + CRLF, pt-BR/Excel)
  - `baixarCsv(nomeArquivo: string, linhas: Record<string, string | number>[]): void` (browser)

- [ ] **Step 1: Teste que falha** — `lib/__tests__/export-csv.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { gerarCsv } from "@/lib/export-csv"

describe("gerarCsv", () => {
  it("gera cabeçalho das chaves, separador ; e CRLF com BOM", () => {
    const csv = gerarCsv([
      { SKU: "6103", Faturamento: 100.5 },
      { SKU: "40150693", Faturamento: 200 },
    ])
    expect(csv).toBe("﻿SKU;Faturamento\r\n6103;100,5\r\n40150693;200")
  })
  it("escapa valores com ; aspas e quebras de linha", () => {
    const csv = gerarCsv([{ Produto: 'CABO "X"; especial', N: 1 }])
    expect(csv).toBe('﻿Produto;N\r\n"CABO ""X""; especial";1')
  })
  it("lista vazia gera string vazia", () => {
    expect(gerarCsv([])).toBe("")
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test`

- [ ] **Step 3: Implementar `lib/export-csv.ts`**

```ts
// CSV pt-BR (Excel): BOM UTF-8, separador ; e vírgula decimal.

function celula(valor: string | number): string {
  const texto = typeof valor === "number" ? String(valor).replace(".", ",") : valor
  if (/[";\n\r]/.test(texto)) return `"${texto.replaceAll('"', '""')}"`
  return texto
}

export function gerarCsv(linhas: Record<string, string | number>[]): string {
  if (!linhas.length) return ""
  const colunas = Object.keys(linhas[0])
  const corpo = linhas.map((l) => colunas.map((c) => celula(l[c] ?? "")).join(";"))
  return "﻿" + [colunas.join(";"), ...corpo].join("\r\n")
}

export function baixarCsv(nomeArquivo: string, linhas: Record<string, string | number>[]): void {
  const blob = new Blob([gerarCsv(linhas)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nomeArquivo.endsWith(".csv") ? nomeArquivo : `${nomeArquivo}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm test`

- [ ] **Step 5: Commit**

```bash
git add lib/export-csv.ts lib/__tests__/export-csv.test.ts
git commit -m "feat(export): geração de CSV pt-BR com testes"
```

### Task 18: `DataTable` genérica (TanStack)

**Files:**
- Create: `components/dashboard/data-table.tsx`

**Interfaces:**
- Consumes: `baixarCsv` (Task 17).
- Produces: `DataTable<T>` com props:

```ts
interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  buscaPlaceholder?: string
  csv?: { nome: string; linhas: (rows: T[]) => Record<string, string | number>[] } // habilita botão exportar
  rodape?: (rows: T[]) => ReactNode // totalizadores
  onRowClick?: (row: T) => void
  destacarLinha?: (row: T) => boolean // fundo de alerta
  vazio?: string
}
```

- [ ] **Step 1: Instalar dependência**

```bash
pnpm add @tanstack/react-table
```

- [ ] **Step 2: Implementar `components/dashboard/data-table.tsx`**

```tsx
"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { baixarCsv } from "@/lib/export-csv"
import { cn } from "@/lib/utils"

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[]
  data: T[]
  buscaPlaceholder?: string
  csv?: { nome: string; linhas: (rows: T[]) => Record<string, string | number>[] }
  rodape?: (rows: T[]) => ReactNode
  onRowClick?: (row: T) => void
  destacarLinha?: (row: T) => boolean
  vazio?: string
}

export function DataTable<T>({
  columns,
  data,
  buscaPlaceholder = "Buscar...",
  csv,
  rodape,
  onRowClick,
  destacarLinha,
  vazio = "Nenhum registro para os filtros selecionados.",
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [busca, setBusca] = useState("")

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: busca },
    onSortingChange: setSorting,
    onGlobalFilterChange: setBusca,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  const linhasFiltradas = useMemo(
    () => table.getFilteredRowModel().rows.map((r) => r.original),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.getFilteredRowModel().rows],
  )

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={buscaPlaceholder} className="pl-9" />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {linhasFiltradas.length.toLocaleString("pt-BR")} registros
          </span>
          {csv && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => baixarCsv(csv.nome, csv.linhas(linhasFiltradas))}>
              <Download className="size-3.5" /> CSV
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/40">
                {hg.headers.map((h) => {
                  const podeOrdenar = h.column.getCanSort()
                  const dir = h.column.getIsSorted()
                  return (
                    <TableHead key={h.id}>
                      {podeOrdenar ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-foreground"
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(
                  onRowClick && "cursor-pointer",
                  destacarLinha?.(row.original) && "bg-warning/10 hover:bg-warning/15",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))}
            {!table.getRowModel().rows.length && (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {vazio}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {rodape && linhasFiltradas.length > 0 && (
        <div className="border-t border-border bg-muted/30 px-4 py-3 text-sm">{rodape(linhasFiltradas)}</div>
      )}

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <span className="text-xs text-muted-foreground">
            Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              Anterior
            </Button>
            <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verificar tipos** — `pnpm exec tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/data-table.tsx package.json pnpm-lock.yaml
git commit -m "feat(ui): DataTable genérica com busca, ordenação, paginação e export CSV"
```

### Task 19: Agregação por SKU (`lib/sku-analytics.ts`)

**Files:**
- Create: `lib/sku-analytics.ts`
- Create: `lib/__tests__/sku-analytics.test.ts`

**Interfaces:**
- Consumes: `Pedido`, `ItemPedido`, `taxaComissaoEfetiva` de `lib/data.ts`.
- Produces:

```ts
export type AlertaSku = "sem-custo" | "alta-devolucao" | "margem-baixa"
export const LIMIAR_MARGEM_BAIXA = 0.1
export const LIMIAR_DEVOLUCAO_ALTA = 0.05
export interface LinhaSku {
  sku: string; produto: string; canais: string[]; pedidos: number
  qtdVendida: number; qtdDevolvida: number
  faturamento: number; devolucaoValor: number; faturamentoLiquido: number
  custoTotal: number; taxaAlocada: number; freteAlocado: number
  margemValor: number; margemPct: number; markup: number; ticketMedio: number
  taxaDevolucao: number; semCusto: boolean; alertas: AlertaSku[]
}
export function agregarPorSku(pedidos: Pedido[]): LinhaSku[]
export interface SkuMensal { mes: string; faturamento: number; devolucao: number; margem: number; quantidade: number }
export function skuPorMes(sku: string, pedidos: Pedido[]): SkuMensal[]
```

- [ ] **Step 1: Teste que falha** — `lib/__tests__/sku-analytics.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { agregarPorSku, skuPorMes } from "@/lib/sku-analytics"
import type { Pedido } from "@/lib/data"

function pedido(parcial: Partial<Pedido>): Pedido {
  return {
    id: "1", numeroPedido: "P1", numeroNF: "-", sku: "A", produto: "Prod A",
    canal: "Mercado Livre", vendedor: "Sem vendedor", formaPagamento: "Pix",
    valorVenda: 100, valorFrete: 0, devolucao: 0, taxaComissao: 0, custoTotal: 0,
    quantidade: 1, statusPagamento: "Pago", data: "2026-06-10",
    ...parcial,
  }
}

describe("agregarPorSku", () => {
  it("rateia taxa e frete pelos itens proporcionalmente ao valor", () => {
    const p = pedido({
      valorVenda: 150, taxaComissao: 30, valorFrete: 15, custoTotal: 60,
      itens: [
        { sku: "A", descricao: "Prod A", quantidade: 1, valorUnitario: 100, custoUnitario: 40 },
        { sku: "B", descricao: "Prod B", quantidade: 1, valorUnitario: 50, custoUnitario: 20 },
      ],
    })
    const linhas = agregarPorSku([p])
    const a = linhas.find((l) => l.sku === "A")!
    const b = linhas.find((l) => l.sku === "B")!
    expect(a.faturamento).toBe(100)
    expect(a.taxaAlocada).toBeCloseTo(20) // 100/150 de 30
    expect(a.freteAlocado).toBeCloseTo(10)
    expect(a.margemValor).toBeCloseTo(100 - 40 - 20 - 10)
    expect(b.taxaAlocada).toBeCloseTo(10)
  })
  it("pedido devolvido zera receita líquida do SKU e conta qtdDevolvida", () => {
    const p = pedido({
      devolucao: 100,
      itens: [{ sku: "A", descricao: "Prod A", quantidade: 2, valorUnitario: 50, custoUnitario: 10 }],
    })
    const a = agregarPorSku([p])[0]
    expect(a.devolucaoValor).toBe(100)
    expect(a.faturamentoLiquido).toBe(0)
    expect(a.qtdDevolvida).toBe(2)
    expect(a.alertas).toContain("alta-devolucao")
  })
  it("sem itens usa o pedido como item único (fallback)", () => {
    const a = agregarPorSku([pedido({ custoTotal: 30, quantidade: 2 })])[0]
    expect(a.sku).toBe("A")
    expect(a.qtdVendida).toBe(2)
    expect(a.custoTotal).toBe(30)
  })
  it("marca sem-custo e margem-baixa", () => {
    const linhas = agregarPorSku([
      pedido({ sku: "SC", produto: "Sem custo", custoTotal: 0, itens: [{ sku: "SC", descricao: "Sem custo", quantidade: 1, valorUnitario: 100, custoUnitario: 0 }] }),
      pedido({ id: "2", sku: "MB", produto: "Margem baixa", taxaComissao: 90, itens: [{ sku: "MB", descricao: "Margem baixa", quantidade: 1, valorUnitario: 100, custoUnitario: 5 }] }),
    ])
    expect(linhas.find((l) => l.sku === "SC")!.alertas).toContain("sem-custo")
    expect(linhas.find((l) => l.sku === "MB")!.alertas).toContain("margem-baixa")
  })
})

describe("skuPorMes", () => {
  it("agrupa por yyyy-mm", () => {
    const meses = skuPorMes("A", [
      pedido({ data: "2026-05-10" }),
      pedido({ id: "2", data: "2026-05-20" }),
      pedido({ id: "3", data: "2026-06-01" }),
    ])
    expect(meses.map((m) => m.mes)).toEqual(["2026-05", "2026-06"])
    expect(meses[0].faturamento).toBe(200)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test`

- [ ] **Step 3: Implementar `lib/sku-analytics.ts`**

```ts
import { taxaComissaoEfetiva, type ItemPedido, type Pedido } from "@/lib/data"

// Análise por SKU: cada pedido é rateado entre seus itens proporcionalmente ao
// valor (taxa, frete e devolução seguem a participação do item no pedido).
// Pedidos sem itens carregados usam o próprio pedido como item único.

export type AlertaSku = "sem-custo" | "alta-devolucao" | "margem-baixa"

export const LIMIAR_MARGEM_BAIXA = 0.1
export const LIMIAR_DEVOLUCAO_ALTA = 0.05

export interface LinhaSku {
  sku: string
  produto: string
  canais: string[]
  pedidos: number
  qtdVendida: number
  qtdDevolvida: number
  faturamento: number
  devolucaoValor: number
  faturamentoLiquido: number
  custoTotal: number
  taxaAlocada: number
  freteAlocado: number
  margemValor: number
  margemPct: number
  markup: number
  ticketMedio: number
  taxaDevolucao: number
  semCusto: boolean
  alertas: AlertaSku[]
}

type Acumulador = Omit<LinhaSku, "margemPct" | "markup" | "ticketMedio" | "taxaDevolucao" | "alertas" | "canais" | "semCusto"> & {
  canais: Set<string>
  temVendaSemCusto: boolean
}

function itensDoPedido(p: Pedido): ItemPedido[] {
  if (p.itens?.length) return p.itens
  return [{ sku: p.sku, descricao: p.produto, quantidade: p.quantidade, valorUnitario: p.quantidade ? p.valorVenda / p.quantidade : p.valorVenda, custoUnitario: p.quantidade ? p.custoTotal / p.quantidade : p.custoTotal }]
}

export function agregarPorSku(pedidos: Pedido[]): LinhaSku[] {
  const mapa = new Map<string, Acumulador>()

  for (const p of pedidos) {
    const itens = itensDoPedido(p)
    const totalPedido = itens.reduce((s, i) => s + i.valorUnitario * i.quantidade, 0)
    const taxa = taxaComissaoEfetiva(p)
    const devolvido = p.devolucao > 0

    for (const item of itens) {
      const valorItem = item.valorUnitario * item.quantidade
      const share = totalPedido > 0 ? valorItem / totalPedido : 1 / itens.length
      const acc =
        mapa.get(item.sku) ??
        ({
          sku: item.sku, produto: item.descricao, canais: new Set<string>(), pedidos: 0,
          qtdVendida: 0, qtdDevolvida: 0, faturamento: 0, devolucaoValor: 0, faturamentoLiquido: 0,
          custoTotal: 0, taxaAlocada: 0, freteAlocado: 0, margemValor: 0, temVendaSemCusto: false,
        } as Acumulador)

      const custoItem = item.custoUnitario * item.quantidade
      const devolucaoItem = devolvido ? valorItem : 0

      acc.canais.add(p.canal)
      acc.pedidos += 1
      acc.qtdVendida += item.quantidade
      if (devolvido) acc.qtdDevolvida += item.quantidade
      acc.faturamento += valorItem
      acc.devolucaoValor += devolucaoItem
      acc.custoTotal += custoItem
      acc.taxaAlocada += taxa * share
      acc.freteAlocado += p.valorFrete * share
      acc.margemValor += valorItem - devolucaoItem - custoItem - taxa * share - p.valorFrete * share
      if (valorItem > 0 && custoItem === 0) acc.temVendaSemCusto = true
      mapa.set(item.sku, acc)
    }
  }

  return Array.from(mapa.values())
    .map((acc) => {
      const faturamentoLiquido = acc.faturamento - acc.devolucaoValor
      const margemPct = faturamentoLiquido > 0 ? acc.margemValor / faturamentoLiquido : 0
      const taxaDevolucao = acc.faturamento > 0 ? acc.devolucaoValor / acc.faturamento : 0
      const alertas: AlertaSku[] = []
      if (acc.temVendaSemCusto) alertas.push("sem-custo")
      if (taxaDevolucao > LIMIAR_DEVOLUCAO_ALTA) alertas.push("alta-devolucao")
      if (!acc.temVendaSemCusto && margemPct < LIMIAR_MARGEM_BAIXA) alertas.push("margem-baixa")
      return {
        ...acc,
        canais: Array.from(acc.canais).sort(),
        faturamentoLiquido,
        margemPct,
        markup: acc.custoTotal > 0 ? acc.faturamento / acc.custoTotal : 0,
        ticketMedio: acc.pedidos ? acc.faturamento / acc.pedidos : 0,
        taxaDevolucao,
        semCusto: acc.temVendaSemCusto,
        alertas,
      }
    })
    .sort((a, b) => b.faturamento - a.faturamento)
}

export interface SkuMensal {
  mes: string
  faturamento: number
  devolucao: number
  margem: number
  quantidade: number
}

export function skuPorMes(sku: string, pedidos: Pedido[]): SkuMensal[] {
  const linhasPorMes = new Map<string, SkuMensal>()
  for (const p of pedidos) {
    const itens = itensDoPedido(p).filter((i) => i.sku === sku)
    if (!itens.length) continue
    const totalPedido = itensDoPedido(p).reduce((s, i) => s + i.valorUnitario * i.quantidade, 0)
    const taxa = taxaComissaoEfetiva(p)
    const mes = p.data.slice(0, 7)
    const acc = linhasPorMes.get(mes) ?? { mes, faturamento: 0, devolucao: 0, margem: 0, quantidade: 0 }
    for (const item of itens) {
      const valorItem = item.valorUnitario * item.quantidade
      const share = totalPedido > 0 ? valorItem / totalPedido : 1
      const devolucaoItem = p.devolucao > 0 ? valorItem : 0
      acc.faturamento += valorItem
      acc.devolucao += devolucaoItem
      acc.quantidade += item.quantidade
      acc.margem += valorItem - devolucaoItem - item.custoUnitario * item.quantidade - taxa * share - p.valorFrete * share
    }
    linhasPorMes.set(mes, acc)
  }
  return Array.from(linhasPorMes.values()).sort((a, b) => (a.mes < b.mes ? -1 : 1))
}
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm test`

- [ ] **Step 5: Commit**

```bash
git add lib/sku-analytics.ts lib/__tests__/sku-analytics.test.ts
git commit -m "feat(sku): agregação por SKU com rateio de taxa/frete e alertas"
```

### Task 20: Gráficos de SKU (`sku-charts.tsx`)

**Files:**
- Create: `components/dashboard/sku-charts.tsx`

**Interfaces:**
- Consumes: `LinhaSku` (Task 19).
- Produces: `TopSkusChart({ linhas, titulo, descricao, metrica })` (`metrica: "faturamento" | "devolucaoValor"`) e `MatrizFaturamentoMargemChart({ linhas })`.

- [ ] **Step 1: Implementar**

```tsx
"use client"

import { Bar, BarChart, CartesianGrid, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { formatBRLCompacto, formatPercent } from "@/lib/data"
import type { LinhaSku } from "@/lib/sku-analytics"

const topConfig = {
  valor: { label: "Valor", color: "var(--chart-1)" },
} satisfies ChartConfig

export function TopSkusChart({
  linhas,
  titulo,
  descricao,
  metrica,
}: {
  linhas: LinhaSku[]
  titulo: string
  descricao: string
  metrica: "faturamento" | "devolucaoValor"
}) {
  const dados = [...linhas]
    .sort((a, b) => b[metrica] - a[metrica])
    .slice(0, 10)
    .filter((l) => l[metrica] > 0)
    .map((l) => ({ sku: l.sku, valor: Math.round(l[metrica]), produto: l.produto }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardContent>
        {dados.length === 0 ? (
          <p className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            Sem dados no período selecionado.
          </p>
        ) : (
          <ChartContainer config={topConfig} className="aspect-auto h-[280px] w-full">
            <BarChart data={dados} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
              <YAxis type="category" dataKey="sku" tickLine={false} axisLine={false} width={90} fontSize={11} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.produto ?? ""}
                    formatter={(value) => formatBRLCompacto(Number(value))}
                  />
                }
              />
              <Bar dataKey="valor" fill="var(--color-valor)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

const matrizConfig = {
  ok: { label: "Saudável", color: "var(--chart-1)" },
  alerta: { label: "Com alerta", color: "var(--chart-3)" },
} satisfies ChartConfig

// Matriz faturamento × margem %: canto inferior direito = vende muito com margem
// ruim (prioridade de correção de preço/custo).
export function MatrizFaturamentoMargemChart({ linhas }: { linhas: LinhaSku[] }) {
  const pontos = linhas
    .filter((l) => l.faturamento > 0)
    .map((l) => ({ x: l.faturamento, y: l.margemPct, sku: l.sku, produto: l.produto, alerta: l.alertas.length > 0 }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Matriz faturamento × margem</CardTitle>
        <CardDescription>Cada ponto é um SKU — pontos âmbar têm alerta (sem custo, margem baixa ou alta devolução)</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={matrizConfig} className="aspect-auto h-[300px] w-full">
          <ScatterChart margin={{ left: 8, right: 16, top: 8 }}>
            <CartesianGrid />
            <XAxis type="number" dataKey="x" name="Faturamento" tickLine={false} axisLine={false} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
            <YAxis type="number" dataKey="y" name="Margem %" tickLine={false} axisLine={false} width={52} tickFormatter={(v) => formatPercent(Number(v), 0)} />
            <ZAxis range={[50, 51]} />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.sku ?? ""}
                  formatter={(value, name) => (name === "Margem %" ? formatPercent(Number(value)) : formatBRLCompacto(Number(value)))}
                />
              }
            />
            <Scatter data={pontos.filter((p) => !p.alerta)} fill="var(--color-ok)" />
            <Scatter data={pontos.filter((p) => p.alerta)} fill="var(--color-alerta)" />
          </ScatterChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Verificar tipos** — `pnpm exec tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/sku-charts.tsx
git commit -m "feat(sku): gráficos top SKUs e matriz faturamento × margem"
```

### Task 21: Drawer de detalhe do SKU

**Files:**
- Create: `components/dashboard/sku-drawer.tsx`

**Interfaces:**
- Consumes: `LinhaSku`, `skuPorMes` (Task 19), `InfoTooltip` (Task 16).
- Produces: `SkuDrawer({ linha, pedidos, aberto, onClose }: { linha: LinhaSku | null; pedidos: Pedido[]; aberto: boolean; onClose: () => void })`.

- [ ] **Step 1: Implementar `components/dashboard/sku-drawer.tsx`**

```tsx
"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { InfoTooltip } from "@/components/dashboard/info-tooltip"
import { formatBRL, formatBRLCompacto, formatData, formatMarkup, formatNumero, formatPercent, type Pedido } from "@/lib/data"
import { skuPorMes, type LinhaSku } from "@/lib/sku-analytics"

const ALERTA_LABEL: Record<string, string> = {
  "sem-custo": "Sem custo cadastrado",
  "alta-devolucao": "Alta devolução",
  "margem-baixa": "Margem baixa",
}

const mensalConfig = {
  faturamento: { label: "Faturamento", color: "var(--chart-1)" },
  devolucao: { label: "Devolução", color: "var(--chart-3)" },
} satisfies ChartConfig

export function SkuDrawer({
  linha,
  pedidos,
  aberto,
  onClose,
}: {
  linha: LinhaSku | null
  pedidos: Pedido[]
  aberto: boolean
  onClose: () => void
}) {
  if (!linha) return null

  const meses = skuPorMes(linha.sku, pedidos).map((m) => ({ ...m, label: `${m.mes.slice(5)}/${m.mes.slice(2, 4)}` }))
  const pedidosDoSku = pedidos
    .filter((p) => p.sku === linha.sku || p.itens?.some((i) => i.sku === linha.sku))
    .slice(0, 20)

  const composicao = [
    { rotulo: "Faturamento bruto", valor: linha.faturamento },
    { rotulo: "(−) Devoluções", valor: -linha.devolucaoValor },
    { rotulo: "(−) Custo do produto", valor: -linha.custoTotal },
    { rotulo: "(−) Taxas de marketplace (rateadas)", valor: -linha.taxaAlocada },
    { rotulo: "(−) Frete (rateado)", valor: -linha.freteAlocado },
    { rotulo: "= Margem de contribuição", valor: linha.margemValor },
  ]

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">{linha.sku}</SheetTitle>
          <SheetDescription className="text-pretty">{linha.produto}</SheetDescription>
          <div className="flex flex-wrap gap-1.5">
            {linha.canais.map((c) => (
              <Badge key={c} variant="secondary">{c}</Badge>
            ))}
            {linha.alertas.map((a) => (
              <Badge key={a} variant="outline" className="border-warning/50 bg-warning/10 text-warning-foreground">
                {ALERTA_LABEL[a]}
              </Badge>
            ))}
          </div>
        </SheetHeader>

        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3">
          <Metrica rotulo="Faturamento" valor={formatBRL(linha.faturamento)} />
          <Metrica rotulo="Margem" valor={formatBRL(linha.margemValor)} />
          <Metrica rotulo="Margem %" valor={formatPercent(linha.margemPct)} />
          <Metrica rotulo="Qtd. vendida" valor={formatNumero(linha.qtdVendida)} />
          <Metrica rotulo="Qtd. devolvida" valor={formatNumero(linha.qtdDevolvida)} />
          <Metrica rotulo="Markup" valor={formatMarkup(linha.markup)} />
        </div>

        <Separator className="my-2" />

        <div className="px-4">
          <h3 className="mb-2 text-sm font-semibold">Vendas × devoluções por mês</h3>
          {meses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem histórico no período carregado.</p>
          ) : (
            <ChartContainer config={mensalConfig} className="aspect-auto h-[180px] w-full">
              <BarChart data={meses}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
                <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatBRLCompacto(Number(v))} />} />
                <Bar dataKey="faturamento" fill="var(--color-faturamento)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="devolucao" fill="var(--color-devolucao)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </div>

        <Separator className="my-2" />

        <div className="px-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            Composição do cálculo
            <InfoTooltip texto="Taxas e frete são rateados entre os itens de cada pedido proporcionalmente ao valor. Pedidos sem custo cadastrado entram com custo 0 (margem otimista)." />
          </h3>
          <div className="rounded-lg border border-border">
            {composicao.map((c, i) => (
              <div
                key={c.rotulo}
                className={`flex items-center justify-between px-3 py-2 text-sm ${i === composicao.length - 1 ? "bg-muted/40 font-semibold" : ""} ${i > 0 ? "border-t border-border" : ""}`}
              >
                <span className="text-muted-foreground">{c.rotulo}</span>
                <span className="tabular-nums">{formatBRL(c.valor)}</span>
              </div>
            ))}
          </div>
        </div>

        <Separator className="my-2" />

        <div className="px-4 pb-6">
          <h3 className="mb-2 text-sm font-semibold">Pedidos recentes com este SKU</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Canal</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidosDoSku.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.numeroPedido}</TableCell>
                  <TableCell className="text-muted-foreground">{formatData(p.data)}</TableCell>
                  <TableCell className="text-muted-foreground">{p.canal}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(p.valorVenda)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Metrica({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="text-sm font-semibold tabular-nums">{valor}</div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos** — `pnpm exec tsc --noEmit`.

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/sku-drawer.tsx
git commit -m "feat(sku): drawer de detalhe do SKU com histórico e composição da margem"
```

### Task 22: Página `/produtos` + item na sidebar

**Files:**
- Create: `app/(dashboard)/produtos/page.tsx`
- Modify: `components/dashboard/app-sidebar.tsx`

**Interfaces:**
- Consumes: `agregarPorSku`/`LinhaSku` (Task 19), `TopSkusChart`/`MatrizFaturamentoMargemChart` (Task 20), `SkuDrawer` (Task 21), `DataTable` (Task 18), `KpiCard` (Task 16).

- [ ] **Step 1: Sidebar** — em `components/dashboard/app-sidebar.tsx`, adicionar ao array `itens` (após "Canais e Vendedores") com import de `Package` do lucide:

```ts
  { titulo: "Produtos e SKUs", href: "/produtos", icone: Package },
```

- [ ] **Step 2: Criar `app/(dashboard)/produtos/page.tsx`**

```tsx
"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Boxes, PackageX, Percent, Trophy } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { PageTitle } from "@/components/dashboard/page-title"
import { GlobalFilters } from "@/components/dashboard/global-filters"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { DataTable } from "@/components/dashboard/data-table"
import { SkuDrawer } from "@/components/dashboard/sku-drawer"
import { MatrizFaturamentoMargemChart, TopSkusChart } from "@/components/dashboard/sku-charts"
import { useFiltros } from "@/lib/filters"
import { agregarPorSku, type LinhaSku } from "@/lib/sku-analytics"
import { formatBRL, formatMarkup, formatNumero, formatPercent } from "@/lib/data"

const ALERTA_CURTO: Record<string, string> = {
  "sem-custo": "Sem custo",
  "alta-devolucao": "Devolução",
  "margem-baixa": "Margem",
}

export default function ProdutosPage() {
  const { pedidosFiltrados } = useFiltros()
  const linhas = useMemo(() => agregarPorSku(pedidosFiltrados), [pedidosFiltrados])
  const [selecionado, setSelecionado] = useState<LinhaSku | null>(null)

  const skusDevolvidos = linhas.filter((l) => l.qtdDevolvida > 0)
  const semCusto = linhas.filter((l) => l.semCusto)
  const topFat = linhas[0]
  const topQtd = [...linhas].sort((a, b) => b.qtdVendida - a.qtdVendida)[0]
  const topMargem = [...linhas].sort((a, b) => b.margemValor - a.margemValor)[0]
  const topDev = [...skusDevolvidos].sort((a, b) => b.devolucaoValor - a.devolucaoValor)[0]
  const taxaMediaDev = linhas.length
    ? linhas.reduce((s, l) => s + l.devolucaoValor, 0) / Math.max(1, linhas.reduce((s, l) => s + l.faturamento, 0))
    : 0

  const cards = [
    { titulo: "SKUs vendidos", valor: formatNumero(linhas.length), icone: Boxes, destaque: "default" as const, tooltip: "Quantos códigos de produto diferentes tiveram venda no período." },
    { titulo: "SKUs com devolução", valor: formatNumero(skusDevolvidos.length), icone: PackageX, destaque: "alerta" as const, tooltip: "Quantos códigos de produto diferentes apareceram em devoluções no período." },
    { titulo: "SKUs sem custo", valor: formatNumero(semCusto.length), icone: AlertTriangle, destaque: "alerta" as const, tooltip: "Pedidos sem custo de produto cadastrado na Olist. A margem fica otimista nesses casos." },
    { titulo: "Taxa média de devolução", valor: formatPercent(taxaMediaDev), icone: Percent, destaque: "default" as const, tooltip: "Percentual do faturamento que voltou como devolução. Quanto maior, maior o impacto no resultado." },
    { titulo: "Top faturamento", valor: topFat?.sku ?? "—", icone: Trophy, destaque: "positivo" as const, legenda: topFat ? formatBRL(topFat.faturamento) : undefined },
    { titulo: "Top quantidade", valor: topQtd?.sku ?? "—", icone: Trophy, destaque: "default" as const, legenda: topQtd ? `${formatNumero(topQtd.qtdVendida)} un.` : undefined },
    { titulo: "Top margem", valor: topMargem?.sku ?? "—", icone: Trophy, destaque: "positivo" as const, legenda: topMargem ? formatBRL(topMargem.margemValor) : undefined },
    { titulo: "Top devolução", valor: topDev?.sku ?? "—", icone: Trophy, destaque: "alerta" as const, legenda: topDev ? formatBRL(topDev.devolucaoValor) : undefined },
  ]

  const colunas: ColumnDef<LinhaSku, unknown>[] = [
    { accessorKey: "sku", header: "SKU", cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span> },
    { accessorKey: "produto", header: "Produto", cell: ({ row }) => <span className="block max-w-56 truncate">{row.original.produto}</span> },
    { accessorKey: "qtdVendida", header: "Qtd", cell: ({ row }) => <span className="tabular-nums">{formatNumero(row.original.qtdVendida)}</span> },
    { accessorKey: "qtdDevolvida", header: "Qtd dev.", cell: ({ row }) => <span className="tabular-nums">{row.original.qtdDevolvida || "—"}</span> },
    { accessorKey: "faturamento", header: "Faturamento", cell: ({ row }) => <span className="tabular-nums font-medium">{formatBRL(row.original.faturamento)}</span> },
    { accessorKey: "devolucaoValor", header: "Devolução", cell: ({ row }) => <span className="tabular-nums">{row.original.devolucaoValor ? formatBRL(row.original.devolucaoValor) : "—"}</span> },
    { accessorKey: "margemValor", header: "Margem R$", cell: ({ row }) => <span className="tabular-nums font-medium">{formatBRL(row.original.margemValor)}</span> },
    { accessorKey: "margemPct", header: "Margem %", cell: ({ row }) => <span className="tabular-nums">{formatPercent(row.original.margemPct)}</span> },
    { accessorKey: "markup", header: "Markup", cell: ({ row }) => <span className="tabular-nums">{formatMarkup(row.original.markup)}</span> },
    { accessorKey: "pedidos", header: "Pedidos", cell: ({ row }) => <span className="tabular-nums">{formatNumero(row.original.pedidos)}</span> },
    {
      id: "alertas",
      header: "Alertas",
      cell: ({ row }) =>
        row.original.alertas.length ? (
          <div className="flex gap-1">
            {row.original.alertas.map((a) => (
              <Badge key={a} variant="outline" className="border-warning/50 bg-warning/10 text-[10px] text-warning-foreground">
                {ALERTA_CURTO[a]}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  return (
    <>
      <PageTitle
        titulo="Produtos e SKUs"
        descricao="Venda, devolução e margem por SKU — clique em uma linha para abrir o detalhe."
      />
      <GlobalFilters />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <KpiCard key={c.titulo} {...c} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TopSkusChart linhas={linhas} titulo="Top SKUs por faturamento" descricao="10 maiores no período" metrica="faturamento" />
        <TopSkusChart linhas={linhas} titulo="Top SKUs devolvidos" descricao="10 maiores valores devolvidos" metrica="devolucaoValor" />
      </section>

      <MatrizFaturamentoMargemChart linhas={linhas} />

      <Card className="gap-0 overflow-hidden p-0">
        <DataTable
          columns={colunas}
          data={linhas}
          buscaPlaceholder="Buscar SKU ou produto"
          onRowClick={setSelecionado}
          destacarLinha={(l) => l.alertas.length > 0}
          vazio="Nenhum SKU no período/filtros selecionados."
          csv={{
            nome: "produtos-skus",
            linhas: (rows) =>
              rows.map((l) => ({
                SKU: l.sku, Produto: l.produto, Canais: l.canais.join(", "),
                "Qtd vendida": l.qtdVendida, "Qtd devolvida": l.qtdDevolvida, Pedidos: l.pedidos,
                Faturamento: l.faturamento, "Devolução R$": l.devolucaoValor, "Faturamento líquido": l.faturamentoLiquido,
                Custo: l.custoTotal, "Taxas rateadas": l.taxaAlocada, "Frete rateado": l.freteAlocado,
                "Margem R$": l.margemValor, "Margem %": l.margemPct, Markup: l.markup,
                "Ticket médio": l.ticketMedio, "Taxa devolução": l.taxaDevolucao,
                Alertas: l.alertas.join("|"),
              })),
          }}
          rodape={(rows) => (
            <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2">
              <span className="text-muted-foreground">
                SKUs: <span className="font-semibold text-foreground">{formatNumero(rows.length)}</span>
              </span>
              <span className="text-muted-foreground">
                Faturamento: <span className="font-semibold text-foreground tabular-nums">{formatBRL(rows.reduce((s, l) => s + l.faturamento, 0))}</span>
              </span>
              <span className="text-muted-foreground">
                Margem: <span className="font-semibold text-foreground tabular-nums">{formatBRL(rows.reduce((s, l) => s + l.margemValor, 0))}</span>
              </span>
            </div>
          )}
        />
      </Card>

      <SkuDrawer linha={selecionado} pedidos={pedidosFiltrados} aberto={Boolean(selecionado)} onClose={() => setSelecionado(null)} />
    </>
  )
}
```

- [ ] **Step 3: Verificar no preview** — abrir `/produtos`: 8 cards coerentes, gráficos com dados, tabela ordenável/buscável, clique abre drawer, CSV baixa, linhas com alerta destacadas. Testar mobile (`preview_resize` 375px): cards 2 colunas, tabela com scroll horizontal, drawer full-width.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/produtos/page.tsx" components/dashboard/app-sidebar.tsx
git commit -m "feat(produtos): página Produtos e SKUs com KPIs, gráficos, tabela avançada e drawer"
```

### Task 23: Agregações de devolução (`lib/devolucao-analytics.ts`)

**Files:**
- Create: `lib/devolucao-analytics.ts`
- Create: `lib/__tests__/devolucao-analytics.test.ts`

**Interfaces:**
- Consumes: `Pedido` de `lib/data.ts`.
- Produces:

```ts
export interface KpisDevolucao { pedidosDevolvidos: number; itensDevolvidos: number; skusDevolvidos: number; valorDevolvido: number; taxaDevolucao: number; ticketMedioDevolucao: number }
export function calcularKpisDevolucao(pedidos: Pedido[]): KpisDevolucao
export interface DevolucaoMensal { mes: string; valorDevolvido: number; faturamento: number; taxa: number }
export function devolucaoPorMes(pedidos: Pedido[]): DevolucaoMensal[]
export interface DevolucaoCanal { canal: string; pedidos: number; valorDevolvido: number; taxa: number }
export function devolucaoPorCanal(pedidos: Pedido[]): DevolucaoCanal[]
```

- [ ] **Step 1: Teste que falha** — `lib/__tests__/devolucao-analytics.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { calcularKpisDevolucao, devolucaoPorCanal, devolucaoPorMes } from "@/lib/devolucao-analytics"
import type { Pedido } from "@/lib/data"

function pedido(parcial: Partial<Pedido>): Pedido {
  return {
    id: "1", numeroPedido: "P1", numeroNF: "-", sku: "A", produto: "Prod A",
    canal: "Mercado Livre", vendedor: "Sem vendedor", formaPagamento: "Pix",
    valorVenda: 100, valorFrete: 0, devolucao: 0, taxaComissao: 0, custoTotal: 0,
    quantidade: 1, statusPagamento: "Pago", data: "2026-06-10",
    ...parcial,
  }
}

const PEDIDOS = [
  pedido({}),
  pedido({ id: "2", devolucao: 100, quantidade: 2, data: "2026-06-15" }),
  pedido({ id: "3", devolucao: 50, valorVenda: 50, sku: "B", canal: "Olist ERP", data: "2026-05-02" }),
]

describe("calcularKpisDevolucao", () => {
  it("conta pedidos, itens, SKUs e valores devolvidos", () => {
    const k = calcularKpisDevolucao(PEDIDOS)
    expect(k.pedidosDevolvidos).toBe(2)
    expect(k.itensDevolvidos).toBe(3) // 2 + 1
    expect(k.skusDevolvidos).toBe(2) // A e B
    expect(k.valorDevolvido).toBe(150)
    expect(k.taxaDevolucao).toBeCloseTo(150 / 250)
    expect(k.ticketMedioDevolucao).toBe(75)
  })
})

describe("devolucaoPorMes", () => {
  it("agrupa por mês com taxa sobre o faturamento do mês", () => {
    const meses = devolucaoPorMes(PEDIDOS)
    expect(meses).toEqual([
      { mes: "2026-05", valorDevolvido: 50, faturamento: 50, taxa: 1 },
      { mes: "2026-06", valorDevolvido: 100, faturamento: 200, taxa: 0.5 },
    ])
  })
})

describe("devolucaoPorCanal", () => {
  it("agrupa por canal ordenando por valor devolvido", () => {
    const canais = devolucaoPorCanal(PEDIDOS)
    expect(canais[0]).toEqual({ canal: "Mercado Livre", pedidos: 1, valorDevolvido: 100, taxa: 0.5 })
    expect(canais[1].canal).toBe("Olist ERP")
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test`

- [ ] **Step 3: Implementar `lib/devolucao-analytics.ts`**

```ts
import type { Pedido } from "@/lib/data"

// Devolução = pedido cancelado na Olist (total). O valor cai no mês do PEDIDO,
// não no mês do cancelamento — não temos a data da devolução na fonte.

export interface KpisDevolucao {
  pedidosDevolvidos: number
  itensDevolvidos: number
  skusDevolvidos: number
  valorDevolvido: number
  taxaDevolucao: number
  ticketMedioDevolucao: number
}

export function calcularKpisDevolucao(pedidos: Pedido[]): KpisDevolucao {
  const devolvidos = pedidos.filter((p) => p.devolucao > 0)
  const skus = new Set<string>()
  let itens = 0
  for (const p of devolvidos) {
    itens += Math.max(1, p.quantidade)
    if (p.itens?.length) for (const i of p.itens) skus.add(i.sku)
    else skus.add(p.sku)
  }
  const valorDevolvido = devolvidos.reduce((s, p) => s + p.devolucao, 0)
  const faturamento = pedidos.reduce((s, p) => s + p.valorVenda, 0)
  return {
    pedidosDevolvidos: devolvidos.length,
    itensDevolvidos: itens,
    skusDevolvidos: skus.size,
    valorDevolvido,
    taxaDevolucao: faturamento > 0 ? valorDevolvido / faturamento : 0,
    ticketMedioDevolucao: devolvidos.length ? valorDevolvido / devolvidos.length : 0,
  }
}

export interface DevolucaoMensal {
  mes: string
  valorDevolvido: number
  faturamento: number
  taxa: number
}

export function devolucaoPorMes(pedidos: Pedido[]): DevolucaoMensal[] {
  const mapa = new Map<string, DevolucaoMensal>()
  for (const p of pedidos) {
    const mes = p.data.slice(0, 7)
    const acc = mapa.get(mes) ?? { mes, valorDevolvido: 0, faturamento: 0, taxa: 0 }
    acc.valorDevolvido += p.devolucao
    acc.faturamento += p.valorVenda
    mapa.set(mes, acc)
  }
  return Array.from(mapa.values())
    .map((m) => ({ ...m, taxa: m.faturamento > 0 ? m.valorDevolvido / m.faturamento : 0 }))
    .sort((a, b) => (a.mes < b.mes ? -1 : 1))
}

export interface DevolucaoCanal {
  canal: string
  pedidos: number
  valorDevolvido: number
  taxa: number
}

export function devolucaoPorCanal(pedidos: Pedido[]): DevolucaoCanal[] {
  const mapa = new Map<string, { canal: string; pedidos: number; valorDevolvido: number; faturamento: number }>()
  for (const p of pedidos) {
    const acc = mapa.get(p.canal) ?? { canal: p.canal, pedidos: 0, valorDevolvido: 0, faturamento: 0 }
    if (p.devolucao > 0) {
      acc.pedidos += 1
      acc.valorDevolvido += p.devolucao
    }
    acc.faturamento += p.valorVenda
    mapa.set(p.canal, acc)
  }
  return Array.from(mapa.values())
    .filter((c) => c.valorDevolvido > 0)
    .map(({ faturamento, ...c }) => ({ ...c, taxa: faturamento > 0 ? c.valorDevolvido / faturamento : 0 }))
    .sort((a, b) => b.valorDevolvido - a.valorDevolvido)
}
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm test`

- [ ] **Step 5: Commit**

```bash
git add lib/devolucao-analytics.ts lib/__tests__/devolucao-analytics.test.ts
git commit -m "feat(devolucoes): agregações de devolução (KPIs, mensal, por canal)"
```

### Task 24: Gráficos de devolução + drawer de pedido

**Files:**
- Create: `components/dashboard/devolucao-charts.tsx`
- Create: `components/dashboard/pedido-drawer.tsx`

**Interfaces:**
- Consumes: `DevolucaoMensal`/`DevolucaoCanal` (Task 23), `lucroBrutoPedido`/`taxaComissaoEfetiva` de `lib/data.ts`.
- Produces: `DevolucaoMensalChart({ meses })`, `DevolucaoPorCanalChart({ canais })`, `PedidoDrawer({ pedido, aberto, onClose })`.

- [ ] **Step 1: Criar `components/dashboard/devolucao-charts.tsx`**

```tsx
"use client"

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis, BarChart } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { formatBRLCompacto, formatPercent } from "@/lib/data"
import type { DevolucaoCanal, DevolucaoMensal } from "@/lib/devolucao-analytics"

const mensalConfig = {
  valorDevolvido: { label: "Valor devolvido", color: "var(--chart-3)" },
  taxa: { label: "Taxa de devolução", color: "var(--chart-5)" },
} satisfies ChartConfig

export function DevolucaoMensalChart({ meses }: { meses: DevolucaoMensal[] }) {
  const dados = meses.map((m) => ({ ...m, label: `${m.mes.slice(5)}/${m.mes.slice(2, 4)}` }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Devoluções por mês</CardTitle>
        <CardDescription>Valor devolvido (barras) e taxa sobre o faturamento (linha)</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={mensalConfig} className="aspect-auto h-[280px] w-full">
          <ComposedChart data={dados} margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
            <YAxis yAxisId="valor" tickLine={false} axisLine={false} width={56} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
            <YAxis yAxisId="taxa" orientation="right" tickLine={false} axisLine={false} width={44} tickFormatter={(v) => formatPercent(Number(v), 0)} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) =>
                    name === "taxa" ? formatPercent(Number(value)) : formatBRLCompacto(Number(value))
                  }
                />
              }
            />
            <Bar yAxisId="valor" dataKey="valorDevolvido" fill="var(--color-valorDevolvido)" radius={[4, 4, 0, 0]} />
            <Line yAxisId="taxa" dataKey="taxa" stroke="var(--color-taxa)" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

const canalConfig = {
  valorDevolvido: { label: "Valor devolvido", color: "var(--chart-3)" },
} satisfies ChartConfig

export function DevolucaoPorCanalChart({ canais }: { canais: DevolucaoCanal[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Devoluções por canal</CardTitle>
        <CardDescription>Valor devolvido no período por canal de venda</CardDescription>
      </CardHeader>
      <CardContent>
        {canais.length === 0 ? (
          <p className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            Nenhuma devolução no período — bom sinal 👍
          </p>
        ) : (
          <ChartContainer config={canalConfig} className="aspect-auto h-[280px] w-full">
            <BarChart data={canais} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="canal" tickLine={false} axisLine={false} fontSize={11} interval={0} />
              <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v) => formatBRLCompacto(Number(v))} />
              <ChartTooltip content={<ChartTooltipContent formatter={(v) => formatBRLCompacto(Number(v))} />} />
              <Bar dataKey="valorDevolvido" fill="var(--color-valorDevolvido)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Criar `components/dashboard/pedido-drawer.tsx`**

```tsx
"use client"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusPagamentoBadge } from "@/components/dashboard/badges"
import { InfoTooltip } from "@/components/dashboard/info-tooltip"
import {
  formatBRL,
  formatData,
  formatNumero,
  lucroBrutoPedido,
  taxaComissaoEfetiva,
  type Pedido,
} from "@/lib/data"

export function PedidoDrawer({
  pedido,
  aberto,
  onClose,
}: {
  pedido: Pedido | null
  aberto: boolean
  onClose: () => void
}) {
  if (!pedido) return null

  const taxa = taxaComissaoEfetiva(pedido)
  const composicao = [
    { rotulo: "Valor da venda", valor: pedido.valorVenda },
    { rotulo: "(−) Devolução", valor: -pedido.devolucao },
    { rotulo: "(−) Custo do produto", valor: -pedido.custoTotal },
    { rotulo: `(−) Taxa marketplace${pedido.custoMlReal ? " (real ML)" : " (estimada)"}`, valor: -taxa },
    { rotulo: `(−) Frete${pedido.custoMlReal ? " (real ML)" : ""}`, valor: -pedido.valorFrete },
    { rotulo: "= Margem de contribuição", valor: lucroBrutoPedido(pedido) },
  ]

  return (
    <Sheet open={aberto} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Pedido {pedido.numeroPedido}</SheetTitle>
          <SheetDescription>
            {formatData(pedido.data)} · {pedido.canal} · {pedido.vendedor}
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPagamentoBadge status={pedido.statusPagamento} />
            {pedido.numeroNF !== "-" && <Badge variant="secondary">NF {pedido.numeroNF}</Badge>}
            {pedido.devolucao > 0 && (
              <Badge variant="outline" className="border-destructive/50 bg-destructive/10 text-destructive">
                Devolvido
              </Badge>
            )}
          </div>
        </SheetHeader>

        <div className="px-4">
          <h3 className="mb-2 text-sm font-semibold">Itens</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Valor un.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(pedido.itens?.length ? pedido.itens : [{ sku: pedido.sku, descricao: pedido.produto, quantidade: pedido.quantidade, valorUnitario: pedido.valorVenda / Math.max(1, pedido.quantidade), custoUnitario: 0 }]).map((item, i) => (
                <TableRow key={`${item.sku}:${i}`}>
                  <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                  <TableCell className="max-w-48 truncate">{item.descricao}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumero(item.quantidade)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(item.valorUnitario)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Separator className="my-2" />

        <div className="px-4 pb-6">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            Composição da margem
            {pedido.devolucao > 0 && (
              <InfoTooltip texto="Em pedidos devolvidos, a tarifa e o frete podem ter sido reembolsados pelo Mercado Livre — a margem aqui é o cenário mais conservador." />
            )}
          </h3>
          <div className="rounded-lg border border-border">
            {composicao.map((c, i) => (
              <div
                key={c.rotulo}
                className={`flex items-center justify-between px-3 py-2 text-sm ${i === composicao.length - 1 ? "bg-muted/40 font-semibold" : ""} ${i > 0 ? "border-t border-border" : ""}`}
              >
                <span className="text-muted-foreground">{c.rotulo}</span>
                <span className="tabular-nums">{formatBRL(c.valor)}</span>
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 3: Verificar tipos** — `pnpm exec tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/devolucao-charts.tsx components/dashboard/pedido-drawer.tsx
git commit -m "feat(devolucoes): gráficos de devolução e drawer de detalhe do pedido"
```

### Task 25: Página `/devolucoes` + sidebar + roadmap

**Files:**
- Create: `app/(dashboard)/devolucoes/page.tsx`
- Modify: `components/dashboard/app-sidebar.tsx`
- Modify: `docs/12-execution-roadmap.md`

**Interfaces:**
- Consumes: Tasks 23–24, `DataTable` (18), `TopSkusChart` (20), `agregarPorSku` (19), `KpiCard` (16).

- [ ] **Step 1: Sidebar** — adicionar em `itens` (após "Produtos e SKUs"), com import de `Undo2`:

```ts
  { titulo: "Devoluções", href: "/devolucoes", icone: Undo2 },
```

- [ ] **Step 2: Criar `app/(dashboard)/devolucoes/page.tsx`**

```tsx
"use client"

import { useMemo, useState } from "react"
import { Boxes, PackageX, Receipt, RotateCcw, Undo2, Percent } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { Card } from "@/components/ui/card"
import { PageTitle } from "@/components/dashboard/page-title"
import { GlobalFilters } from "@/components/dashboard/global-filters"
import { KpiCard } from "@/components/dashboard/kpi-card"
import { DataTable } from "@/components/dashboard/data-table"
import { PedidoDrawer } from "@/components/dashboard/pedido-drawer"
import { DevolucaoMensalChart, DevolucaoPorCanalChart } from "@/components/dashboard/devolucao-charts"
import { TopSkusChart } from "@/components/dashboard/sku-charts"
import { useFiltros } from "@/lib/filters"
import { agregarPorSku } from "@/lib/sku-analytics"
import { calcularKpisDevolucao, devolucaoPorCanal, devolucaoPorMes } from "@/lib/devolucao-analytics"
import { formatBRL, formatData, formatNumero, formatPercent, type Pedido } from "@/lib/data"

export default function DevolucoesPage() {
  const { pedidosFiltrados } = useFiltros()
  const kpis = useMemo(() => calcularKpisDevolucao(pedidosFiltrados), [pedidosFiltrados])
  const meses = useMemo(() => devolucaoPorMes(pedidosFiltrados), [pedidosFiltrados])
  const canais = useMemo(() => devolucaoPorCanal(pedidosFiltrados), [pedidosFiltrados])
  const linhasSku = useMemo(() => agregarPorSku(pedidosFiltrados), [pedidosFiltrados])
  const devolvidos = useMemo(() => pedidosFiltrados.filter((p) => p.devolucao > 0), [pedidosFiltrados])
  const [selecionado, setSelecionado] = useState<Pedido | null>(null)

  const cards = [
    { titulo: "Devoluções", valor: formatNumero(kpis.pedidosDevolvidos), icone: Undo2, destaque: "alerta" as const, tooltip: "Pedido cancelado na Olist conta como devolução total. O valor aparece no mês da venda original, não no mês do cancelamento." },
    { titulo: "Itens devolvidos", valor: formatNumero(kpis.itensDevolvidos), icone: PackageX, destaque: "default" as const, tooltip: "Quantidade total de unidades nos pedidos devolvidos. Um pedido pode ter mais de um item." },
    { titulo: "SKUs devolvidos", valor: formatNumero(kpis.skusDevolvidos), icone: Boxes, destaque: "default" as const, tooltip: "Quantos códigos de produto diferentes apareceram em devoluções no período." },
    { titulo: "Valor devolvido", valor: formatBRL(kpis.valorDevolvido), icone: RotateCcw, destaque: "alerta" as const, tooltip: "Soma do valor dos pedidos devolvidos no período." },
    { titulo: "Taxa de devolução", valor: formatPercent(kpis.taxaDevolucao), icone: Percent, destaque: "alerta" as const, tooltip: "Percentual do faturamento que voltou como devolução. Quanto maior, maior o impacto no resultado." },
    { titulo: "Ticket médio devolvido", valor: formatBRL(kpis.ticketMedioDevolucao), icone: Receipt, destaque: "default" as const, tooltip: "Valor médio por pedido devolvido no período." },
  ]

  const colunas: ColumnDef<Pedido, unknown>[] = [
    { accessorKey: "data", header: "Data", cell: ({ row }) => <span className="tabular-nums">{formatData(row.original.data)}</span> },
    { accessorKey: "numeroPedido", header: "Pedido", cell: ({ row }) => <span className="font-medium">{row.original.numeroPedido}</span> },
    { accessorKey: "numeroNF", header: "NF", cell: ({ row }) => <span className="text-muted-foreground">{row.original.numeroNF}</span> },
    { accessorKey: "canal", header: "Canal" },
    { accessorKey: "vendedor", header: "Vendedor", cell: ({ row }) => <span className="text-muted-foreground">{row.original.vendedor}</span> },
    { accessorKey: "produto", header: "Produto", cell: ({ row }) => <span className="block max-w-56 truncate">{row.original.produto}</span> },
    { accessorKey: "quantidade", header: "Itens", cell: ({ row }) => <span className="tabular-nums">{formatNumero(row.original.quantidade)}</span> },
    { accessorKey: "devolucao", header: "Valor devolvido", cell: ({ row }) => <span className="tabular-nums font-medium text-destructive">{formatBRL(row.original.devolucao)}</span> },
  ]

  return (
    <>
      <PageTitle
        titulo="Devoluções"
        descricao="Impacto das devoluções por mês, canal e SKU — clique em um pedido para ver o detalhe."
      />
      <GlobalFilters />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((c) => (
          <KpiCard key={c.titulo} {...c} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DevolucaoMensalChart meses={meses} />
        <DevolucaoPorCanalChart canais={canais} />
      </section>

      <TopSkusChart linhas={linhasSku} titulo="Top SKUs devolvidos" descricao="10 maiores valores devolvidos no período" metrica="devolucaoValor" />

      <Card className="gap-0 overflow-hidden p-0">
        <DataTable
          columns={colunas}
          data={devolvidos}
          buscaPlaceholder="Buscar pedido, NF, produto..."
          onRowClick={setSelecionado}
          vazio="Nenhuma devolução no período — bom sinal 👍"
          csv={{
            nome: "devolucoes",
            linhas: (rows) =>
              rows.map((p) => ({
                Data: p.data, Pedido: p.numeroPedido, NF: p.numeroNF, Canal: p.canal,
                Vendedor: p.vendedor, Produto: p.produto, SKU: p.sku,
                Itens: p.quantidade, "Valor vendido": p.valorVenda, "Valor devolvido": p.devolucao,
              })),
          }}
          rodape={(rows) => (
            <div className="flex flex-wrap items-center justify-end gap-x-8 gap-y-2">
              <span className="text-muted-foreground">
                Pedidos: <span className="font-semibold text-foreground">{formatNumero(rows.length)}</span>
              </span>
              <span className="text-muted-foreground">
                Valor devolvido: <span className="font-semibold text-foreground tabular-nums">{formatBRL(rows.reduce((s, p) => s + p.devolucao, 0))}</span>
              </span>
            </div>
          )}
        />
      </Card>

      <PedidoDrawer pedido={selecionado} aberto={Boolean(selecionado)} onClose={() => setSelecionado(null)} />
    </>
  )
}
```

- [ ] **Step 3: Atualizar `docs/12-execution-roadmap.md`** — substituir o conteúdo por um resumo do estado atual (Fase 1 implementada: custo real ML, order_items, páginas Produtos/SKUs e Devoluções) e apontar para este plano.

- [ ] **Step 4: Verificar no preview** — `/devolucoes` com dados reais; drawer abre; CSV baixa; estado vazio aparece ao filtrar um SKU sem devolução.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/devolucoes/page.tsx" components/dashboard/app-sidebar.tsx docs/12-execution-roadmap.md
git commit -m "feat(devolucoes): página de devoluções com KPIs, gráficos e tabela analítica"
```

### Task 26: Verificação final

- [ ] **Step 1: Suite completa**

```bash
pnpm test && pnpm exec tsc --noEmit && pnpm build
```

Expected: testes verdes, sem erros de tipo, build ok.

- [ ] **Step 2: Walkthrough no preview** — percorrer as 6 páginas (Visão Geral, Pedidos, Canais, Produtos, Curva ABC, Devoluções) em desktop e mobile (375px), light e dark. Checar: variações reais, cobertura ML, tooltips, drawers, CSVs, estados vazios, console sem erros.

- [ ] **Step 3: Conferir dados de produção** — comparar o card "Margem de contribuição" antes/depois do custo real ML (esperado: queda visível no canal ML) e a taxa de devolução (~6% do faturamento, coerente com os 168 pedidos/R$ 47,8k já observados).

- [ ] **Step 4: Push + deploy**

```bash
git push origin main
```

Vercel faz deploy (migrações rodam via `vercel-build`). Depois do deploy: rodar `/api/olist/backfill-items` e `/api/ml/sync` em produção até `remaining: 0` e **rotacionar o ML_CLIENT_SECRET** no painel de desenvolvedores do Mercado Livre, atualizando a env na Vercel.

### Task 27: Média de pedidos/dia e gráfico de volume diário na Visão Geral

**Files:**
- Modify: `lib/data.ts` (nova função `mediaPedidosPorDia`, `PontoDiario` ganha `pedidos`)
- Modify: `lib/filters.tsx` (expõe `rangeAtual` no contexto)
- Modify: `components/dashboard/overview-charts.tsx` (novo `PedidosPorDiaChart`)
- Modify: `app/(dashboard)/page.tsx` (legenda do card "Quantidade de pedidos" + novo gráfico)
- Create: `lib/__tests__/data.test.ts` (novo `describe` para `mediaPedidosPorDia`, no arquivo já existente)

**Interfaces:**
- Consumes: `RangePeriodo` (Task 4), `rangeAtual` novo em `FiltrosContextValue` (`lib/filters.tsx`).
- Produces: `mediaPedidosPorDia(pedidos: Pedido[], diasNoPeriodo: number | null): number` em `lib/data.ts`; `PontoDiario` ganha campo `pedidos: number`.

Decisão de design: em vez de um 9º KPI card (quebraria o grid `lg:grid-cols-4` de 8 cards em 2 linhas de 4 + 1 órfão), a média de pedidos/dia entra como texto adicional na **legenda** do card "Quantidade de pedidos" já existente (`app/(dashboard)/page.tsx`). O volume diário ganha um gráfico de barras dedicado, abaixo dos dois gráficos atuais.

Para calcular "dias no período" corretamente (evitando subcontar quando o período tem dias sem pedido nas pontas), o cálculo usa o range de datas realmente selecionado no filtro, não o span mín/máx dos dados. Isso exige expor o `range` que `lib/filters.tsx` já computa internamente (hoje só usado ali dentro) como `rangeAtual` no contexto.

- [ ] **Step 1: Teste que falha** — adicionar a `lib/__tests__/data.test.ts` (mesmo arquivo da Task 1):

```ts
import { mediaPedidosPorDia } from "@/lib/data"

describe("mediaPedidosPorDia", () => {
  const pedidos = [
    { data: "2026-07-01" },
    { data: "2026-07-01" },
    { data: "2026-07-02" },
  ] as Pedido[]

  it("divide a quantidade de pedidos pelos dias informados", () => {
    expect(mediaPedidosPorDia(pedidos, 3)).toBeCloseTo(1)
  })
  it("sem dias informados (período 'tudo'), usa a contagem de dias distintos nos dados", () => {
    expect(mediaPedidosPorDia(pedidos, null)).toBeCloseTo(1.5)
  })
  it("lista vazia retorna 0 sem dividir por zero", () => {
    expect(mediaPedidosPorDia([], null)).toBe(0)
    expect(mediaPedidosPorDia([], 5)).toBe(0)
  })
})
```

(`Pedido` importado junto aos demais tipos do arquivo de teste.)

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test`

- [ ] **Step 3: Implementar `mediaPedidosPorDia` em `lib/data.ts`** (perto de `calcularKPIs`):

```ts
// Média de pedidos/dia. `diasNoPeriodo` vem do range de filtro selecionado
// (inclusive); null = período "tudo" (sem limite) → usa dias distintos nos dados,
// já que não há um span de calendário fixo para dividir.
export function mediaPedidosPorDia(pedidos: Pedido[], diasNoPeriodo: number | null): number {
  if (!pedidos.length) return 0
  const dias = diasNoPeriodo ?? new Set(pedidos.map((p) => p.data)).size
  return dias ? pedidos.length / dias : 0
}
```

- [ ] **Step 4: Rodar e ver passar** — `pnpm test`

- [ ] **Step 5: `PontoDiario` ganha contagem de pedidos** — em `lib/data.ts`, `serieDiaria`:

```ts
export interface PontoDiario {
  data: string
  faturamento: number
  lucro: number
  pedidos: number
}

export function serieDiaria(pedidos: Pedido[]): PontoDiario[] {
  const mapa = new Map<string, PontoDiario>()
  for (const p of pedidos) {
    const atual = mapa.get(p.data) ?? { data: p.data, faturamento: 0, lucro: 0, pedidos: 0 }
    atual.faturamento += p.valorVenda
    atual.lucro += lucroBrutoPedido(p)
    atual.pedidos += 1
    mapa.set(p.data, atual)
  }
  return Array.from(mapa.values()).sort((a, b) => (a.data < b.data ? -1 : 1))
}
```

- [ ] **Step 6: Expor `rangeAtual` em `lib/filters.tsx`** — adicionar ao `FiltrosContextValue`:

```ts
  rangeAtual: RangePeriodo
```

(import `type { RangePeriodo }` de `@/lib/periodo`) e incluir `rangeAtual: range` no objeto `value` do provider (o `range` já existe no `useMemo` atual — apenas reexpor).

- [ ] **Step 7: Helper de dias no período + card e gráfico em `app/(dashboard)/page.tsx`**

```tsx
  const { pedidosFiltrados, pedidosPeriodoAnterior, rangeAtual } = useFiltros()
  const diasNoPeriodo =
    rangeAtual.inicio && rangeAtual.fim
      ? Math.round((Date.parse(rangeAtual.fim) - Date.parse(rangeAtual.inicio)) / 86_400_000) + 1
      : null
  const mediaPorDia = mediaPedidosPorDia(pedidosFiltrados, diasNoPeriodo)
```

No card "Quantidade de pedidos", trocar a legenda fixa por:

```ts
    { titulo: "Quantidade de pedidos", valor: formatNumero(kpi.quantidadePedidos), icone: ShoppingCart, variacao: variacaoPct(kpi.quantidadePedidos, kpiAnterior.quantidadePedidos), destaque: "default" as const, legenda: `média de ${mediaPorDia.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/dia` },
```

(import `mediaPedidosPorDia` de `@/lib/data`.) Renderizar o novo gráfico junto aos existentes:

```tsx
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <FaturamentoLucroChart pedidos={pedidosFiltrados} />
        <CanalBarChart pedidos={pedidosFiltrados} />
      </section>
      <PedidosPorDiaChart pedidos={pedidosFiltrados} />
```

- [ ] **Step 8: `PedidosPorDiaChart` em `components/dashboard/overview-charts.tsx`** — mesmo padrão Recharts/`ChartContainer`/tokens dos charts vizinhos, largura de eixo Y generosa (`width={68}`, mesmo valor usado na correção recente de clipping):

```tsx
const pedidosConfig = {
  pedidos: { label: "Pedidos", color: "var(--chart-4)" },
} satisfies ChartConfig

export function PedidosPorDiaChart({ pedidos }: { pedidos: Pedido[] }) {
  const dados = serieDiaria(pedidos).map((d) => ({ ...d, label: formatData(d.data).slice(0, 5) }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pedidos por dia</CardTitle>
        <CardDescription>Volume diário de pedidos no período selecionado</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={pedidosConfig} className="aspect-auto h-[240px] w-full">
          <BarChart data={dados} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} width={68} allowDecimals={false} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value) => (
                    <div className="flex w-full items-center justify-between gap-3">
                      <span className="text-muted-foreground">Pedidos</span>
                      <span className="font-medium tabular-nums">{formatNumero(Number(value))}</span>
                    </div>
                  )}
                />
              }
            />
            <Bar dataKey="pedidos" fill="var(--color-pedidos)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
```

(import `formatNumero` de `@/lib/data` junto aos demais nesse arquivo.)

- [ ] **Step 9: Verificar tipos e testes** — `pnpm exec tsc --noEmit && pnpm test` sem erros.

- [ ] **Step 10: Verificar no preview** — Visão Geral mostra "média de X,X/dia" na legenda do card de pedidos e o novo gráfico de barras abaixo dos dois existentes; trocar período (7d, mês atual, tudo) e confirmar que a média muda coerentemente (inclusive no caso "tudo", que cai para a contagem de dias distintos nos dados).

- [ ] **Step 11: Commit**

```bash
git add lib/data.ts lib/filters.tsx components/dashboard/overview-charts.tsx "app/(dashboard)/page.tsx" lib/__tests__/data.test.ts
git commit -m "feat(visao-geral): adicionar média de pedidos por dia e gráfico de volume diário"
```

### Task 28: Lista de pedidos sem custo com link para o Olist e export CSV

> **Depende das Tasks 17 (CSV) e 18 (DataTable) — executar depois delas, fora da ordem numérica do plano.**

**Files:**
- Create: `app/(dashboard)/qualidade-dados/pedidos-sem-custo/page.tsx`
- Modify: `lib/olist-v3.ts` (ou novo arquivo `lib/olist-links.ts` — ver Step 2) com `olistOrderUrl`
- Create: `lib/__tests__/olist-links.test.ts`
- Modify: `app/(dashboard)/page.tsx` (banner de aviso vira link para a nova página)

**Interfaces:**
- Consumes: `useFiltros()` (`pedidosFiltrados`), `DataTable` (Task 18), `gerarCsv`/`baixarCsv` via prop `csv` do `DataTable` (Task 17), condição de "sem custo" idêntica à usada em `calcularKPIs` (`lib/data.ts`: `p.valorVenda > 0 && p.custoTotal === 0`).
- Produces: `olistOrderUrl(olistId: string): string` — único ponto do código com o padrão de URL do Tiny/Olist, para facilitar correção futura.
- Não adiciona item em `app-sidebar.tsx` — esta é uma página de drill-down, acessível só pelo link no banner da Visão Geral, não pela navegação principal.

- [ ] **Step 1: Confirmar com o usuário o padrão de URL de pedido no Tiny/Olist antes de finalizar.** O padrão assumido abaixo — `https://erp.tiny.com.br/vendas#edit/{olistId}` usando `pedido.id` (o id interno do Tiny, já persistido como `Pedido.id`/`orders.olist_id`) — é **não confirmado**. Não considerar esta task concluída sem validar com o usuário que o link abre o pedido certo em produção; se o padrão real for diferente, ajustar só `olistOrderUrl` (Step 2).

- [ ] **Step 2: Teste que falha** — `lib/__tests__/olist-links.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { olistOrderUrl } from "@/lib/olist-links"

describe("olistOrderUrl", () => {
  it("monta a URL de edição do pedido no Tiny/Olist a partir do id interno", () => {
    expect(olistOrderUrl("123456789")).toBe("https://erp.tiny.com.br/vendas#edit/123456789")
  })
})
```

- [ ] **Step 3: Rodar e ver falhar** — `pnpm test`

- [ ] **Step 4: Implementar `lib/olist-links.ts`**

```ts
// Padrão de URL do pedido no Tiny/Olist ERP — UNCONFIRMADO, validar com o usuário
// antes de considerar a Task 28 concluída (ver plano, Task 28 Step 1).
// Único ponto do código com esse padrão: se estiver errado, corrigir só aqui.
export function olistOrderUrl(olistId: string): string {
  return `https://erp.tiny.com.br/vendas#edit/${olistId}`
}
```

- [ ] **Step 5: Rodar e ver passar** — `pnpm test`

- [ ] **Step 6: Banner da Visão Geral vira link** — em `app/(dashboard)/page.tsx`, envolver o texto do aviso com link para a nova página (import `Link` de `next/link`):

```tsx
      {kpi.pedidosSemCusto > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {formatNumero(kpi.pedidosSemCusto)} pedido(s) sem custo de produto cadastrado — a
            margem de contribuição pode estar otimista nesses casos.{" "}
            <Link href="/qualidade-dados/pedidos-sem-custo" className="font-medium underline underline-offset-2 hover:no-underline">
              Ver lista →
            </Link>
          </span>
        </div>
      )}
```

- [ ] **Step 7: Criar a página** — `app/(dashboard)/qualidade-dados/pedidos-sem-custo/page.tsx`:

```tsx
"use client"

import Link from "next/link"
import { ExternalLink } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { PageTitle } from "@/components/dashboard/page-title"
import { DataTable } from "@/components/dashboard/data-table"
import { useFiltros } from "@/lib/filters"
import { formatBRL, formatData, type Pedido } from "@/lib/data"
import { olistOrderUrl } from "@/lib/olist-links"

const columns: ColumnDef<Pedido, unknown>[] = [
  { accessorKey: "data", header: "Data", cell: ({ row }) => formatData(row.original.data) },
  { accessorKey: "numeroPedido", header: "Pedido" },
  { accessorKey: "numeroNF", header: "NF" },
  { accessorKey: "canal", header: "Canal" },
  { accessorKey: "vendedor", header: "Vendedor" },
  { accessorKey: "sku", header: "SKU" },
  { accessorKey: "produto", header: "Produto" },
  {
    accessorKey: "valorVenda",
    header: "Valor da venda",
    cell: ({ row }) => formatBRL(row.original.valorVenda),
  },
  {
    id: "olist",
    header: "Olist",
    cell: ({ row }) => (
      <Link
        href={olistOrderUrl(row.original.id)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline"
      >
        Ver na Olist <ExternalLink className="size-3.5" />
      </Link>
    ),
  },
]

export default function PedidosSemCustoPage() {
  const { pedidosFiltrados } = useFiltros()
  // Mesma condição de calcularKPIs (lib/data.ts) para o total bater com o card da Visão Geral.
  const semCusto = pedidosFiltrados.filter((p) => p.valorVenda > 0 && p.custoTotal === 0)

  return (
    <>
      <PageTitle
        titulo="Pedidos sem custo"
        descricao="Pedidos com venda registrada e nenhum custo de produto cadastrado na Olist — a margem de contribuição fica otimista nesses casos."
      />

      <DataTable
        columns={columns}
        data={semCusto}
        buscaPlaceholder="Buscar por pedido, SKU, produto..."
        csv={{
          nome: "pedidos-sem-custo",
          linhas: (rows) =>
            rows.map((p) => ({
              Data: p.data,
              Pedido: p.numeroPedido,
              NF: p.numeroNF,
              Canal: p.canal,
              Vendedor: p.vendedor,
              SKU: p.sku,
              Produto: p.produto,
              "Valor da venda": p.valorVenda,
            })),
        }}
        vazio="Nenhum pedido sem custo no período selecionado 🎉"
      />
    </>
  )
}
```

- [ ] **Step 8: Verificar tipos** — `pnpm exec tsc --noEmit` sem erros.

- [ ] **Step 9: Verificar no preview** — na Visão Geral, com algum pedido sem custo no período, clicar em "Ver lista →" e confirmar que navega para `/qualidade-dados/pedidos-sem-custo` com a tabela populada e a mesma contagem do banner; testar o botão CSV (baixa arquivo com as colunas esperadas); clicar em "Ver na Olist" de uma linha e confirmar (junto com o usuário) se a URL abre o pedido correto — **não finalizar sem essa confirmação** (Step 1); filtrar para um período sem pedidos sem custo e confirmar o estado vazio.

- [ ] **Step 10: Commit**

```bash
git add "app/(dashboard)/qualidade-dados/pedidos-sem-custo/page.tsx" lib/olist-links.ts lib/__tests__/olist-links.test.ts "app/(dashboard)/page.tsx"
git commit -m "feat(qualidade): página de pedidos sem custo com link para Olist e export CSV"
```

---

## Fases futuras (backlog priorizado)

1. **Qualidade dos Dados** (página): pedidos sem custo/NF/SKU, divergências, status das integrações, conciliação com planilha ML.
2. **Margem e Rentabilidade** (página): waterfall bruto→margem, margem por canal/vendedor, dispersões.
3. **Meta e Projeção** (página): aguardando definição de meta (usuário adiou).
4. **Autenticação**: senha única via middleware (URL hoje é pública).
5. **Configurações** (página): limiares de alerta, % de comissão fallback, gestão de sync.
6. **Tabelas avançadas v2**: colunas configuráveis, visões salvas, XLSX, densidade.
7. **Curva ABC por margem** e comparação ABC faturamento × margem.
8. **Drill-down por rota** (URLs para SKU/pedido) e filtros na querystring.

## Riscos

- **Fees de pedidos cancelados**: o ML pode reembolsar tarifa/frete em cancelamentos — margem de devolvidos fica conservadora demais. Mitigação: aviso no drawer; refinar com `mlStatus === "cancelled"` em fase futura.
- **Rate limit ML**: sync inicial faz ~4.750 chamadas; com 150ms de intervalo e budget de 230s são ~4 execuções. Tombstones evitam refetch de ids inválidos.
- **`db.execute` do driver neon-http**: formato de retorno (`rows` vs array) — verificado nas Tasks 9/14.
- **Pedidos "Olist ERP" sem `numeroPedidoEcommerce`**: ficam sem custo real (esperado — não são ML).
- **Payload da API** cresce com itens (~30%): aceitável nesta escala (2-3k pedidos/trimestre).

## Estratégia de validação

- Testes unitários nas regras de cálculo (rateio, períodos, devoluções, CSV, ML client).
- Conferência manual contra fontes: margem de 1 pedido ML vs simulador do ML (print do usuário); total de devoluções vs planilha manual (jun/2026: R$ 13.411,41).
- Walkthrough visual (Task 26) em 2 temas × 2 tamanhos de tela.
