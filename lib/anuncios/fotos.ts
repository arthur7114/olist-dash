// Fotos que trocam por SKU no anúncio. A página de fotos sobe cada uma para o Vercel Blob
// e devolve o link público, que é o que o Mercado Livre aceita.

export const SLOTS_FOTO = [
  { id: "carro", rotulo: "Carro com 1 amortecedor", curto: "carro" },
  { id: "carroPar", rotulo: "Carro com o par", curto: "par" },
  { id: "medidas", rotulo: "Medidas", curto: "medidas" },
  { id: "aplicacao", rotulo: 'Card "Se liga na aplicação"', curto: "aplicação" },
] as const

export type SlotFoto = (typeof SLOTS_FOTO)[number]["id"]

export const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"]
export const MAX_FOTO_BYTES = 15 * 1024 * 1024

// anuncios/<SKU>/<slot>.<ext>: o caminho é montado no navegador e conferido aqui no servidor.
const CAMINHO = /^anuncios\/[A-Z0-9-]{2,40}\/(carro|carroPar|medidas|aplicacao)\.(jpg|png|webp)$/

export function caminhoFotoValido(caminho: string): boolean {
  return CAMINHO.test(caminho)
}

export function normalizarSku(sku: string): string {
  return sku.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "")
}

export function extensaoDoTipo(tipo: string): "jpg" | "png" | "webp" | null {
  if (tipo === "image/jpeg") return "jpg"
  if (tipo === "image/png") return "png"
  if (tipo === "image/webp") return "webp"
  return null
}

// Linha pronta para colar na ficha, no mesmo formato do modelo do conector.
export function linhaDeFotos(links: Partial<Record<SlotFoto, string>>): string {
  return "Fotos: " + SLOTS_FOTO.map((s) => `${s.curto} ${links[s.id] ?? "<link>"}`).join(" · ")
}
