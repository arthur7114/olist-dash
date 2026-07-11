# Números com base no valor da nota fiscal — Design

**Data:** 2026-07-11
**Branch:** `claude/invoice-based-numbers-21e54a`
**Status:** aprovado para implementação

## Objetivo

Permitir que todos os números monetários do dashboard (KPIs, gráficos, tabelas,
curva ABC, devoluções) sejam calculados com base no **valor real da nota fiscal
emitida**, alternável via um **toggle global**, em vez de apenas o `valorVenda`
atual (= `valorTotalProdutos` do pedido Olist).

## Decisões de negócio (confirmadas com o usuário)

1. **Fonte do valor:** valor real da NF emitida (buscado da API do Tiny/Olist v3),
   não o `valorTotalPedido` já presente no `raw`.
2. **Exibição:** toggle global que alterna todos os números entre "valor de venda"
   e "valor de nota fiscal". Mantém as duas visões.
3. **Pedidos sem NF** (cancelados, ainda não faturados, ou sem valor capturado):
   contam como **R$ 0** no modo NF. O pedido continua na contagem, mas com
   faturamento zero.

## Contexto atual (como os números são calculados hoje)

- Stack: Next.js 16 (App Router), Drizzle ORM sobre Neon Postgres, dados
  sincronizados da Olist/Tiny ERP API v3 para o banco; o dashboard só lê do banco.
- **Toda** função de dinheiro lê o campo `p.valorVenda` do tipo `Pedido`:
  - `lucroBrutoPedido(p)` — `lib/data.ts:211` — `valorVenda − custoTotal − valorFrete − devolucao − taxaComissaoEfetiva`
  - `calcularKPIs(pedidos)` — `lib/data.ts:229` — soma `valorVenda` em `faturamentoBruto`, deriva ticket, margem, markup
  - `serieDiaria` — `lib/data.ts:266`
  - `agregarPorCanalVendedor` / `agregarPorCanal` — `lib/data.ts:292,338`
  - `calcularCurvaABC` — `lib/data.ts:373`
  - `lib/sku-analytics.ts`, `lib/devolucao-analytics.ts` — agregam sobre `valorVenda`/`lucroBrutoPedido`
- `valorVenda` é derivado em `getValorVenda` (`lib/olist-v3.ts:807`):
  `valorTotalProdutos || totalItens || valorTotalPedido || valor`.
- O pedido Olist traz `idNotaFiscal` (só o id/número da NF — hoje mapeado como
  `numeroNF`, string), **sem valor**. O `raw` JSONB de cada pedido guarda o detalhe
  Olist completo, incluindo `idNotaFiscal`.

## Arquitetura da solução

### Princípio: "trocar na fonte"

Como todas as funções de agregação leem `p.valorVenda`, **não alteramos nenhuma
delas**. Em vez disso:

1. Adicionamos o campo `valorNota?: number` ao tipo `Pedido`.
2. O `FiltrosProvider` (`lib/filters.tsx`) — ponto único por onde passa toda a
   lista de pedidos — aplica uma transformação quando o toggle está em modo NF:
   cada pedido tem `valorVenda := valorNota ?? 0`.
3. Todo o resto do dashboard (KPIs, gráficos, tabelas, curva ABC, devoluções)
   passa a refletir a base de NF automaticamente, sem mudança.

Isso isola toda a lógica do toggle em **um único ponto de transformação**, em vez
de propagar um parâmetro `modo` por dezenas de funções e call-sites. É a mudança
mais rasa e testável possível.

**Semântica no modo NF:**
- Faturamento = soma de `valorNota` (pedidos sem NF somam 0).
- Lucro/margem por pedido = `valorNota − custoTotal − valorFrete − devolucao − comissão`.
  Apenas a **receita** muda de base; custos, frete, devolução e comissão permanecem.

### Camada de dados (sync + persistência)

- **Schema** (`lib/db/schema.ts`): nova coluna `valor_nota numeric(14,2)` nullable
  em `orders`. `null` = sem NF ou não capturado → tratado como 0 no modo NF.
  Migração Drizzle nova em `/drizzle`.
