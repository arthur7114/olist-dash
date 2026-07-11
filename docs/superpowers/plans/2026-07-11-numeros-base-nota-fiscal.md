# Números com base no valor da nota fiscal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que todos os números monetários do dashboard sejam calculados com base no valor real da nota fiscal emitida, alternável por um toggle global entre "valor de venda" e "valor de NF".

**Architecture:** Como toda função de dinheiro lê `p.valorVenda`, adicionamos um campo `valorNota` ao `Pedido` e trocamos o valor **na fonte** (no `FiltrosProvider`) quando o toggle está em modo NF — todo o resto do dashboard reflete a nova base sem alteração. O valor da NF é sincronizado do Tiny/Olist v3 (lista de notas por período) para uma nova coluna, com uma rota de backfill para os pedidos históricos.

**Tech Stack:** Next.js 16 (App Router), React client components, Drizzle ORM sobre Neon Postgres, Tiny/Olist ERP API v3, Vitest, Tailwind + shadcn/ui.

## Global Constraints

- Testes rodam com `pnpm test` (`vitest run`). Testes ficam em `lib/__tests__/*.test.ts`.
- Migrações Drizzle: `pnpm db:generate` gera o SQL em `drizzle/`; nunca editar migrações à mão.
- Rotas de sync/backfill: runtime `nodejs`, `maxDuration = 300`, autenticadas por `OLIST_SYNC_SECRET` via `Bearer` ou `?key=`, com `timingSafeEqual`.
- Chamadas à API Tiny passam SEMPRE por `tinyFetch` (respeita rate-limit/backoff da conta). Nunca usar `fetch` direto para a API Tiny.
- Valores monetários no banco são `numeric(14,2)`, lidos/gravados como `string` no Drizzle.
- Idioma do código/comentários: português, seguindo o estilo do repositório.

---

### Task 1: Campo `valorNota` no tipo `Pedido` + transformação de base (núcleo puro)

Núcleo puro e testável do toggle, sem DB nem API. Tudo o mais depende disto.

**Files:**
- Modify: `lib/data.ts` (tipo `Pedido` em `:31-50`; adicionar tipo `BaseValor` e função `aplicarBaseValor` no fim do arquivo)
- Test: `lib/__tests__/base-valor.test.ts` (criar)

**Interfaces:**
- Produces:
  - `Pedido.valorNota?: number` — valor da NF emitida em R$; `undefined` = sem NF / não capturado.
  - `type BaseValor = "venda" | "nota"`
  - `function aplicarBaseValor(pedidos: Pedido[], base: BaseValor): Pedido[]` — em modo `"venda"` retorna a lista original; em `"nota"` retorna cópias com `valorVenda = valorNota ?? 0`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `lib/__tests__/base-valor.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { aplicarBaseValor, type Pedido } from "@/lib/data"

function pedido(over: Partial<Pedido>): Pedido {
  return {
    id: "1",
    numeroPedido: "1",
    numeroNF: "-",
    sku: "SKU",
    produto: "Produto",
    canal: "Mercado Livre",
    vendedor: "Loja",
    formaPagamento: "Pix",
    valorVenda: 100,
    valorFrete: 0,
    devolucao: 0,
    taxaComissao: 0,
    custoTotal: 0,
    quantidade: 1,
    statusPagamento: "Aprovado",
    data: "2026-07-01",
    ...over,
  }
}

describe("aplicarBaseValor", () => {
  it("modo venda: retorna a mesma referência de lista, sem alterar valorVenda", () => {
    const pedidos = [pedido({ valorVenda: 100, valorNota: 90 })]
    const out = aplicarBaseValor(pedidos, "venda")
    expect(out).toBe(pedidos)
    expect(out[0].valorVenda).toBe(100)
  })

  it("modo nota: troca valorVenda pelo valorNota", () => {
    const out = aplicarBaseValor([pedido({ valorVenda: 100, valorNota: 90 })], "nota")
    expect(out[0].valorVenda).toBe(90)
  })

  it("modo nota: pedido sem NF vira 0", () => {
    const out = aplicarBaseValor([pedido({ valorVenda: 100, valorNota: undefined })], "nota")
    expect(out[0].valorVenda).toBe(0)
  })

  it("modo nota: não muta os pedidos de entrada", () => {
    const pedidos = [pedido({ valorVenda: 100, valorNota: 90 })]
    aplicarBaseValor(pedidos, "nota")
    expect(pedidos[0].valorVenda).toBe(100)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm test base-valor`
