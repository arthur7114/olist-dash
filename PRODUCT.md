# OEM Parts — Painel comercial

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Gestores e analistas comercial, financeiro e de marketplace da OEM Parts usam o painel para acompanhar vendas, produtos, margens, cancelamentos e devoluções durante a rotina operacional.

## Product Purpose

Consolidar os indicadores da operação e transformar dados de pedidos em decisões verificáveis sobre receita, mix, rentabilidade e evolução dos produtos. Sucesso significa distinguir crescimento real de ruído, explicar diferenças entre bases e permitir priorização sem depender de planilhas ou relatórios estáticos.

## Positioning

O painel cruza a visão operacional da Olist com métricas diretas do Mercado Livre, mantendo explícitas as definições de cada indicador e a origem dos dados.

## Operating Context

- Uso recorrente em desktop, com consulta eventual em telas menores.
- O resumo operacional usa pedidos sincronizados da Olist e filtros globais.
- A evolução de produtos usa dados mensais diretos do Mercado Livre, sincronizados no servidor.
- Comparações históricas usam meses completos no fuso `America/Fortaleza`.

## Capabilities and Constraints

- A base de receita pode ser alternada entre pedidos criados e vendas pagas/elegíveis.
- Vendas pagas são pedidos `paid` ou `confirmed`, sem tags de cancelamento ou devolução.
- Visitas e conversão são indicadores aproximados e podem ficar indisponíveis.
- Segredos e tokens de integrações permanecem exclusivamente no servidor.
- O dashboard deve preservar a distinção entre pedidos, unidades e faturamento.

## Brand Commitments

Preservar o nome e os logotipos OEM Parts, a linguagem direta em português e a identidade visual verde-petróleo já aplicada ao dashboard.

## Evidence on Hand

- Implementação atual do dashboard e seus componentes em `app/(dashboard)` e `components/dashboard`.
- Extração direta do Mercado Livre e relatório executivo em `scripts/mercado_livre_analysis` e `report/`.
- Snapshot reconciliado de janeiro a julho de 2026, incluindo as duas bases de julho.

## Product Principles

- Definições financeiras ficam visíveis e auditáveis.
- Dados parciais nunca são apresentados como meses fechados.
- A interface prioriza comparação e decisão, não ornamentação.
- Falhas de sincronização preservam o último dado válido e indicam sua idade.
- Métricas ausentes aparecem como indisponíveis, nunca como zero inventado.
