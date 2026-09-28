// Conector MCP da OEM Parts: o que a equipe comercial usa pelo Claude (claude.ai / app).
// Cada ferramenta devolve texto pronto para o Claude resumir: conclusão, tabela, alertas.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { listarCampanhas } from "@/lib/promocoes/consultas"
import { avaliarPromocoes } from "@/lib/promocoes/avaliar"
import { rotuloPromocao, type OfertaAvaliada } from "@/lib/promocoes/margem"
import { REGRAS } from "@/lib/promocoes/regras"

const INSTRUCOES = `Você ajuda a equipe comercial da OEM Parts (autopeças no Mercado Livre) a decidir preço e promoções.
Quem conversa com você NÃO é técnico: fale em português comum, nunca em termos como token, API, SQL ou MCP.

Formato de toda resposta, nesta ordem: uma frase com a conclusão; uma tabela curta (no máximo 8 linhas, números à direita); até 3 ações começando com verbo.

Regras de margem de contribuição (MC real = venda − custo − tarifa ML − frete − impostos 6,04%):
- MC ≥ 15%: recomendada. 5% a 15%: só com objetivo escrito, prazo de até 14 dias e aprovação do gestor. Abaixo de 5%: recusar. Sem custo na Olist: bloqueada, peça correção do cadastro.
- Nunca sugira subir o preço de lista para criar desconto (em 20/08/2026 isso derrubou as visitas da conta em 71%).
- Sempre mostre a conta quando falar de margem: preço, custo, tarifa, frete, impostos, MC em R$ e %.
- Promoção se chama pelo nome ("a 9.9", "o Saldão"). Se a pessoa não souber o nome, use listar_campanhas antes de perguntar.
- Antes de recomendar desconto, olhe a coluna de histórico: se o preço cheio rende mais por dia, diga isso.

Por enquanto este conector só CONSULTA. Se pedirem para aceitar ou sair de uma promoção, diga que isso ainda não está disponível por aqui e que deve ser feito no painel do Mercado Livre.`

const brl = (v: number | null) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }))
const pct = (v: number | null, casas = 1) =>
  v == null ? "—" : (v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }) + "%"
const celula = (v: unknown) => String(v ?? "").replace(/\|/g, "/")

function tabela<T>(linhas: T[], colunas: { h: string; f: (r: T) => unknown; direita?: boolean }[]): string {
  const cab = `| ${colunas.map((c) => c.h).join(" | ")} |`
  const sep = `| ${colunas.map((c) => (c.direita ? "---:" : "---")).join(" | ")} |`
  return [cab, sep, ...linhas.map((r) => `| ${colunas.map((c) => celula(c.f(r))).join(" | ")} |`)].join("\n")
}

const texto = (t: string) => ({ content: [{ type: "text" as const, text: t }] })

