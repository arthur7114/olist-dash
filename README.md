# Análise executiva — Mercado Livre

Pipeline de dados **somente leitura** para analisar a conta Mercado Livre entre 01/01/2026 e 31/07/2026, no fuso `America/Fortaleza`. Ela não possui chamadas `POST`, `PUT`, `PATCH` ou `DELETE` contra recursos da conta; o único `POST` possível é a troca OAuth em `/oauth/token` quando o operador optar por renovar um token expirado.

## Entregáveis

Após uma execução com credenciais e custos válidos, o projeto gera:

- `data/raw/`: respostas JSON sanitizadas por endpoint e data; campos pessoais do comprador são removidos antes da gravação.
- `data/processed/`: `dim_products`, `dim_items`, `fact_orders`, `fact_order_items`, `fact_shipments`, `fact_financial_adjustments`, `fact_visits_daily`, `fact_ads_daily`, `fact_product_costs`, `fact_interventions`, `snapshot_reputation` e `snapshot_platinum_status`, em CSV e Parquet.
- `report/executive_report.html`: versão visual executiva.
- `report/executive_report.md`: versão em Markdown.
- `report/charts/`: gráficos PNG.
- `report/mercado_livre_analysis.xlsx`: planilha executiva com gráficos nativos.
- `report/data_quality.md`: resultados dos testes e limitações.

Nenhum desses resultados é gerado com dados fictícios: se custo, Ads, visita ou qualquer campo não estiver disponível, ele fica indisponível e a limitação aparece no relatório.

## Configuração segura

Defina as credenciais no ambiente de execução ou em um gerenciador de segredos. Não as grave em `.env`, CSV, JSON, notebooks, logs ou relatórios.

```sh
export ML_ACCESS_TOKEN='token-de-acesso-temporario'
# Opcional, somente se for necessário renovar o acesso:
export ML_CLIENT_ID='...'
export ML_CLIENT_SECRET='...'
export ML_REFRESH_TOKEN='...'
```

O fluxo oficial é OAuth 2.0 Authorization Code. Access tokens expiram; refresh tokens são rotativos e de uso único. Por isso, para uma rotina recorrente, a renovação deve ser coordenada pelo gerenciador de segredos da infraestrutura. O programa só mantém o token renovado em memória e nunca o imprime ou persiste.

Preencha também os arquivos de entrada antes da análise financeira:

- `data/input/product_costs.csv`: custo unitário e vigência histórica. Sem custo vigente, margem é `indisponível`, nunca zero.
- `data/input/interventions.csv`: preço, estoque, Ads, desconto e mudanças operacionais. O relatório aponta apenas correlações temporais, não causalidade.
- `data/input/platinum_status.json`: transcreva o painel da conta; os gaps da interface são a fonte oficial.
- `data/input/product_mapping.csv`: una diferentes anúncios de um mesmo produto/família quando necessário.

## Execução

Instale os únicos pacotes de runtime da pipeline em um ambiente isolado:

```sh
python3 -m venv .venv-ml
.venv-ml/bin/pip install -r scripts/mercado_livre_analysis/requirements.txt
ML_ACCESS_TOKEN="$ML_ACCESS_TOKEN" .venv-ml/bin/python scripts/mercado_livre_analysis/run_analysis.py --root . --snapshot-date 2026-08-01
.venv-ml/bin/python scripts/mercado_livre_analysis/enhance_executive_report.py --root .
# Análise complementar de cancelamentos/devoluções (Claims/Returns):
.venv-ml/bin/python scripts/mercado_livre_analysis/analyze_cancellations_returns.py --root . --snapshot-date 2026-08-01
.venv-ml/bin/python scripts/mercado_livre_analysis/enhance_executive_report.py --root .
```

Para gerar a planilha, use o runtime de artefatos do Codex. Ele cria gráficos nativos nos separadores `Desempenho mensal`, `Curvas ABC` e `Resumo executivo`:

