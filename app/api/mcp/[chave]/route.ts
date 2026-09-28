import { createHash, timingSafeEqual } from "crypto"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { criarServidorMcp } from "@/lib/mcp/servidor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

type Ctx = { params: Promise<{ chave: string }> }

// O endereço do conector carrega a chave (MCP_CHAVE): é o que a pessoa cola no Claude.
// Chave errada responde 404, para o endereço não parecer existir.
function chaveValida(chave: string): boolean {
  const esperada = process.env.MCP_CHAVE
  if (!esperada) return false
  const a = createHash("sha256").update(chave).digest()
  const b = createHash("sha256").update(esperada).digest()
  return timingSafeEqual(a, b)
}

// Sem sessão: cada requisição sobe um servidor novo (funções serverless não guardam estado).
async function atender(request: Request, ctx: Ctx): Promise<Response> {
  const { chave } = await ctx.params
  if (!chaveValida(chave)) return new Response("Not Found", { status: 404 })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  const server = criarServidorMcp()
  await server.connect(transport)
  return transport.handleRequest(request)
}

export const POST = atender
export const GET = atender
export const DELETE = atender
