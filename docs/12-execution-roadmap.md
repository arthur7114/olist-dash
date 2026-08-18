# Roadmap de Execução

## Estado atual (Fase 1 — implementada)

Implementado o plano em `docs/superpowers/plans/2026-07-04-fase1-margem-ml-skus-devolucoes.md`:

- **Custo real do Mercado Livre**: sync (`/api/ml/sync`) importa tarifa (`sale_fee`) e frete real do vendedor via API do ML, substituindo a estimativa por percentual. Indicador de cobertura na Visão Geral mostra quanto do período já tem dado real.
- **Itens de pedido**: tabela `order_items` (extraída do `raw` da Olist) alimenta análise por SKU, com backfill (`/api/olist/backfill-items`) para o histórico.
- **Correções de base**: encoding das formas de pagamento, status de pagamento derivado da situação (Aprovado = Pago), períodos novos (90d, mês atual, mês anterior, personalizado) com janela de comparação real, variação % real nos KPIs.
- **Páginas novas**: "Produtos e SKUs" (`/produtos`) e "Devoluções" (`/devolucoes`), com KPIs, gráficos, tabela avançada (busca/ordenação/paginação/export CSV) e drawers de detalhe.

- **Conciliação Mercado Pago → Olist**: job diário (`/api/mp/reconcile`, workflow `mp-reconcile.yml`) verifica a liberação do dinheiro dos pedidos ML (`money_release_status` via API do Mercado Pago, mesmo token client_credentials do ML) e dá baixa automática na conta a receber correspondente na Olist (vínculo pelo "OC nº" no histórico da conta). Estado idempotente em `mp_releases`; `?dryRun=1` só relata.

Ver o plano acima para o detalhamento tarefa a tarefa e o backlog priorizado das próximas fases (Qualidade dos Dados, Margem e Rentabilidade, Autenticação, etc.).