```sh
# No Codex Desktop, aponte este link ao node_modules informado pelo runtime.
ln -s "$ARTIFACT_NODE_MODULES" scripts/mercado_livre_analysis/node_modules
node scripts/mercado_livre_analysis/build_workbook.mjs .
```

O comando de análise extrai primeiro uma amostra lógica por mês, pagina os pedidos, trata `429` com retry exponencial e deduplica `order_id`. A extração reaproveita JSONs válidos de descontos, envios, custos de envio e visitas, reduzindo chamadas em reexecuções. O segundo comando amplia o HTML/Markdown e gera os gráficos executivos adicionais sem chamar APIs.

O callback de notificações configurado no aplicativo Mercado Livre é somente leitura e responde em:

```text
https://olist-dash.vercel.app/api/ml/notifications
```

## Endpoints utilizados

| Fonte | Endpoint / uso |
|---|---|
| Identidade e reputação | `GET /users/me` |
| Pedidos | `GET /orders/search`, `GET /orders/{order_id}/discounts` |
| Anúncios | `GET /users/{seller_id}/items/search`, `GET /items?ids=` |
| Envios | `GET /shipments/{shipping_id}`, `GET /shipments/{shipping_id}/costs` |
| Visitas | `GET /items/{item_id}/visits/time_window` em janelas sem lacuna de até 150 dias |
| Product Ads | `GET /advertising/advertisers` e `GET /advertising/{site}/advertisers/{id}/product_ads/ads/search`, na janela inclusiva de 90 dias (03/05–31/07) |
| Claims e cancelamentos | `GET /post-purchase/v1/claims/search?order_id=` |
| Devoluções | `GET /post-purchase/v2/claims/{claim_id}/returns` e `GET /post-purchase/v1/claims/{claim_id}/charges/return-cost` |
| Conciliação complementar | `GET /billing/integration/monthly/periods` e `GET /billing/integration/periods/key/{key}/group/ML/details` |

Use pedidos como fonte principal de gestão comercial; faturamento é conciliado como fonte complementar. A API de Ads permite apenas até 90 dias de histórico, portanto janeiro a abril não são reconstruídos para Ads.

## Regras de negócio

- **Produto analítico**: `seller_sku` → `user_product_id` → `parent_item_id` → `item_id`, com sobreposição pelo mapeamento manual.
- **Vendas concretizadas**: pedidos únicos pagos/confirmados, excluindo cancelados/devolvidos quando sinalizados; isso é uma aproximação e deve ser confrontada ao painel Platinum.
- **Taxa de cancelamento**: pedidos com status `cancelled` divididos por todos os pedidos criados na coorte mensal.
- **Taxa de devolução**: pedidos da coorte com processo identificado em Claims/Returns divididos pelas vendas pagas da coorte. Devoluções concluídas e retornos logísticos ao remetente são apresentados separadamente.
- **Receita bruta**: preço realizado × quantidade, antes de taxas e custos.
- **Receita líquida marketplace**: receita bruta menos comissão e frete efetivo do vendedor (e descontos/ajustes disponíveis na conciliação).
- **Margem de contribuição**: receita bruta menos comissão, frete, impostos/custo/embalagem/outros custos variáveis vigentes e ajustes disponíveis. Ads só entra quando a resposta retornar granularidade por produto que permita atribuição sem duplicidade.
- **ABC**: A até 80% acumulado; B até 95%; C até 100%, separadamente por receita, pedidos, unidades e margem.

## Limitações conhecidas

- A API não disponibiliza o número/gap oficial de MercadoLíder Platinum; preencha-o a partir do painel.
- Métricas de Ads e visitas podem ter atribuição/granularidade diferente da de pedidos; conversão é aproximada.
- Um envio compartilhado por pedidos é rateado proporcionalmente à receita bruta do pedido para não duplicar o custo.
- Respostas `206` e campos ausentes ficam registrados no relatório de qualidade.
- A disponibilidade de endpoints de faturamento, descontos, Ads e devoluções depende dos escopos da aplicação.
