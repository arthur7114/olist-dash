import { createHash, timingSafeEqual } from "crypto"

// Chave do conector de anúncios (MCP_ANUNCIOS_CHAVE). Vale também para a página de fotos:
// quem tem o conector já tem o endereço da página, e ninguém de fora sobe arquivo no armazenamento.
export function chaveAnunciosValida(chave: string | null | undefined): boolean {
  const esperada = process.env.MCP_ANUNCIOS_CHAVE
  if (!esperada || !chave) return false
  const a = createHash("sha256").update(chave).digest()
  const b = createHash("sha256").update(esperada).digest()
  return timingSafeEqual(a, b)
}
