import { NextResponse } from "next/server"

export const runtime = "nodejs"

// Callback exigido no cadastro da aplicação Mercado Livre. O endpoint apenas
// confirma o recebimento; não altera anúncios, pedidos, preços, estoque ou Ads.
// Não persistimos nem registramos o corpo para evitar retenção desnecessária.
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (contentLength > 128_000) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 })
  }

  try {
    await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}

export async function GET() {
  return NextResponse.json({ ok: true, mode: "read_only_notification_receiver" })
}