- **Captura do valor da NF** (`lib/olist-v3.ts`):
  - Preferência: buscar as notas fiscais por janela de datas no endpoint de
    listagem de notas do Tiny v3 (`/notas` ou equivalente), paginado, no molde do
    que já existe para contas-a-receber (`fetchRecentReceivables`,
    `lib/olist-v3.ts:748`). Indexar por `idNotaFiscal` e casar com o pedido.
  - Fallback: buscar `/notas/{idNotaFiscal}` individualmente quando a listagem não
    cobrir o pedido.
  - Integrar ao `flush()` do `syncOrdersIncremental` (`lib/olist-v3.ts:282`), no
    mesmo padrão de `fetchProductCosts`.
  - **Nota de implementação:** o schema exato do endpoint de notas da v3 (paths,
    nomes de campos de valor, parâmetros de filtro por data/situação) deve ser
    confirmado chamando a API real durante a implementação — a doc pública v3 está
    atrás de autenticação. O código deve ser defensivo quanto a nomes de campos.
- **Persistência e leitura**: incluir `valorNota` em `upsertOrders`, `rowToPedido`
  e `getOrdersByPeriod` (`lib/db/orders.ts`), e no payload de
  `app/api/olist/orders/route.ts`.
- **Backfill**: nova rota `/api/olist/backfill-notas` espelhando
  `app/api/olist/backfill-items/route.ts` / `recompute-costs`. Resumível, itera os
  pedidos já sincronizados que tenham `idNotaFiscal` no `raw`, busca o valor e
  atualiza `valorNota`. Evita re-sincronizar toda a base.
- **Rate limits**: reaproveitar o retry/backoff existente em `tinyFetch`
  (`lib/olist-v3.ts:445`). A abordagem por listagem de período minimiza chamadas.

### Toggle global (UI + estado)

- **Estado** (`lib/filters.tsx`): novo `baseValor: "venda" | "nota"` no
  `FiltrosContextValue`, com `setBaseValor`. Persistido em `localStorage` para
  sobreviver ao reload.
- **Transformação**: `pedidosFiltrados` e `pedidosPeriodoAnterior` aplicam a troca
  `valorVenda := valorNota ?? 0` quando `baseValor === "nota"`. Ambos os campos
  (`valorVenda` original e `valorNota`) permanecem no objeto para quem quiser
  exibir os dois.
- **Controle**: um `Switch` (shadcn/ui) na barra de filtros/cabeçalho, rotulado
  "Base: Valor de venda ⇄ Valor de NF".
- **Indicador**: badge discreto "NF" quando o modo NF está ativo, para o número
  nunca ser lido fora de contexto.

## Escopo

**Dentro:**
- Todos os números derivados de `valorVenda` seguem o toggle automaticamente
  (dashboard, canais, curva ABC, produtos, pedidos, devoluções).
- Sync + backfill do valor da NF; coluna e migração; toggle global persistido.

**Fora (YAGNI / evitar retrabalho amplo):**
- Não renomear rótulos de coluna por modo. A coluna "Valor venda" nas tabelas
  mostra o valor conforme o toggle; o badge "NF" indica a base. Refino de rótulos
  fica para depois, se desejado.
- Não é feita reconciliação/auditoria de divergência NF vs. venda nesta entrega.

## Testes

- **Unitário** da transformação de base: modo NF troca `valorVenda` por `valorNota`;
  pedido sem NF → 0; modo venda mantém intacto.
- **Unitário** de `calcularKPIs` nas duas bases, garantindo que faturamento, ticket,
  margem e markup refletem a base escolhida.
- **Verificação manual** no preview: alternar o toggle e conferir que KPIs,
  gráfico diário, curva ABC e tabela de pedidos mudam de forma consistente.

## Arquivos afetados (previsão)

- `lib/db/schema.ts` — coluna `valor_nota`.
- `drizzle/` — nova migração.
- `lib/olist-v3.ts` — busca do valor da NF + integração no sync.
- `lib/db/orders.ts` — persistência/leitura de `valorNota`.
- `app/api/olist/orders/route.ts` — expõe `valorNota`.
- `app/api/olist/backfill-notas/route.ts` — nova rota de backfill.
- `lib/data.ts` — campo `valorNota` no tipo `Pedido`.
- `lib/filters.tsx` — estado `baseValor`, transformação, persistência.
- Componente de barra de filtros/cabeçalho — `Switch` + badge.
- Testes correspondentes.