Expected: FAIL — `aplicarBaseValor` não existe / não exportado.

- [ ] **Step 3: Implementar o mínimo**

Em `lib/data.ts`, adicionar `valorNota?: number` ao tipo `Pedido` (logo após `custoTotal` em `:44`):

```ts
  custoTotal: number // custo dos produtos vendidos
  valorNota?: number // valor da NF emitida (R$); undefined = sem NF / não capturado
```

No fim de `lib/data.ts`, adicionar:

```ts
// Base de valor usada nos números do dashboard: valor de venda (padrão) ou valor da NF.
export type BaseValor = "venda" | "nota"

// Troca a base monetária "na fonte": em modo "nota", cada pedido passa a expor o valor
// da NF em valorVenda (0 quando não há NF), de modo que TODA agregação que lê valorVenda
// (KPIs, séries, curva ABC, devoluções) reflita a nova base sem alteração própria.
export function aplicarBaseValor(pedidos: Pedido[], base: BaseValor): Pedido[] {
  if (base === "venda") return pedidos
  return pedidos.map((p) => ({ ...p, valorVenda: p.valorNota ?? 0 }))
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm test base-valor`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add lib/data.ts lib/__tests__/base-valor.test.ts
git commit -m "feat(data): campo valorNota e transformação aplicarBaseValor"
```

---

### Task 2: Coluna `valor_nota` no schema + migração + plumbing em orders.ts

Persiste e lê o valor da NF; adiciona as queries que o backfill (Task 4) usará. Verificação por typecheck/build (plumbing de DB não é unit-testável de forma útil).

**Files:**
- Modify: `lib/db/schema.ts` (tabela `orders`, `:16-21`)
- Modify: `lib/db/orders.ts` (`rowToPedido` `:53-80`, `ordersConflictSet` `:83-103`, `upsertOrders` `:109-130`; adicionar duas funções novas)
- Create (gerado): `drizzle/0004_*.sql` via `pnpm db:generate`

**Interfaces:**
- Consumes: `Pedido.valorNota` (Task 1).
- Produces:
  - Coluna `orders.valorNota` (`numeric(14,2)` nullable).
  - `rowToPedido` passa a preencher `valorNota`.
  - `upsertOrders` passa a gravar `valorNota`.
  - `function getOrdersMissingNotaValue(limit: number): Promise<Array<{ olistId: string; data: string; raw: unknown }>>`
  - `function updateOrderNotaValue(olistId: string, valorNota: number): Promise<void>`

- [ ] **Step 1: Adicionar a coluna no schema**

Em `lib/db/schema.ts`, dentro de `orders`, logo após `custoTotal` (`:20`):

```ts
    custoTotal: numeric("custo_total", { precision: 14, scale: 2 }).notNull().default("0"),
    valorNota: numeric("valor_nota", { precision: 14, scale: 2 }),
```

- [ ] **Step 2: Gerar a migração**

Run: `pnpm db:generate`
Expected: cria um arquivo novo `drizzle/0004_*.sql` contendo `ALTER TABLE "orders" ADD COLUMN "valor_nota" numeric(14, 2);`. Confirme abrindo o arquivo.

- [ ] **Step 3: Preencher `valorNota` na leitura e escrita**

Em `lib/db/orders.ts`, dentro de `rowToPedido`, logo após `custoTotal: Number(r.custoTotal),` (`:74`):

```ts
    custoTotal: Number(r.custoTotal),
    valorNota: r.valorNota == null ? undefined : Number(r.valorNota),
```

Em `ordersConflictSet`, após `custoTotal` (`:97`):

```ts
    custoTotal: sql`excluded.custo_total`,
    valorNota: sql`excluded.valor_nota`,
```

Em `upsertOrders`, no objeto `rows.map(...)`, após `custoTotal: String(pedido.custoTotal),` (`:123`):

```ts
    custoTotal: String(pedido.custoTotal),
    valorNota: pedido.valorNota == null ? null : String(pedido.valorNota),