export function criarServidorMcp(): McpServer {
  const server = new McpServer({ name: "oem-parts", version: "1.0.0" }, { instructions: INSTRUCOES })

  server.registerTool(
    "listar_campanhas",
    {
      title: "Campanhas do Mercado Livre",
      description:
        "Lista as promoções que o Mercado Livre está oferecendo agora para os anúncios da loja, com o nome pelo qual a pessoa pode pedir, quantos anúncios cada uma tem, desconto médio e até quando vale.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const cs = await listarCampanhas()
      if (!cs.length) return texto("O Mercado Livre não está oferecendo nenhuma promoção com preço por anúncio agora.")
      return texto(
        tabela(cs, [
          { h: "Como pedir", f: (c) => rotuloPromocao(c.tipo, c.nome) },
          { h: "Situação", f: (c) => (c.situacao === "candidate" ? "oferecida" : c.situacao === "pending" ? "aguardando início" : c.situacao) },
          { h: "Anúncios", f: (c) => c.anuncios, direita: true },
          { h: "Desconto médio", f: (c) => pct(c.descontoMedio, 0), direita: true },
          { h: "Até", f: (c) => c.fim ?? "—" },
        ]) + '\n\nPara avaliar uma delas, use avaliar_promocao com o nome (ex.: "9.9").',
      )
    },
  )

  server.registerTool(
    "avaliar_promocao",
    {
      title: "Vale entrar na promoção?",
      description:
        'Calcula a margem de contribuição real de cada anúncio no preço proposto pelo Mercado Livre e classifica: recomendada, recomendada com alerta, só com objetivo, recusar ou bloqueada. Filtre pelo nome da campanha ("9.9", "saldão", "cupom"), por SKU ou pelo código do anúncio (MLB...).',
      inputSchema: {
        nome: z.string().optional().describe('Nome da campanha como a pessoa fala, ex.: "9.9", "saldão"'),
        sku: z.string().optional().describe("SKU do produto na Olist"),
        anuncio: z.string().optional().describe("Código do anúncio, ex.: MLB1234567890"),
        limite: z.number().int().min(1).max(50).optional().describe("Quantas linhas mostrar (padrão 15)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ nome, sku, anuncio, limite }) => {
      const r = await avaliarPromocoes({ nome, sku, itemId: anuncio })
      if (!r.ofertas.length) {
        if (r.semPrecoPorAnuncio.length) {
          return texto(
            `Existe "${nome}", mas o Mercado Livre não propõe um preço por anúncio nela (é cupom ou campanha de carrinho), então não dá para calcular a margem item a item:\n` +
              r.semPrecoPorAnuncio.map((s) => `- ${s.rotulo}: ${s.anuncios} anúncios`).join("\n") +
              "\nEssa decisão se toma no painel do Mercado Livre, olhando a margem média da loja.",
          )
        }
        return texto(nome ? `Nenhuma promoção chamada "${nome}" agora. Use listar_campanhas para ver o que existe.` : "Nenhuma promoção encontrada para esse filtro.")
      }
      const n = limite ?? 15
      const resumo = Object.entries(r.resumo).map(([k, v]) => `${v} ${k}`).join(" · ")
      const linhas = r.ofertas.slice(0, n)
      return texto(
        `${r.ofertas.length} ofertas avaliadas: ${resumo}.\n` +
          `Regra: MC ≥ ${pct(REGRAS.patamares.saudavel, 0)} recomendada · ${pct(REGRAS.patamares.estrategico, 0)} a ${pct(REGRAS.patamares.saudavel, 0)} só com objetivo · abaixo de ${pct(REGRAS.patamares.estrategico, 0)} recusar · sem custo bloqueada.\n\n` +
          tabela<OfertaAvaliada>(linhas, [
            { h: "Classificação", f: (o) => o.classe },
            { h: "SKU", f: (o) => o.sku ?? "—" },
            { h: "Anúncio", f: (o) => `${o.titulo.slice(0, 40)} (${o.itemId})` },
            { h: "Promoção", f: (o) => o.promocao },
            { h: "Preço atual", f: (o) => brl(o.precoAtual), direita: true },
            { h: "Preço promo", f: (o) => brl(o.precoPromo), direita: true },
            { h: "Desc.", f: (o) => pct(o.desconto, 0), direita: true },
            { h: "Custo", f: (o) => brl(o.custo), direita: true },
            { h: "Tarifa", f: (o) => pct(o.tarifaPct), direita: true },
            { h: "Frete", f: (o) => brl(o.frete), direita: true },
            { h: "MC atual", f: (o) => pct(o.mcAtualPct), direita: true },
            { h: "MC promo", f: (o) => pct(o.mcPromoPct), direita: true },
            { h: "MC R$/un", f: (o) => brl(o.mcPromo), direita: true },
            { h: "Estoque", f: (o) => o.estoque ?? "—", direita: true },
            { h: "Histórico nesta faixa", f: (o) => o.historico },
            { h: "Motivo / alertas", f: (o) => o.motivo },
            { h: "Até", f: (o) => o.fim ?? "—" },
          ]) +
          (r.ofertas.length > n ? `\n\nMostrando ${n} de ${r.ofertas.length}, das melhores para as piores. Peça mais linhas ou filtre por nome ou SKU.` : "") +
          "\n\nImpostos: 6,04% sobre a venda. Tarifa e frete reais do produto quando há 3+ vendas em 90 dias; senão, a tabela padrão.",
      )
    },
  )

  return server
}
