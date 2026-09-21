# Preencher catálogo da Olist a partir dos anúncios do Mercado Livre

Data: 2026-09-19. Status: aprovado em conversa, aguardando revisão da spec.

## Objetivo

Copiar descrição, fotos e medidas/peso dos anúncios ativos do Mercado Livre para
o cadastro de produtos da Olist (Tiny ERP v3), casando por SKU. Só preenche o
que está vazio na Olist. Roda como script de linha de comando, uma vez, com
`--dry-run` para revisar antes de gravar.

## Fora de escopo

- Sobrescrever campo já preenchido na Olist (não existe `--force`).
- Produtos com variação (Olist `tipo` V, `tipoVariacao` P ou V) e anúncios ML
  com `variations`. São listados no relatório como pulados.
- Título, preço, estoque, NCM, GTIN, marca, categoria.
- Qualquer escrita no Mercado Livre. O ML continua somente leitura.
- Rota de API ou botão no dashboard. Se virar rotina, promove-se depois.

## Fontes

| Dado | Origem | Observação |
|---|---|---|
| Lista de anúncios | tabela `ml_items` (`status = active`, `seller_sku` não nulo) | já sincronizada pelo `/api/ml/commercial/sync` |
| Detalhe do anúncio | `GET /items/{id}?include_attributes=all` | precisa do token `client_credentials` (`getMlAccessToken`); sem token o ML devolve 403 |
| Descrição | `GET /items/{id}/description` → `plain_text` | |
| Fotos | `pictures[].secure_url` | ordem do ML, máximo 10 |
| Medidas | atributos `SELLER_PACKAGE_LENGTH/WIDTH/HEIGHT` (cm) e `SELLER_PACKAGE_WEIGHT` (g) | `value_name` vem como `"40 cm"`, `"1800 g"`; parsear número e unidade |
| Produto Olist | `GET /produtos?codigo={sku}&limit=1` depois `GET /produtos/{id}` | detalhe traz `descricaoComplementar`, `dimensoes`, `anexos`, `tipo`, `situacao`, `descricao` |

## Fluxo

1. Carregar candidatos: anúncios ativos de `ml_items` com SKU (`extractSellerSku`
   já existe em `lib/ml-commercial.ts`). Aplicar `--skus` se informado.
2. Para SKU com mais de um anúncio (65 dos 523 hoje): buscar o detalhe de todos
   e escolher o mais completo. Completude = quantidade de blocos presentes
   entre {descrição não vazia, quatro medidas, ao menos uma foto}. Empate:
   maior `sold_quantity`. Empate de novo: `item_id` menor (determinístico).
3. Buscar o produto na Olist por SKU. Pular com motivo quando: não encontrado;
   `situacao` ≠ A; `tipo` V; `tipoVariacao` P ou V; `descricao` ausente
   (o PUT exige `descricao`, então não dá para reenviar o modelo com segurança).
4. Calcular o delta contra o detalhe da Olist:
   - `descricaoComplementar`: só se vazia/nula na Olist e ML tem `plain_text`.
   - `dimensoes.largura`, `.altura`, `.comprimento`, `.pesoBruto`: campo a
     campo, só os que estão nulos ou 0 na Olist e existem no ML.
   - fotos: só se `anexos` estiver vazio e ML tiver ao menos uma.
5. Delta vazio → pular ("nada a fazer"). `--dry-run` → imprimir delta, não gravar.
6. Gravar:
   - Se há delta de descrição ou medidas: `PUT /produtos/{id}` com o corpo =
     modelo devolvido pelo `GET /produtos/{id}` (campos que o
     `AtualizarProdutoRequestModel` aceita) mesclado com o delta.
   - Se há delta de fotos: `POST /produtos/{id}/anexos` com
     `[{url, externo: false}]`. Se responder 4xx, repetir uma vez com
     `externo: true`. 5xx não repete.
