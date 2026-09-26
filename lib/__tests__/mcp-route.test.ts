import { beforeEach, describe, expect, it } from "vitest"
import { POST } from "@/app/api/mcp/[chave]/route"

const CHAVE = "chave-de-teste-bem-comprida"

function rpc(chave: string, body: unknown): [Request, { params: Promise<{ chave: string }> }] {
  const req = new Request(`https://olist-dash.vercel.app/api/mcp/${chave}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  })
  return [req, { params: Promise.resolve({ chave }) }]
}

beforeEach(() => {
  process.env.MCP_CHAVE = CHAVE
})

describe("conector MCP", () => {
  it("com a chave certa, lista as ferramentas de promoção", async () => {
    const res = await POST(...rpc(CHAVE, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }))
    expect(res.status).toBe(200)
    const body = await res.json()
    const nomes = body.result.tools.map((t: { name: string }) => t.name)
    expect(nomes).toEqual(expect.arrayContaining(["listar_campanhas", "avaliar_promocao"]))
  })

  it("com a chave errada, responde como se o endereço não existisse", async () => {
    const res = await POST(...rpc("outra-chave", { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }))
    expect(res.status).toBe(404)
  })
})
