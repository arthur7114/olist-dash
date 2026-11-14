# Anúncios novos nas duas contas do Mercado Livre, pelo Claude

Data: 2026-11-14. Status: rascunho para revisão do Arthur.

## Objetivo

A equipe manda uma ficha por SKU (medidas, compatibilidade, fotos) numa conversa
no claude.ai. O Claude gera os anúncios (unitário e par) a partir do molde da
família, mostra os rascunhos, e com o OK publica nas duas contas do Mercado Livre.
Depois grava as medidas na Olist de cada empresa. Ninguém instala nada: o
operador usa o navegador.

Hoje o mesmo trabalho é feito à mão pelo navegador ("Vender um igual" no anúncio
do Argo), um SKU por vez, só na conta atual.

## Decisões já tomadas

| Ponto | Decisão | Por quê |
|---|---|---|
| Onde o operador trabalha | claude.ai no navegador, com skill e conector | o PC da operação não instala o Claude |
| Onde a lógica mora | OEM dash (Vercel), como um conector MCP novo | os tokens do ML e da Olist já moram e renovam aqui; o refresh do ML é de uso único |
| Criar anúncio | direto no ML (`POST /items`) | a API v3 da Olist não tem endpoint de anúncio |
| Vínculo com a Olist | Olist Hub, manual no piloto | sem API; o "relacionar em massa" do Hub cruza pelo título |
| Medidas na Olist | `PUT /produtos/{id}` | já existe em `lib/olist-v3.ts` (`updateProductFull`) |
| Molde | um anúncio modelo por família e formato | é o que o "Vender um igual" faz hoje |
| Olists | uma por empresa, cadastros separados | confirmado pelo Arthur |

## Fora de escopo no piloto

- Vínculo automático no Olist Hub.
- Produtos com variação.
- Famílias além de amortecedor de tampa traseira.
- Tela própria no dash (os endpoints servem a uma tela depois).
- Preço calculado pela regra de margem: o piloto usa o preço do molde
  (R$ 39,90 unitário, R$ 67,45 par).
- ~~Criar o produto na Olist de SP quando ele não existe~~: entra no escopo. Em
  14/11/2026 a Olist de SP (OEM PARTS, CNPJ 69.810.113/0001-59) estava no
  onboarding, sem canal integrado nem produtos importados e sem nenhum
  aplicativo API. O cadastro precisa ser copiado da Olist atual
  (`POST /produtos`), kits PAR incluídos, antes de qualquer vínculo.

## Fluxo

```
Operador no claude.ai: fichas + fotos
  → preparar_lote: valida a ficha e confere o SKU nas duas Olists (GTIN, estoque, kit PAR)
  → o Claude pergunta só o que falta (nunca inventa OEM, medida, ano, similar)
  → gerar_rascunhos: unitário + par × conta, a partir do molde
  → o operador revisa a tabela e ajusta (ajustar_rascunho)
  → publicar (confirmar = true): /items/validate → POST /items → descrição → compatibilidades
  → grava as medidas da embalagem na Olist de cada empresa
  → status_lote: MLBs criados + checklist do vínculo no Hub
```

## Contas

| Slug | Conta ML | ID | Situação em 14/11/2026 |
|---|---|---|---|
| `atual` | OEMPARTSOFICIAL | 587857974 | a que o dash já autoriza |
| `sp` | "OEM PART…" (apelido cortado no cabeçalho) | 3794710843 | 53 anúncios já copiados da conta atual, com os mesmos SKUs (6103, 7041, 5086…) |

Hoje `ml_user_credentials` e `olist_credentials` têm uma linha só (id = 1), e
`mlOAuthEnv()` aceita um único `sellerId` (587857974).

Mudança:

- Tabela `ml_contas` (`slug`, `seller_id`, `apelido`, tokens cifrados,
  `access_expires_at`, `scope`). A linha atual vira `slug = "atual"`. Os
  chamadores de hoje (promoções, extensão) leem `"atual"` sem mudar o comportamento.
- `/ml/authorize?conta=sp` e `/ml/callback` conferem o `seller_id` contra a
  tabela: só autoriza conta cadastrada.
- Tabela `olist_contas` no mesmo molde. `/api/olist/auth/start?conta=sp`.
  Se a Olist exigir um aplicativo por empresa, as credenciais do app ficam em
  env por conta (`OLIST_SP_CLIENT_ID`, `OLIST_SP_CLIENT_SECRET`).
- Renovação continua num lugar só (`getMlUserAccessToken`, `getOlistAccessToken`),
  agora recebendo o `slug`.

## Molde

Tabela `anuncio_moldes`, uma linha por família × formato:

| Campo | Exemplo (amortecedor de tampa, unitário) |
|---|---|
| `familia` | `amortecedor-tampa` |
| `formato` | `unidade` ou `par` |
| `item_modelo` | MLB5184042761 (unitário), MLB5169195009 (par) |
| `titulo` | `Amortecedor Porta Mala Traseira {marca} {modelo} {oem}` (até 60) |
| `bloco_descricao` | as 8 primeiras linhas, com campos |
| `cauda_descricao` | o texto padrão que não muda, lido do modelo |
| `fotos_genericas` | qualidade, produto com logo, "Evite erro na compra" |
| `preco`, `tipo_anuncio` | 39,90 · Clássico |
| `regras` | par: largura × 2, peso × 2; GTIN "não tem"; posição Traseira |

