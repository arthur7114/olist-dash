# Extensão OEM de Precificação e Promoções do Mercado Livre

**Data:** 2026-08-01
**Status:** aprovado para implementação

## Objetivo

Permitir que a equipe interna da OEM Parts descubra o preço mínimo e o preço-alvo de cada anúncio e avalie promoções do Mercado Livre antes de aceitá-las. A solução é composta por uma central no OEM Dash e uma extensão Manifest V3 para Chrome e Edge. A v1 é estritamente de leitura e recomendação: não altera preços e não ingressa ou remove anúncios de promoções.

## Escopo funcional

- Calculadora por anúncio/SKU com preço atual, preço simulado, preço mínimo, preço-alvo e decomposição financeira.
- Central de promoções candidatas, programadas e ativas, comparando margem atual e promocional.
- Configurações organizacionais de imposto, Ads, custo variável, margem mínima e margem-alvo, com overrides por anúncio/SKU.
- Injeção das recomendações nas telas de promoções e gestão de preços do Mercado Livre.
- Atualização comercial agendada e atualização sob demanda dos itens visíveis.
- Autenticação interna por chave compartilhada, rotacionável e nunca incluída no bundle.

Ficam fora da v1: margens nas telas de vendas, mensagens com IA, multicontas, billing, SaaS e qualquer escrita no Mercado Livre.

## Regras de recomendação

- **Recomendado:** margem de contribuição positiva e margem percentual maior ou igual à meta.
- **Revisar:** contribuição positiva e margem entre o mínimo e a meta.
- **Evitar:** contribuição não positiva ou margem abaixo do mínimo.
- **Dados incompletos:** falta custo de produto, tarifa, frete ou configuração obrigatória; o sistema explica o problema e não recomenda.

Configurações obrigatórias: imposto padrão, margem mínima e margem-alvo. Ads e custo variável fixo começam em zero, mas sempre aparecem na composição. Dados monetários trafegam em centavos e percentuais em basis points.

## Cálculo

```text
Receita do vendedor
− tarifa projetada
+ redução explícita de tarifa financiada pelo Mercado Livre
− frete projetado do vendedor
− custo do produto
− imposto
− Ads
− custo variável fixo
= margem de contribuição
```

Subsídios só entram quando retornados explicitamente pela API do Mercado Livre. Cada componente informa origem e horário. Promoções com dados essenciais acima de 24 horas ficam visíveis, mas bloqueadas para recomendação até atualização.

## Arquitetura

- Next.js atual permanece na raiz e concentra banco, integrações e motor financeiro.
- `apps/extension` contém a extensão React/TypeScript com Vite e Manifest V3.
- `packages/contracts` contém contratos Zod compartilhados.
- Neon/Postgres recebe catálogo, promoções, configurações, overrides e estado da sincronização.
- A extensão identifica anúncios na página, consulta a API OEM e renderiza componentes isolados em Shadow DOM. Ela não conhece credenciais do Mercado Livre nem regras financeiras.

Fontes: preço vigente em `/items/{item_id}/sale_price`; tarifa em `/sites/MLB/listing_prices`; frete em `/users/{seller_id}/shipping_options/free`; promoções em `/seller-promotions`.

## Segurança

Rotas da extensão usam `Authorization: Bearer EXTENSION_API_KEY` com comparação em tempo constante. A chave é informada nas opções e persistida em `chrome.storage.local`. Rotas de sincronização global continuam protegidas por `OLIST_SYNC_SECRET`. Respostas financeiras usam `Cache-Control: no-store`; nenhum dado pessoal de compradores é necessário ou retornado.

## Critérios de aceite

- Item sem custo explica a ausência e não recebe recomendação.
- Tarifa e frete projetados são conferidos em pelo menos 20 anúncios antes da publicação.
- A extensão não faz chamadas de escrita ao Mercado Livre.
- Componentes não duplicam após navegação SPA e não degradam a interface hospedeira.
- Chrome e Edge exibem os mesmos valores.
- A versão final passa em testes, typecheck, build do dashboard e build da extensão.