7. Relatório: linha por SKU no terminal e CSV em `report/olist-catalogo-<data>.csv`
   com colunas `sku, item_id, olist_id, descricao, medidas, fotos, resultado, motivo`.
   Valores de ação: `preenchido`, `ja_tinha`, `ml_sem_dado`, `erro:<status>`.

## Conversões

- Peso: g → kg com 3 casas (`1800 g` → `1.8`). Se a unidade vier em kg, usa direto.
- Medidas: cm direto. Se vier em mm ou m, converte para cm.
- Descrição: `plain_text` com `\n` → `<br>`; `&`, `<`, `>` escapados antes.
  Sem outro tratamento.
- `pesoLiquido` não é preenchido (o ML só tem peso de embalagem).

## Autenticação

- **ML:** `getMlAccessToken()` (`lib/ml-api.ts`), `client_credentials`.
- **Olist:** `getStoredCredentials()`; usa `accessToken` se `accessExpiresAt`
  estiver a mais de 60 s no futuro; senão `refreshAccessToken` +
  `saveCredentials`. Evita rotacionar o refresh token sem necessidade em cima
  do cron da Vercel, que também refresca.
- Variáveis vêm de `.env.local` via `node --env-file`.

## Erros e limites

- Erro em um SKU (HTTP, timeout, JSON inválido) registra `erro:<status>` e segue.
- Mutação nunca é repetida (regra do `tinyFetch`). A única exceção é a segunda
  tentativa de anexo com `externo: true` após 4xx, que é uma requisição
  diferente, não uma repetição.
- `--limit N` corta a rodada após N SKUs processados.
- Concorrência: ML 4 em paralelo (como `fetchMlItemDetails`); Olist
  sequencial, rate limit do `tinyFetch`.

## Interface de linha de comando

```bash
pnpm tsx --env-file=.env.local scripts/olist-catalogo-do-ml.ts --dry-run --skus 6021,52154367
pnpm tsx --env-file=.env.local scripts/olist-catalogo-do-ml.ts --dry-run
pnpm tsx --env-file=.env.local scripts/olist-catalogo-do-ml.ts
```

Flags: `--dry-run`, `--skus a,b,c`, `--limit N`.

## Mudanças no código existente

- `lib/olist-v3.ts`: exportar `tinyFetch`; adicionar tipos `TinyProductFull`
  (detalhe com `descricao`, `descricaoComplementar`, `tipo`, `situacao`,
  `tipoVariacao`, `dimensoes`, `anexos`, mais os blocos que o PUT aceita) e
  funções `fetchProductBySku`, `fetchProductDetail`, `updateProduct`,
  `addProductAttachments`.
- `lib/ml-api.ts` ou novo `lib/ml-catalog.ts`: `fetchMlItemCatalog(itemId)` que
  devolve `{ description, pictures, dims }` já normalizados.
- Novo `lib/olist-catalog-fill.ts` com as funções puras: `pickBestListing`,
  `parseMlDimension`, `computeDelta`, `descriptionToHtml`, `buildPutBody`.
- Novo `scripts/olist-catalogo-do-ml.ts`: CLI que orquestra.
- `package.json`: `tsx` em devDependencies.

## Testes

Unitários em `lib/__tests__/olist-catalog-fill.test.ts`:

- `pickBestListing`: completude, empate por `sold_quantity`, empate por id.
- `parseMlDimension`: `"1800 g"` → 1.8 kg; `"40 cm"` → 40; `"2 kg"`; `"400 mm"` → 40; valor ausente → undefined.
- `computeDelta`: Olist toda vazia; Olist toda preenchida (delta vazio); mistura
  campo a campo em `dimensoes`; `anexos` com um item bloqueia fotos.
- `descriptionToHtml`: quebras e escape.
- `buildPutBody`: preserva campos do GET, aplica delta, falha sem `descricao`.

Validação real: `--dry-run` em 2 ou 3 SKUs, conferir na Olist, rodar sem
`--dry-run` nos mesmos, conferir de novo, então rodada completa.
