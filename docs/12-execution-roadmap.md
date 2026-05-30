# Roadmap de Execução

## Progresso Atual
- Implementado retry com exponential backoff na função `tinyFetch` (API Olist/Tiny ERP) para lidar com erros de Rate Limiting (429 Too Many Requests). O delay introduzido ajuda a evitar a falha total no carregamento dos pedidos durante a concorrência alta.

## Arquivos Impactados
- `lib/olist-v3.ts`

## Decisões Tomadas
- Adição de retry automático de até 3 tentativas com atrasos crescentes (2s, 4s, 6s) nas requisições 429 da API da Olist/Tiny.

## Próxima Ação
- Validar se o carregamento da lista de pedidos (`/pedidos`) volta a funcionar normalmente na interface sem retornar erro 429 para o usuário.
