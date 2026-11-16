// Conector de anúncios novos (claude.ai): ficha do SKU → rascunhos → validação → publicação
// nas duas contas do Mercado Livre. Separado do conector de promoções, que só consulta.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { ItemMl } from "@/lib/anuncios/montar"
import { ajustarRascunho, gerarRascunhos, lerRascunho, listarLote, MAX_POR_PUBLICACAO, prepararLote, publicar } from "@/lib/anuncios/servico"

const INSTRUCOES = `Você cria anúncios novos de autopeças da OEM Parts no Mercado Livre, nas duas contas (atual e SP).
Quem conversa com você NÃO é técnico: fale em português comum, nunca em token, API ou MCP.

Regras que não se quebram:
- Nunca invente código OEM, similares (Cofap, Nakata), medidas ou anos. Esses dados vêm da pessoa ou das imagens que ela mandar. Faltou, pergunte.
- Fluxo: preparar_lote → responder o que faltar → gerar_rascunhos → mostrar a tabela → publicar SEM confirmar (só valida) → mostrar o resultado → só com um "sim" explícito, publicar com confirmar=true.
- No primeiro lote do dia, valide e publique um SKU sozinho antes dos outros.
- Depois de publicar, entregue o checklist do Olist Hub de status_lote: importar cada anúncio pelo código MLB e "relacionar produto" com o SKU certo (unitário ou kit PAR). Não use "relacionar anúncios" em massa: ele cruza pelo título.

Quando a pessoa disser que quer anunciar um SKU e não mandar os dados, mostre este modelo para ela preencher (os campos entre < > são dela, nunca seus):
SKU: <SKU unitário>
OEM: <código OEM original>
Aplicação: <marca> <modelo> <ano inicial> a <ano final ou "em diante">
Aberto <cm>, fechado <cm>
Embalagem da unidade <largura> x <altura> x <profundidade> cm, <peso> kg
Cofap <código> / Nakata <código> (se tiver)
Fotos: carro com 1 <link> · carro com o par <link> · medidas <link> · aplicação <link>

Fotos: imagem colada na conversa serve para você ler os dados (OEM, medidas, similares), mas não vai para o anúncio. O anúncio precisa do link de cada foto, que abra a imagem direto (.jpg, .png ou .webp). Link de pasta do Drive não serve.

Rascunho da conta SP bloqueado por "SKU não cadastrado na Olist SP" é esperado enquanto o cadastro da Olist SP não for copiado: siga só com a conta atual.
O aviso "User has not mode me1" é do frete e não impede publicar.

Formato de toda resposta: uma frase com a conclusão; uma tabela curta; até 3 ações começando com verbo.`

const texto = (t: string) => ({ content: [{ type: "text" as const, text: t }] })
const celula = (v: unknown) => String(v ?? "").replace(/\|/g, "/").replace(/\n/g, " ")
function tabela(cab: string[], linhas: unknown[][]): string {
  return [`| ${cab.join(" | ")} |`, `| ${cab.map(() => "---").join(" | ")} |`, ...linhas.map((l) => `| ${l.map(celula).join(" | ")} |`)].join("\n")
}
const brl = (n: number | undefined) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }))
const contaNome = (c: string) => (c === "sp" ? "SP" : "atual")

const fichaSchema = z.object({
  sku: z.string().describe("SKU do produto unitário na Olist, ex.: SW0888"),
  oem: z.string().describe("Código OEM original, como está na imagem ou na fala da pessoa"),
  aplicacoes: z
    .array(z.object({ marca: z.string(), modelo: z.string(), anoInicio: z.number().int(), anoFim: z.number().int().nullish() }))
    .describe("Veículos: marca, modelo, ano inicial e, se houver, ano final"),
  comprimentoAbertoCm: z.number().nullish(),
  comprimentoFechadoCm: z.number().nullish(),
  forcaKgf: z.number().nullish(),
  embalagem: z
    .object({ larguraCm: z.number().nullish(), alturaCm: z.number().nullish(), comprimentoCm: z.number().nullish(), pesoKg: z.number().nullish() })
    .nullish()
    .describe("Embalagem da UNIDADE; o par é calculado"),
  similares: z.object({ cofap: z.string().nullish(), nakata: z.string().nullish() }).nullish(),
  fotos: z
    .object({ carro: z.string().nullish(), carroPar: z.string().nullish(), medidas: z.string().nullish(), aplicacao: z.string().nullish() })
    .nullish()
    .describe("Links públicos das 4 fotos que trocam por SKU"),
})

