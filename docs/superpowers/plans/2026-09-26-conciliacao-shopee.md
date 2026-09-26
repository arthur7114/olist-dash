# Conciliação Shopee → Olist — plano de implementação

> Execução inline nesta sessão (superpowers:executing-plans). Spec:
> `docs/superpowers/specs/2026-09-26-conciliacao-shopee-design.md`.

**Goal:** rotina diária que baixa na Olist as vendas Shopee liberadas na carteira e lança os saques como transferência.

**Architecture:** cliente assinado da Shopee (`lib/shopee-api.ts`) → normalização pura dos lançamentos da carteira em eventos (`lib/shopee-events.ts`) → decisões puras (`lib/shopee-baixa-plan.ts`) → orquestrador com estado em Postgres (`lib/shopee-reconcile.ts`), exposto em rota protegida e agendado no GitHub Actions. Mesmo molde de `lib/mp-reconcile.ts`.

**Tech Stack:** Next.js route handlers, Drizzle/Postgres, Vitest com `fetch` stubado, API Olist v3, Shopee Open Platform v2.

## Global Constraints

- Toda comparação monetária em centavos inteiros, tolerância 1 centavo.
- Nada é lançado na dúvida: divergência vai para o estado e o resumo.
- `done` nunca é reprocessado; reprocessa `pending`, `receivable_not_found`, `error`.
- Tokens da Shopee cifrados com `encryptSecret`; refresh token rotaciona e é salvo antes de qualquer outra chamada.
- Sem Shopee conectada, a rota responde `ok: true, skipped: "shopee_nao_conectada"`.
- Data do caixa Olist em `yyyy-mm-dd`; data da baixa em `dd/mm/yyyy` (`buildBaixaBody` já faz).

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/shopee-api.ts` | assinatura, URL de autorização, token get/refresh, chamadas de loja, carteira, escrow |
| `lib/shopee-events.ts` | lançamentos da carteira → eventos `income` / `withdrawal` / `other` (puro) |
| `lib/shopee-baixa-plan.ts` | `extractShopeeOc`, `planShopeeBaixa`, `planWithdrawal` (puro) |
| `lib/db/schema.ts` + `drizzle/0012_*.sql` | tabelas `shopee_credentials`, `shopee_wallet_events` |
| `lib/db/shopee.ts` | leitura/escrita das duas tabelas |
| `lib/olist-v3.ts` | `createCaixaLancamento`, `findCaixaLancamentos`, `fetchContasFinanceiras`, `fetchCategoriasReceitaDespesa` |
| `lib/shopee-reconcile.ts` | orquestra: tokens, coleta, casamento, baixa, transferência, resumo |
| `app/api/shopee/auth/start/route.ts`, `app/api/shopee/auth/callback/route.ts` | conexão da loja |
| `app/api/shopee/reconcile/route.ts` | rota protegida (`OLIST_SYNC_SECRET`) |
| `.github/workflows/shopee-reconcile.yml` | cron diário 09:30 UTC |

## Tasks

### Task 1: cliente Shopee
- Produces: `shopeeSign(key, base): string`; `buildShopeeAuthUrl(redirect): string`; `exchangeShopeeCode(code, shopId): Promise<ShopeeToken>`; `refreshShopeeToken(refresh, shopId): Promise<ShopeeToken>`; `fetchWalletTransactions(auth, fromSec, toSec): Promise<ShopeeWalletTxn[]>` (quebra em janelas de 15 dias, pagina 100); `fetchEscrowDetail(auth, orderSn): Promise<ShopeeEscrowDetail>`; `ShopeeApiError`.
- Tests (`lib/__tests__/shopee-api.test.ts`): assinatura com vetor conhecido; base de loja inclui token e shop_id; URL de autorização assinada; carteira pagina até `more=false` e quebra janelas > 15 dias; `error` no corpo vira `ShopeeApiError`.

### Task 2: eventos da carteira (puro)
- Consumes: `ShopeeWalletTxn`.
- Produces: `toWalletEvents(txns): WalletEvent[]` com `key`, `kind`, `orderSn`, `withdrawalId`, `amount`, `fee`, `txnTime`, `transactionType`, `state` (`ready` | `waiting` | `cancelled` | `ignored`).
- Tests: renda COMPLETED vira `income:<sn>` pronta; renda não COMPLETED ignorada; saque CREATED sozinho fica `waiting` com valor; CREATED+COMPLETED vira pronto com valor do CREATED; CANCELLED vira `cancelled`; tipos fora do escopo viram `other` `ignored`.

### Task 3: decisões (puro)
- Produces: `extractShopeeOc(historico)`; `planShopeeBaixa({ credited, escrow }, contas)` → `skip | already_paid | receivable_not_found | divergence(reason, detail) | baixa(receivableId, valorPago, taxa)`; `planWithdrawal(event)` → `divergence | transfer(valor)`.
- Tests: cada regra da spec (refund, net_mismatch, contas, fee_mismatch, baixa), OC alfanumérico, saque com tarifa vira divergência.

### Task 4: estado no banco
- Schema + migração gerada por `pnpm db:generate`; `lib/db/shopee.ts` com `getShopeeCredentials`, `saveShopeeCredentials`, `upsertWalletEvents` (não rebaixa status terminal), `getWalletEventsToProcess`, `updateWalletEvent`, `getWalletEventStats`.
- Verificação: `tsc`, migração revisada à mão.

### Task 5: Olist — caixa e cadastros
- Produces: `createCaixaLancamento(token, { data, historico, valor, tipo, contaId, categoriaId }): Promise<number | undefined>`; `findCaixaLancamentos(token, { historico, contaId, dataInicial, dataFinal })`; `fetchContasFinanceiras(token)`; `fetchCategoriasReceitaDespesa(token)`.
- Tests: corpo do POST (data ISO, `conta.id`, `categoria.id`, valor em centavos arredondado) com `fetch` stubado.

### Task 6: orquestrador + rotas + cron
- `runShopeeReconcile({ dryRun, days })`: sem credencial → skipped; resolve ids Olist por nome (override por env) e falha claro se faltar; coleta carteira → upsert eventos; varre contas a receber da janela e indexa por OC Shopee; para cada evento pronto: renda → escrow → plano → baixa; saque → plano → procura lançamento existente por histórico → cria saída e entrada, gravando cada id; orçamento de tempo; resumo.
- Tests (`lib/__tests__/shopee-reconcile.test.ts`, fetch + db mockados): baixa feliz; divergência não lança; saque cria as duas metades; retomada com saída já criada cria só a entrada; sem credencial → skipped.
- Rotas start/callback/reconcile e workflow.

### Task 7: verificação final
- `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm eslint` nos arquivos novos; commit; PR.
