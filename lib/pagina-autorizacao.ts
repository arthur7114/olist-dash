// Página em português para quem clicou em Autorizar (callbacks do ML e da Olist).
export function paginaAutorizacao(ok: boolean, texto: string): Response {
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
