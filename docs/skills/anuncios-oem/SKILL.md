---
name: anuncios-oem
description: Cria anúncios novos da OEM Parts no Mercado Livre, nas contas atual e SP, a partir da ficha de cada SKU (código OEM, aplicação, medidas e fotos). Use quando pedirem "anunciar", "subir anúncio", "criar anúncio do SW…", "publicar nas duas contas" ou mandarem uma lista de SKUs novos.
---

# Anúncios novos da OEM Parts

Você opera o conector **OEM anúncios**. A pessoa não é técnica: fale em português comum.

## O que pedir para cada SKU

| Dado | Exemplo | Se faltar |
|---|---|---|
| SKU unitário | SW0888 | não dá para seguir |
| Código OEM original | 904501869R | não dá para seguir |
| Aplicação: marca, modelo, ano inicial (e final) | Peugeot 206 2005 a 2010 | não dá para seguir |
| Comprimento aberto e fechado (cm) | 32 / 21 | pergunte |
| Embalagem da unidade: largura × altura × profundidade (cm) e peso (kg) | 5 × 2 × 36, 0,172 | pergunte |
| Similares Cofap e Nakata | MGC16650 / MG 17365 | a linha sai da descrição |
| 4 fotos (links): carro com 1, carro com o par, medidas, card "Se liga na aplicação" | — | não dá para seguir |

Leia os dados das imagens quando a pessoa mandar o card de aplicação ou de medidas. **Nunca invente** código OEM, similar, medida ou ano. Na dúvida, pergunte.

**Fotos:** imagem colada na conversa serve para você ler os dados, mas não vai para o anúncio. O anúncio precisa do **link** de cada foto, que abra a imagem direto (termina em .jpg, .png ou .webp). Link de pasta do Drive não serve. Se a pessoa só tiver a foto no computador, diga que ela precisa hospedar a imagem antes, e siga com o resto da ficha.

Modelo de pedido que a pessoa pode colar e preencher (os campos entre < > são dela, nunca seus):

```
SKU: <SKU unitário>
OEM: <código OEM original>
Aplicação: <marca> <modelo> <ano inicial> a <ano final ou "em diante">
Aberto <cm>, fechado <cm>
Embalagem <largura> x <altura> x <profundidade> cm, <peso> kg
Cofap <código> / Nakata <código>
Fotos: carro <link> · par <link> · medidas <link> · aplicação <link>
```

## Fluxo

1. `preparar_lote` com as fichas. Pergunte só o que faltou, de uma vez.
2. `gerar_rascunhos`. Mostre a tabela: título, preço, estoque e situação por conta.
3. `publicar` com `confirmar=false`. Isso só valida, não publica nada.
4. Mostre o resultado e espere um "sim" explícito.
5. `publicar` com `confirmar=true`. No primeiro lote do dia, faça um SKU sozinho antes dos outros.
6. `status_lote`: entregue o checklist do Olist Hub.

## Vínculo no Olist Hub (manual)

Para cada anúncio publicado, na Olist da mesma conta:

1. Cadastros > Anúncios > Mercado Livre > gerenciar > "importar anúncios".
2. "Importação por identificador externo", digite o MLB e importe.
3. No menu ⋮ do anúncio: "relacionar produto". Escolha o SKU certo (unitário ou kit PAR).
4. Confira se a coluna "SKU Produto" mostra o SKU.

Não use "relacionar anúncios" em massa: ele cruza pelo título e erra.

## Bloqueios comuns

- **SKU não cadastrado na Olist SP:** o rascunho da conta SP fica bloqueado até alguém cadastrar o produto lá.
- **Título acima de 60 caracteres:** use `ajustar_rascunho` com um título mais curto, sempre com o OEM.
- **"Publicação e sincronização" sem escrita:** quem administra o aplicativo no devcenter do ML precisa liberar. Diga isso em uma frase e pare.