```

- [ ] **Step 4: Adicionar as queries do backfill**

Ainda em `lib/db/orders.ts`, após `getOrdersMissingCost` (`:32`), adicionar:

```ts
// Pedidos ainda sem valorNota mas com detalhe salvo (para o backfill de NF).
// raw traz idNotaFiscal, mas NÃO o valor da NF — o backfill precisa buscá-lo na API.
export async function getOrdersMissingNotaValue(
  limit: number,
): Promise<Array<{ olistId: string; data: string; raw: unknown }>> {
  const db = getDb()
  return db
    .select({ olistId: orders.olistId, data: orders.data, raw: orders.raw })
    .from(orders)
    .where(sql`${orders.valorNota} is null and ${orders.raw} is not null`)
    .orderBy(asc(orders.data))
    .limit(limit)
}

// Atualiza só o valorNota de um pedido (usado pelo backfill de NF).
export async function updateOrderNotaValue(olistId: string, valorNota: number): Promise<void> {
  const db = getDb()
  await db
    .update(orders)
    .set({ valorNota: String(valorNota), updatedAt: new Date() })
    .where(eq(orders.olistId, olistId))
}
```

- [ ] **Step 5: Verificar typecheck e testes**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: PASS — sem erros de tipo; testes existentes seguem verdes.

- [ ] **Step 6: Commit**

```bash
git add lib/db/schema.ts lib/db/orders.ts drizzle/
git commit -m "feat(db): coluna valor_nota e queries de backfill de NF"
```

---

### Task 3: Buscar o valor da NF do Tiny v3 e gravar no sync

Adiciona a busca do valor real da NF por janela de datas e integra ao sync incremental, preenchendo `valorNota` em cada pedido novo/atualizado.

> ⚠️ **Confirmar contra a API real durante a implementação:** o path (`/notas`), o nome do campo de valor (`valor` / `valorNota`) e o campo de id da nota nos itens da listagem precisam ser confirmados chamando a API v3 com um token válido (a doc pública v3 exige auth). A função `indexNotaValues` (testada abaixo) já é defensiva quanto a nomes de campo; ajuste os campos de `TinyNotaListItem` e os parâmetros de data (`dataInicialEmissao`/`dataFinalEmissao`) conforme a resposta real, no molde de `fetchRecentReceivables` (`lib/olist-v3.ts:748`).

**Files:**
- Modify: `lib/olist-v3.ts` (adicionar tipo + `indexNotaValues` + `fetchNotaValuesRange`; alterar `mapOrderToPedido` `:505-551`; alterar `syncOrdersIncremental` `:262-320` e o `flush()` `:282-300`)
- Test: `lib/__tests__/nota-values.test.ts` (criar)

**Interfaces:**
- Consumes: `Pedido.valorNota` (Task 1); `TinyOrderDetail`, `TinyListResponse`, `tinyFetch`, `toNumber` (existentes em `lib/olist-v3.ts`).
- Produces:
  - `type TinyNotaListItem = { id?: number; valor?: number; valorNota?: number }`
  - `function indexNotaValues(notas: TinyNotaListItem[]): Map<number, number>` — mapeia `id → valor` (usa `valor ?? valorNota`, ignora sem id ou valor ≤ 0).
  - `function fetchNotaValuesRange(accessToken, dataInicial, dataFinal, maxItems): Promise<Map<number, number>>`
  - `mapOrderToPedido(order, productCosts, receivablePayments, notaValues)` — 4º parâmetro novo `notaValues: Map<number, number>`.

- [ ] **Step 1: Escrever o teste que falha (peça pura de indexação)**

Criar `lib/__tests__/nota-values.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { indexNotaValues } from "@/lib/olist-v3"