export function criarServidorAnuncios(): McpServer {
  const server = new McpServer({ name: "oem-anuncios", version: "1.0.0" }, { instructions: INSTRUCOES })

  server.registerTool(
    "preparar_lote",
    {
      title: "Conferir fichas antes de gerar",
      description: "Confere cada ficha (o que trava, o que perguntar) e se o SKU unitário e o kit PAR existem nas duas Olists, com estoque. Não grava nada.",
      inputSchema: { fichas: z.array(fichaSchema).min(1).max(30) },
      annotations: { readOnlyHint: true },
    },
    async ({ fichas }) => {
      const r = await prepararLote(fichas)
      return texto(
        tabela(
          ["SKU", "Trava", "Perguntar", "Olist atual (un / par)", "Olist SP (un / par)"],
          r.map((p) => [
            p.sku,
            p.travas.join("; ") || "—",
            p.perguntas.join("; ") || "—",
            `${p.olist["atual/unidade"]} / ${p.olist["atual/par"]}`,
            `${p.olist["sp/unidade"]} / ${p.olist["sp/par"]}`,
          ]),
        ) + "\n\nSKU sem cadastro numa Olist fica bloqueado naquela conta até ser cadastrado lá.",
      )
    },
  )

  server.registerTool(
    "gerar_rascunhos",
    {
      title: "Gerar rascunhos",
      description: "Monta unitário e par para as duas contas a partir do molde (amortecedor da tampa traseira) e guarda como rascunho. Gerar de novo no mesmo lote substitui o rascunho. Não publica.",
      inputSchema: { lote: z.string().optional().describe("Nome do lote; padrão: data de hoje"), fichas: z.array(fichaSchema).min(1).max(30) },
    },
    async ({ lote, fichas }) => {
      const nome = lote?.trim() || new Date().toISOString().slice(0, 10)
      const linhas = await gerarRascunhos(nome, fichas)
      return texto(
        `Lote ${nome}: ${linhas.length} rascunhos.\n\n` +
          tabela(
            ["Id", "SKU", "Conta", "Título", "Preço", "Estoque", "Situação"],
            linhas.map((l) => {
              const it = l.item as ItemMl | null
              return [l.id, l.sku, contaNome(l.conta), it?.family_name ?? "—", brl(it?.price), it?.available_quantity ?? "—", l.motivo ? `${l.status}: ${l.motivo}` : l.status]
            }),
          ) +
          "\n\nPara ver um anúncio inteiro, use ver_rascunho. Para validar sem publicar, use publicar com confirmar=false.",
      )
    },
  )

  server.registerTool(
    "ver_rascunho",
    {
      title: "Ver um rascunho inteiro",
      description: "Mostra título, preço, estoque, atributos, fotos, descrição e veículos de um rascunho, como vão ao Mercado Livre.",
      inputSchema: { id: z.number().int() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const r = await lerRascunho(id)
      if (!r) return texto(`Não existe rascunho ${id}.`)
      const it = r.item as ItemMl | null
      if (!it) return texto(`Rascunho ${id} (${r.sku}, conta ${contaNome(r.conta)}) está bloqueado: ${r.motivo}`)
      return texto(
        [
          `**${it.family_name}** · ${brl(it.price)} · ${it.available_quantity} un · conta ${contaNome(r.conta)} · ${r.status}${r.itemId ? ` · ${r.itemId}` : ""}`,
          r.motivo ? `Aviso: ${r.motivo}` : "",
          tabela(["Atributo", "Valor"], it.attributes.map((a) => [a.id, a.value_name])),
          `Fotos (${it.pictures.length}): ${it.pictures.map((p, i) => `[${i + 1}](${p.source})`).join(" ")}`,
          "Descrição:\n```\n" + (r.descricao ?? "") + "\n```",
        ]
          .filter(Boolean)
          .join("\n\n"),
      )
    },
  )

  server.registerTool(
    "ajustar_rascunho",
    {
      title: "Ajustar um rascunho",
      description: "Troca título (até 60 caracteres, com o OEM), preço ou descrição de um rascunho ainda não publicado. Volta o status para rascunho.",
      inputSchema: { id: z.number().int(), titulo: z.string().optional(), preco: z.number().positive().optional(), descricao: z.string().optional() },
    },
    async ({ id, titulo, preco, descricao }) => {
      const r = await ajustarRascunho(id, { titulo, preco, descricao })
      const it = r.item as ItemMl
      return texto(`Rascunho ${id} ajustado: ${it.family_name} · ${brl(it.price)}. Valide de novo antes de publicar.`)
    },
  )

  server.registerTool(
    "publicar",
    {
      title: "Validar ou publicar",
      description: `Com confirmar=false (padrão) só valida no Mercado Livre, sem publicar. Com confirmar=true publica, grava descrição e veículos e preenche as medidas vazias na Olist. Use confirmar=true só depois de um "sim" explícito da pessoa. Até ${MAX_POR_PUBLICACAO} por vez.`,
      inputSchema: { ids: z.array(z.number().int()).min(1).max(MAX_POR_PUBLICACAO), confirmar: z.boolean().default(false) },
      annotations: { destructiveHint: true },
    },
    async ({ ids, confirmar }) => {
      const r = await publicar(ids, confirmar)
      return texto(
        (confirmar ? "Publicação:" : "Validação (nada foi publicado):") +
          "\n\n" +
          tabela(["Id", "SKU", "Conta", "Resultado", "Anúncio"], r.map((x) => [x.id, x.sku, contaNome(x.conta), x.resultado, x.itemId ?? "—"])),
      )
    },
  )

  server.registerTool(
    "status_lote",
    {
      title: "Situação do lote e checklist do Hub",
      description: "Lista os rascunhos de um lote com status e código MLB, e o checklist de vínculo no Olist Hub para os publicados.",
      inputSchema: { lote: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ lote }) => {
      const linhas = await listarLote(lote)
      if (!linhas.length) return texto(`Não há rascunhos no lote ${lote}.`)
      const pub = linhas.filter((l) => l.status === "publicado" && l.itemId)
      const hub = pub.length
        ? "\n\n**Vincular no Olist Hub** (Cadastros > Anúncios > Mercado Livre > importar anúncios > Importação por identificador externo):\n" +
          pub.map((l) => `- [ ] Olist ${contaNome(l.conta)}: importar ${l.itemId} e relacionar com o produto ${l.sku}`).join("\n")
        : ""
      return texto(tabela(["Id", "SKU", "Conta", "Status", "Anúncio", "Aviso"], linhas.map((l) => [l.id, l.sku, contaNome(l.conta), l.status, l.itemId ?? "—", l.motivo ?? "—"])) + hub)
    },
  )

  return server
}
