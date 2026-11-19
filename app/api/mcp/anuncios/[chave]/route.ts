import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { chaveAnunciosValida } from "@/lib/anuncios/chave"
import { criarServidorAnuncios } from "@/lib/mcp/anuncios"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

type Ctx = { params: Promise<{ chave: string }> }

// Conector de anúncios: chave própria (MCP_ANUNCIOS_CHAVE), separada da de promoções, porque este publica.
// Chave errada responde 404, para o endereço não parecer existir.

// Sem sessão: cada requisição sobe um servidor novo (funções serverless não guardam estado).
async function atender(request: Request, ctx: Ctx): Promise<Response> {
  const { chave } = await ctx.params
  if (!chaveAnunciosValida(chave)) return new Response("Not Found", { status: 404 })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  const server = criarServidorAnuncios({ paginaFotos: `${new URL(request.url).origin}/fotos/${chave}` })
  await server.connect(transport)
  return transport.handleRequest(request)
}

export const POST = atender
export const GET = atender
export const DELETE = atender