describe("indexNotaValues", () => {
  it("mapeia id da nota para o valor", () => {
    const m = indexNotaValues([
      { id: 10, valor: 250.5 },
      { id: 11, valor: 99 },
    ])
    expect(m.get(10)).toBe(250.5)
    expect(m.get(11)).toBe(99)
  })

  it("aceita o campo valorNota como alternativa a valor", () => {
    const m = indexNotaValues([{ id: 12, valorNota: 42 }])
    expect(m.get(12)).toBe(42)
  })

  it("ignora notas sem id ou sem valor positivo", () => {
    const m = indexNotaValues([{ valor: 100 }, { id: 13, valor: 0 }, { id: 14 }])
    expect(m.size).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm test nota-values`
Expected: FAIL — `indexNotaValues` não existe.

- [ ] **Step 3: Implementar tipo + indexação + fetch**

Em `lib/olist-v3.ts`, após o tipo `TinyProductDetail` (`:128`) adicionar:

```ts
// Item da listagem de notas fiscais (v3). Campos confirmados contra a API real na implementação.
export type TinyNotaListItem = {
  id?: number
  valor?: number
  valorNota?: number
}

// Indexa id-da-nota → valor, para casar com order.idNotaFiscal. Ignora entradas inválidas.
export function indexNotaValues(notas: TinyNotaListItem[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const nota of notas) {
    if (nota.id == null) continue
    const valor = toNumber(nota.valor) || toNumber(nota.valorNota)
    if (valor > 0) map.set(nota.id, valor)
  }
  return map
}
```

Após `fetchOrderListRange` (`:396`), adicionar a busca paginada por janela (espelha `fetchRecentReceivables`):

```ts
// Busca o valor das notas fiscais emitidas numa janela de datas e devolve id-da-nota → valor.
// Paginação no mesmo molde de fetchOrderListRange. Não lança em 429 se já houver dados.
export async function fetchNotaValuesRange(
  accessToken: string,
  dataInicial: string,
  dataFinal: string,
  maxItems: number,
): Promise<Map<number, number>> {
  const notas: TinyNotaListItem[] = []
  const limit = 100
  let offset = 0
  let total = Number.POSITIVE_INFINITY

  while (offset < total && notas.length < maxItems) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      orderBy: "desc",
      dataInicialEmissao: dataInicial,
      dataFinalEmissao: dataFinal,
    })
    let list: TinyListResponse<TinyNotaListItem>
    try {
      list = await tinyFetch<TinyListResponse<TinyNotaListItem>>(accessToken, `/notas?${params.toString()}`)
    } catch (err) {
      if (err instanceof TinyApiError && err.status === 429 && notas.length > 0) break
      throw err
    }
    const pageItems = list.itens ?? []
    notas.push(...pageItems)
    total = list.paginacao?.total ?? notas.length
    if (pageItems.length < limit) break
    offset += limit
  }

  return indexNotaValues(notas.slice(0, maxItems))
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm test nota-values`
Expected: PASS (3 testes).

- [ ] **Step 5: Passar `notaValues` por `mapOrderToPedido`**

Em `lib/olist-v3.ts`, alterar a assinatura de `mapOrderToPedido` (`:505-509`):

```ts
function mapOrderToPedido(
  order: TinyOrderDetail,
  productCosts: ProductCostLookup,
  receivablePayments: Map<string, string>,
  notaValues: Map<number, number>,
): Pedido {
```

No objeto de retorno, após `custoTotal: roundMoney(custoTotal),` (`:546`):

```ts
    custoTotal: roundMoney(custoTotal),
    valorNota:
      order.idNotaFiscal != null && notaValues.has(order.idNotaFiscal)
        ? roundMoney(notaValues.get(order.idNotaFiscal)!)
        : undefined,
```

- [ ] **Step 6: Buscar os valores de NF uma vez por janela no sync e repassar ao flush**

Em `lib/olist-v3.ts`, em `syncOrdersIncremental`, logo após `const items = await fetchOrderListRange(...)` (`:276`):

```ts
  const items = await fetchOrderListRange(accessToken, opts.dataInicial, opts.dataFinal, maxItems)
  const notaValues = await fetchNotaValuesRange(accessToken, opts.dataInicial, opts.dataFinal, maxItems)
```

Dentro de `flush()`, na construção de `mapped` (`:290-296`), passar `notaValues`:

```ts
    const mapped: SyncOrder[] = batch.map((detail) => ({
      pedido: mapOrderToPedido(detail, productCosts, noPayments, notaValues),
      situacao: detail.situacao,
      detailLevel: "full",
      raw: detail,
      itens: extractOrderItems(detail, custoDe),
    }))
```

- [ ] **Step 7: Verificar typecheck e testes**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: PASS — sem erros de tipo; todos os testes verdes.

- [ ] **Step 8: Commit**

```bash
git add lib/olist-v3.ts lib/__tests__/nota-values.test.ts
git commit -m "feat(olist): buscar valor da NF por período e gravar no sync"
```

---

### Task 4: Rota de backfill do valor da NF para pedidos históricos

Preenche `valorNota` nos pedidos já sincronizados sem re-sincronizar tudo. Resumível por orçamento de tempo, no molde de `runRecomputeCosts` / `backfill-items`.

**Files:**
- Modify: `lib/olist-sync.ts` (adicionar `runBackfillNotas`; reusar `getStoredCredentials`/`refreshAccessToken`/`saveCredentials`/`BUDGET_MS` já importados no arquivo)
- Create: `app/api/olist/backfill-notas/route.ts`

**Interfaces:**
- Consumes: `getOrdersMissingNotaValue`, `updateOrderNotaValue` (Task 2); `fetchNotaValuesRange` (Task 3); `refreshAccessToken` e credenciais (existentes em `lib/olist-sync.ts`).
- Produces:
  - `function runBackfillNotas(): Promise<{ ok: true; totalMissing: number; scanned: number; updated: number; remaining: number; completed: boolean; elapsedMs: number }>`
  - Rota `GET`/`POST /api/olist/backfill-notas`.

- [ ] **Step 1: Implementar `runBackfillNotas`**

Em `lib/olist-sync.ts`, **mesclar** os símbolos novos nos imports já existentes (não criar linhas duplicadas — `no-duplicate-imports` quebraria o lint). O arquivo já importa de `@/lib/db/orders` (ex.: `getOrdersMissingCost`, `updateOrderCost`) e de `@/lib/olist-v3` — adicionar aos mesmos blocos:

- Ao import de `@/lib/db/orders`: `getOrdersMissingNotaValue`, `updateOrderNotaValue`.
- Ao import de `@/lib/olist-v3`: `fetchNotaValuesRange`, `type TinyOrderDetail`.

No fim de `lib/olist-sync.ts`, adicionar:

```ts
// Preenche valorNota dos pedidos já sincronizados a partir do idNotaFiscal salvo no raw.
// Busca os valores por janela (min..max das datas do lote) e atualiza pedido a pedido.
// Resumível: rode de novo até completed=true.
export async function runBackfillNotas(): Promise<{
  ok: true
  totalMissing: number
  scanned: number
  updated: number
  remaining: number
  completed: boolean
  elapsedMs: number
}> {
  const startedAt = Date.now()
  const deadline = startedAt + BUDGET_MS

  const creds = await getStoredCredentials()
  if (!creds) throw new Error("Sem credenciais Olist no banco. Conecte a conta pelo dashboard primeiro.")
  const refreshed = await refreshAccessToken(creds.refreshToken)
  await saveCredentials(refreshed)
  const accessToken = refreshed.access_token

  const all = await getOrdersMissingNotaValue(3000)
  let scanned = 0
  let updated = 0
  let completed = true
  const CHUNK = 200

  for (let i = 0; i < all.length; i += CHUNK) {
    if (Date.now() >= deadline) {
      completed = false
      break
    }
    const slice = all.slice(i, i + CHUNK)
    const datas = slice.map((o) => o.data).sort()
    const notaValues = await fetchNotaValuesRange(accessToken, datas[0], datas[datas.length - 1], 5000)
    for (const o of slice) {
      scanned += 1
      const idNota = (o.raw as TinyOrderDetail)?.idNotaFiscal
      const valor = idNota != null ? notaValues.get(idNota) : undefined
      if (valor && valor > 0) {
        await updateOrderNotaValue(o.olistId, valor)
        updated += 1
      }
    }
  }

  return {
    ok: true,
    totalMissing: all.length,
    scanned,
    updated,
    remaining: all.length - scanned,
    completed,
    elapsedMs: Date.now() - startedAt,
  }
}
```

- [ ] **Step 2: Criar a rota**

Criar `app/api/olist/backfill-notas/route.ts`:

```ts
import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { runBackfillNotas } from "@/lib/olist-sync"
import { hasDatabase } from "@/lib/db/client"

// Backfill do valor da NF em pedidos antigos; mesmo runtime/orçamento do sync. Resumível.
export const runtime = "nodejs"
export const maxDuration = 300

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

  try {
    return NextResponse.json(await runBackfillNotas())
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

- [ ] **Step 3: Verificar typecheck, lint e build**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS — sem erros de tipo nem de lint na nova rota / no olist-sync.

- [ ] **Step 4: Commit**

```bash
git add lib/olist-sync.ts app/api/olist/backfill-notas/route.ts
git commit -m "feat(olist): rota de backfill do valor da NF"
```

---

### Task 5: Toggle global no cliente (estado + persistência + UI)

Expõe `baseValor` no contexto de filtros, aplica `aplicarBaseValor` nas listas derivadas, persiste em `localStorage` e adiciona o `Switch` + badge "NF" na barra de filtros.

**Files:**
- Modify: `lib/filters.tsx` (`FiltrosContextValue` `:29-48`; `FiltrosProvider` `:62-223`)
- Modify: `components/dashboard/global-filters.tsx` (`:37-190`)
- Test: `lib/__tests__/base-valor.test.ts` (estender — cobre a composição período-anterior no modo nota)

**Interfaces:**
- Consumes: `aplicarBaseValor`, `BaseValor` (Task 1); `Pedido.valorNota` (Task 1).
- Produces:
  - `FiltrosContextValue.baseValor: BaseValor`
  - `FiltrosContextValue.setBaseValor: (base: BaseValor) => void`
  - `pedidosFiltrados` e `pedidosPeriodoAnterior` já com a base aplicada.

- [ ] **Step 1: Estender o teste (composição no modo nota)**

Em `lib/__tests__/base-valor.test.ts`, adicionar ao final:

```ts
describe("aplicarBaseValor — composição com agregação", () => {
  it("soma de valorVenda no modo nota usa valorNota (0 quando ausente)", () => {
    const pedidos = [
      pedido({ id: "a", valorVenda: 100, valorNota: 90 }),
      pedido({ id: "b", valorVenda: 50, valorNota: undefined }),
    ]
    const total = aplicarBaseValor(pedidos, "nota").reduce((s, p) => s + p.valorVenda, 0)
    expect(total).toBe(90)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que passa (função já existe da Task 1)**

Run: `pnpm test base-valor`
Expected: PASS — inclusive o novo caso (a Task 1 já implementou `aplicarBaseValor`).

- [ ] **Step 3: Adicionar `baseValor` ao contexto e ao provider**

Em `lib/filters.tsx`:

Import (linha `:4-14`, adicionar `aplicarBaseValor` e `type BaseValor`):

```ts
import {
  CANAIS,
  FORMAS_PAGAMENTO,
  PEDIDOS,
  PRODUTOS,
  VENDEDORES_POR_CANAL,
  aplicarBaseValor,
  type BaseValor,
  type Canal,
  type FormaPagamento,
  type Pedido,
  type Produto,
} from "@/lib/data"
```

Na interface `FiltrosContextValue` (após `limpar` em `:33`):

```ts
  limpar: () => void
  baseValor: BaseValor
  setBaseValor: (base: BaseValor) => void
```

No `FiltrosProvider`, após o `useState` de `lastSync` (`:69`):

```ts
  const [baseValor, setBaseValorState] = useState<BaseValor>("venda")

  // Restaura a base escolhida ao montar (persistida entre sessões).
  useEffect(() => {
    const salvo = window.localStorage.getItem("baseValor")
    if (salvo === "nota" || salvo === "venda") setBaseValorState(salvo)
  }, [])

  const setBaseValor = (base: BaseValor) => {
    setBaseValorState(base)
    window.localStorage.setItem("baseValor", base)
  }
```

- [ ] **Step 4: Aplicar a base nas listas derivadas**

Em `lib/filters.tsx`, envolver `pedidosFiltrados` e `pedidosPeriodoAnterior` com `aplicarBaseValor`.

`pedidosFiltrados` (`:163-171`) — aplicar a base e incluir `baseValor` nas deps:

```ts
  const pedidosFiltrados = useMemo(
    () =>
      aplicarBaseValor(
        pedidos.filter((p) => {
          if (range.inicio && p.data < range.inicio) return false
          if (range.fim && p.data > range.fim) return false
          return passaDimensoes(p)
        }),
        baseValor,
      ),
    [pedidos, range, passaDimensoes, baseValor],
  )
```

`pedidosPeriodoAnterior` (`:174-179`):

```ts
  const pedidosPeriodoAnterior = useMemo(() => {
    if (!range.inicioAnterior || !range.fimAnterior) return []
    return aplicarBaseValor(
      pedidos.filter(
        (p) => p.data >= range.inicioAnterior! && p.data <= range.fimAnterior! && passaDimensoes(p),
      ),
      baseValor,
    )
  }, [pedidos, range, passaDimensoes, baseValor])
```

No objeto `value` (`:206-220`), expor os dois campos:

```ts
    limpar,
    baseValor,
    setBaseValor,
```

- [ ] **Step 5: Adicionar o Switch + badge na barra de filtros**

Em `components/dashboard/global-filters.tsx`:

Imports (após `:9`):

```ts
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
```

Desestruturar do hook (`:38`):

```ts
  const { filtros, setFiltro, setPeriodoPersonalizado, limpar, opcoes, baseValor, setBaseValor } = useFiltros()
```

Substituir o botão "Limpar" (`:186-189`) por um grupo à direita com o toggle + Limpar:

```ts
      <div className="ml-auto flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Valor de venda</span>
          <Switch
            checked={baseValor === "nota"}
            onCheckedChange={(on) => setBaseValor(on ? "nota" : "venda")}
            aria-label="Alternar base entre valor de venda e valor de nota fiscal"
          />
          <span className="flex items-center gap-1">
            Valor de NF
            {baseValor === "nota" && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                NF
              </Badge>
            )}
          </span>
        </label>
        <Button variant="ghost" size="sm" onClick={limpar} className="gap-1.5 text-muted-foreground">
          <RotateCcw className="size-3.5" />
          Limpar
        </Button>
      </div>
```

Se `components/ui/badge.tsx` não existir, rode `pnpm dlx shadcn@latest add badge` (o `switch` já existe). Confirme a existência antes:

Run: `ls components/ui/badge.tsx components/ui/switch.tsx`
Expected: ambos existem (adicione `badge` se faltar).

- [ ] **Step 6: Verificar typecheck, testes e lint**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: PASS — sem erros; todos os testes verdes.

- [ ] **Step 7: Commit**

```bash
git add lib/filters.tsx components/dashboard/global-filters.tsx lib/__tests__/base-valor.test.ts components/ui/badge.tsx
git commit -m "feat(dashboard): toggle global entre valor de venda e valor de NF"
```

---

### Task 6: Verificação end-to-end no preview

Confirma que o toggle muda KPIs, gráfico e tabelas de forma consistente, com dados reais (ou mock).

**Files:** nenhum (verificação).

- [ ] **Step 1: Subir o dev server**

Use a ferramenta de preview (`preview_start` com o dev server do projeto). Não use `pnpm dev` via shell.

- [ ] **Step 2: Conferir o estado inicial**

Abrir o dashboard. Ler os KPIs (faturamento bruto, ticket médio, margem) no modo padrão "Valor de venda" e anotar os valores.

- [ ] **Step 3: Alternar o toggle e verificar**

Clicar no Switch "Valor de NF". Confirmar via `read_page`/screenshot que:
- O faturamento bruto muda (tende a diferir de venda; pedidos sem NF puxam para baixo).
- O gráfico de série diária e a curva ABC recomputam.
- O badge "NF" aparece.
- Recarregar a página mantém o modo NF (persistência em localStorage).

- [ ] **Step 4: Conferir ausência de erros**

`read_console_messages` (onlyErrors) e `preview_logs` (level error): sem novos erros.

- [ ] **Step 5: Commit final (se necessário) e resumo**

Se algum ajuste foi feito na verificação, commitar. Caso contrário, a feature está pronta para revisão/PR.

---

## Notas de comportamento aceitas (do spec)

- Pedido sem NF no modo NF conta como **R$ 0** (não é excluído da contagem).
- No modo NF, apenas a **receita** troca de base; custo, frete, devolução e comissão permanecem — logo a margem passa a ser `valorNota − custos`. Para um pedido devolvido (situação 2), a `devolucao` continua baseada no valor de venda original; isso é aceito como caso de borda raro e não tratado nesta entrega.
- Rótulos de coluna não mudam por modo; o badge "NF" sinaliza a base ativa.
