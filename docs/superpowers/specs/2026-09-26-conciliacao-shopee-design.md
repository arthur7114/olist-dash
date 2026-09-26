# Conciliação Shopee → Olist

Data: 2026-09-26. Mesmo desenho da conciliação Mercado Pago (`lib/mp-reconcile.ts`), com a
carteira da Shopee como fonte. Tudo automático; exceções vão para relatório, nada é lançado
na dúvida.

## Objetivo

1. Dinheiro de pedido liberado na carteira Shopee → baixa da conta a receber na Olist, na
   conta financeira **Shopee**, pelo líquido, com a diferença como taxa.
2. Saque da carteira Shopee para o banco → transferência na Olist: saída na conta Shopee,
   entrada na conta Banco do Brasil.

## Pré-requisitos (uma vez, feitos pelo usuário)

| O quê | Onde | Por quê |
|---|---|---|
| App na Shopee Open Platform + autorizar a loja oem_parts | open.shopee.com, depois `/api/shopee/auth/start` | Sem app não há API |
| Conta financeira "Shopee" | Olist, Finanças | API v3 só lista contas |
| Categoria "Transferência entre contas" (fora da DRE) | Olist, Categorias | API v3 só lista categorias |
| Permissão de Caixa no app da Olist + reconectar | Olist, Aplicativos | `GET/POST /caixa` hoje responde 403 |

Env: `SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`, opcional `SHOPEE_API_HOST`
(padrão `https://partner.shopeemobile.com`). Contas e categorias são achadas por nome na Olist
("Shopee", "Banco do Brasil", "VENDAS SHOPEE", "Transferência entre contas"), com override por
env (`OLIST_SHOPEE_CONTA_ID`, `OLIST_SHOPEE_BANCO_CONTA_ID`, `OLIST_SHOPEE_VENDAS_CATEGORIA_ID`,
`OLIST_TRANSFERENCIA_CATEGORIA_ID`). Faltou algum: a execução para com mensagem clara, sem lançar.

## Dados da Shopee (API v2, conferido na doc oficial em 2026-09-26)

- Assinatura HMAC-SHA256 hex com `partner_key`. Base pública: `partner_id + path + timestamp`.
  Base de loja: `partner_id + path + timestamp + access_token + shop_id`.
- Autorização: `/api/v2/shop/auth_partner` → callback com `code` e `shop_id` →
  `POST /api/v2/auth/token/get`. Access token vale 4 h; refresh token vale 30 dias e é de uso
  único (rotaciona a cada refresh: salvar o novo antes de qualquer outra coisa).
- `GET /api/v2/payment/get_wallet_transaction_list`: janela máxima de 15 dias, `page_size` ≤ 100,
  `more` indica próxima página. Tipos usados: `ESCROW_VERIFIED_ADD` (101, renda do pedido),
  `WITHDRAWAL_CREATED` (201), `WITHDRAWAL_COMPLETED` (202), `WITHDRAWAL_CANCELLED` (203).
  Só transações `status = COMPLETED`.
- `GET /api/v2/payment/get_escrow_detail?order_sn=`: `order_income` com `escrow_amount`,
  `escrow_amount_after_adjustment`, `commission_fee`, `service_fee`, `seller_transaction_fee`,
  `order_ams_commission_fee`, `seller_return_refund`, `drc_adjustable_refund`,
  `return_order_sn_list`.

## Casamento com a Olist

A conta a receber da venda Shopee traz o número do pedido Shopee no histórico
("… - OC nº 260921K0XWYY4U") e usa a categoria VENDAS SHOPEE. Uma varredura das contas por
data de emissão, indexada por OC (`indexReceivablesByOc`, já existente), resolve o casamento.

## Regra de baixa (`planShopeeBaixa`, pura, em centavos inteiros)

Na ordem, a primeira que se aplica:

1. Estorno ou devolução (`return_order_sn_list` não vazio, `seller_return_refund` ou
   `drc_adjustable_refund` ≠ 0) → divergência `refund_present`.
2. Valor creditado na carteira ≠ `escrow_amount_after_adjustment` (ou `escrow_amount`) → `net_mismatch`.
3. Contas do pedido: nenhuma → `receivable_not_found` (re-tenta); só pagas → `already_paid`;
   aberta + paga → `duplicate_receivables`; mais de uma aberta → `multiple_open_receivables`;
   aberta + cancelada → `ambiguous_receivables`; saldo ≠ valor → `partial_balance`.
4. Taxa = valor da conta − líquido. Tem que ser ≥ 0 e bater (± R$ 0,01) com as tarifas que a
   Shopee declara: `commission_fee + service_fee + seller_transaction_fee + order_ams_commission_fee`
   → senão `fee_mismatch`, com a composição inteira no relatório.
5. Baixa: `valorPago = líquido`, `taxa`, `contaDestino = Shopee`, `categoria = VENDAS SHOPEE`,
   data = data da transação na carteira.

A regra 4 é deliberadamente estrita: a composição do bruto da Shopee BR (frete, subsídios) só
é conhecida com dados reais. Primeira execução com o app aprovado: `dryRun=1`, conferir as
divergências e, se for o caso, ajustar a fórmula das tarifas com base nelas.

## Saques

- Evento chaveado por `withdrawal_id`. `CREATED` guarda o valor; `COMPLETED` libera o
  lançamento; `CANCELLED` marca `ignored`.
- `transaction_fee > 0` no saque → divergência (não sabemos ainda como a Shopee desconta).
- Dois lançamentos `POST /caixa`: `tipo D` na conta Shopee e `tipo C` no Banco do Brasil,
  categoria de transferência, histórico `Saque Shopee #<withdrawal_id>`, data da conclusão.
- Cada metade é gravada no estado assim que criada. Antes de criar, procura no caixa um
  lançamento com o mesmo histórico na mesma conta (proteção contra queda entre o POST e o
  registro).

## Estado

- `shopee_credentials` (linha única): shop_id, tokens cifrados (`encryptSecret`), expirações.
- `shopee_wallet_events`: chave `income:<order_sn>` ou `withdrawal:<withdrawal_id>` ou
  `other:<tipo>:<create_time>:<amount>`; tipo, valores, data, status
  (`pending | done | already_paid | receivable_not_found | divergence | error | ignored`),
  ids gerados na Olist, detalhe (composição do escrow), último erro.
- Reprocessa só `pending`, `receivable_not_found` e `error`. `done` nunca é tocado de novo.

## Rotina

- `POST /api/shopee/reconcile` (Bearer `OLIST_SYNC_SECRET`, `?dryRun=1`, `?days=`), resumível
  por orçamento de tempo, como a do MP. Sem Shopee conectada: `ok: true, skipped:
  "shopee_nao_conectada"` para o cron não falhar todo dia até o app sair.
- GitHub Actions `shopee-reconcile.yml`, diário às 06:30 (Fortaleza), depois do MP.
- Janela padrão: 30 dias (dois pedaços de 15). O estado evita retrabalho.

## Fora do escopo

Ajustes, Shopee Ads pago com saldo, reembolsos, empréstimo, Pix: registrados como `ignored`
no estado e contados no resumo, sem lançamento. Enquanto ocorrerem, o saldo da conta Shopee
na Olist não bate com a carteira.

As 5 baixas manuais anteriores (agosto e setembro, pelo bruto) ficam como estão: a API não
desfaz baixa.

## Testes

- `planShopeeBaixa`: cada saída da regra.
- Assinatura: vetor fixo (base e HMAC conhecidos).
- Coleta de eventos e plano de saque: puros, com fixtures no formato da doc.
- Rotina com `fetch` stubado: baixa, divergência, saque em duas metades e retomada.
