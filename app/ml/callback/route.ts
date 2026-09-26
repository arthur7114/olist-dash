import { cookies } from "next/headers"
import { mlCredentialStore } from "@/lib/db/mlUserCredentials"
import { ML_STATE_COOKIE, completeMlAuthorization, mlRedirectUri } from "@/lib/ml-user-token"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Retorno do login do Mercado Livre (URI cadastrada no devcenter). Quem chega aqui é
// quem clicou em Autorizar, então a resposta é uma página em português, não JSON.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const erro = url.searchParams.get("error")
  const cookieStore = await cookies()
  const expected = cookieStore.get(ML_STATE_COOKIE)?.value

  if (erro) return pagina(false, "A autorização foi cancelada na tela do Mercado Livre.")
  if (!code) return pagina(false, "O Mercado Livre não devolveu o código de autorização.")
  if (!expected || url.searchParams.get("state") !== expected) {
    return pagina(false, "Esse link de retorno é de outra tentativa ou expirou. Comece de novo pelo botão Autorizar.")
  }

  try {
    await completeMlAuthorization({ code, redirectUri: mlRedirectUri(), store: mlCredentialStore })
  } catch (e) {
    console.error("Falha ao concluir autorização do Mercado Livre:", e)
    return pagina(false, e instanceof Error ? e.message : "Não foi possível concluir a autorização.")
  }
  cookieStore.delete(ML_STATE_COOKIE)
  return pagina(true, "O painel já pode alterar promoções no Mercado Livre. A autorização se renova sozinha.")
}

function pagina(ok: boolean, texto: string): Response {
  const titulo = ok ? "Tudo certo" : "Não deu certo"
  const cor = ok ? "#00a650" : "#e04b4b"
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f5f7;font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;padding:16px;box-sizing:border-box}.c{max-width:420px;padding:40px;background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center}.d{width:56px;height:56px;border-radius:50%;background:${cor};margin:0 auto 20px}h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#555}</style><div class=c><div class=d></div><h1>${titulo}</h1><p>${escape(texto)}</p><p style="margin-top:12px">Pode fechar esta aba.</p></div>`
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  })
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
}
