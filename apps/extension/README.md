# OEM Precificação ML

Extensão interna Chrome/Edge para exibir avaliações de preço e promoção nas telas comerciais do Mercado Livre. O cálculo permanece no OEM Dash; a extensão só lê o DOM, consulta a API protegida e apresenta o resultado.

## Desenvolvimento

```bash
pnpm --filter @oem/ml-pricing-extension test
pnpm --filter @oem/ml-pricing-extension typecheck
pnpm --filter @oem/ml-pricing-extension build
```

Carregue `apps/extension/dist` em `chrome://extensions` com o modo do desenvolvedor ativado. Na página de opções, configure a URL do OEM Dash e a `EXTENSION_API_KEY`.

A build de produção autoriza `https://olist-dash.vercel.app`; para desenvolvimento, `http://localhost` pode ser autorizado sob demanda. Outros domínios exigem uma build com a origem OEM explicitamente declarada no manifesto.

O backend precisa de `DATABASE_URL`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `OLIST_SYNC_SECRET` e `EXTENSION_API_KEY`. A chave da extensão deve ser longa, aleatória, diferente do segredo de sincronização e configurada também pelos usuários na página de opções.

## Pacote de produção

```bash
pnpm --filter @oem/ml-pricing-extension package
```

O ZIP é criado em `apps/extension/release/`. O build valida Manifest V3, permissões, ausência de source maps e padrões comuns de segredo.

## Limites de segurança

- Não existe chave embutida no bundle.
- A extensão não altera preços nem adere/remove anúncios de promoções.
- O service worker envia apenas requisições à API OEM configurada.
- A única permissão de extensão é `storage`; o acesso de rede é limitado aos domínios declarados no manifesto.