O snapshot do modelo (atributos, cauda da descrição, fotos genéricas) é relido
toda semana por cron. Se o modelo mudar no ML, o molde acompanha.

Mais adiante, o mesmo cron lê todos os anúncios ativos da conta atual (já
sincronizados em `ml_items`) e propõe moldes para famílias novas, pelos mais
vendidos de cada categoria.

## Ficha de entrada

| Campo | Obrigatório | Se faltar |
|---|---|---|
| SKU | sim | trava |
| Código OEM | sim | trava |
| Marca, modelo, ano inicial (e final, se houver) | sim | trava |
| Comprimento aberto e fechado (cm), força (kgf) | sim | o Claude pergunta |
| Embalagem da unidade L × A × P (cm) e peso (kg) | sim | o Claude pergunta |
| Similares Cofap e Nakata | não | a linha sai da descrição |
| Fotos: carro com 1, carro com o par, medidas, aplicação | sim | trava |

Fotos: link da internet (o ML aceita `pictures[].source` por URL) ou upload numa
página do dash (`/anuncios/fotos`, Vercel Blob), que devolve o link.

Lotes e rascunhos ficam em `anuncio_lotes` e `anuncio_rascunhos`
(SKU × formato × conta; status `rascunho → aprovado → publicado → vinculado`, ou `erro`).

## Conector

Rota nova `/api/mcp/anuncios/[chave]`, com chave própria (`MCP_ANUNCIOS_CHAVE`).
É separada do conector de promoções, que continua só consultando. Assim quem só
avalia promoção não ganha poder de publicar.

| Ferramenta | Faz | Escreve? |
|---|---|---|
| `preparar_lote` | valida as fichas, confere o SKU nas duas Olists, lista o que falta | só no banco do dash |
| `gerar_rascunhos` | monta unitário e par por conta a partir do molde | só no banco do dash |
| `ver_rascunho` | mostra o anúncio completo como vai ao ML | não |
| `ajustar_rascunho` | troca um campo de um rascunho | só no banco do dash |
| `publicar` | `/items/validate`, depois publica; exige `confirmar: true`; no máximo 60 anúncios por chamada | ML e Olist |
| `status_lote` | MLBs criados, erros, checklist do Hub | não |

## Skill no claude.ai

Skill `anuncios-oem`, compartilhada na organização. É o roteiro do Samuel em
forma de regra:

- O que pedir para cada SKU, e nunca inventar OEM, similar, medida ou ano.
- O primeiro SKU de cada lote é validado sozinho antes dos outros.
- Sempre mostrar a tabela de rascunhos e esperar o OK antes de `publicar`.
- Depois de publicar, entregar o checklist do Hub: importar pelo MLB,
  "relacionar produto" com o SKU certo (unitário ou kit PAR) e conferir a coluna
  "SKU Produto".

## Compatibilidades

A ficha traz marca, modelo e anos. O conector busca os veículos na API de
compatibilidades do ML e grava como compatibilidade do vendedor
(`POST /items/{id}/compatibilities`). O par recebe a posição Traseira. A
compatibilidade sugerida pelo catálogo do ML só aceita "aplicar 100% ou não"
desde 15/07/2026, então o piloto não depende dela.

## Testes

Unitários (vitest), funções puras:

- título: até 60 caracteres, OEM sempre presente, corte previsível;
- bloco da descrição: com e sem similares;
- embalagem do par: largura e peso dobrados, altura e profundidade iguais;
- validação da ficha: o que trava e o que vira pergunta;
- montagem do payload a partir do snapshot do molde.

Validação real, nesta ordem:

1. `/items/validate` com o SW0888 nas duas contas, sem publicar.
2. Publicar o SW0888 unitário na conta atual e conferir no ML e no Hub.
3. Mesmo SKU na conta SP.
4. Os outros 7 SKUs pendentes em lote.

## Riscos

- **Moderação por duplicidade:** o mesmo texto em duas contas pode ser lido
  como publicação duplicada. Conferir a regra de contas múltiplas do ML antes do
  passo 3; se preciso, variar o título por conta.
- **Fotos da internet:** marca d'água ou foto de outro vendedor pode cair na
  moderação.
- **Multiempresa da Olist:** há relatos de estoque errado via API entre
  empresas. Conferir o estoque das duas no `preparar_lote`.
- **Conector com chave na URL:** quem tiver o endereço publica. Por isso a chave
  é própria, há limite por chamada e a confirmação explícita é obrigatória.

## Perguntas abertas

1. "GIRÃO COMÉRCI…", a conta do roteiro do Samuel, é a razão social da
   OEMPARTSOFICIAL (587857974)? O seletor dele mostra três contas, e a conta SP
   (3794710843) é uma delas.
2. Qual plano do Claude a OEM tem, e quem é o owner? É o owner quem adiciona o
   conector e a skill na organização.
3. A Olist de SP aceita o mesmo aplicativo OAuth ou pede um próprio?
