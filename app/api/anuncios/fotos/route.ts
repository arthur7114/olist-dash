import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { chaveAnunciosValida } from "@/lib/anuncios/chave"
import { caminhoFotoValido, MAX_FOTO_BYTES, TIPOS_FOTO } from "@/lib/anuncios/fotos"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// O navegador pede aqui uma autorização curta e sobe a foto direto para o Vercel Blob
// (sem passar pelo limite de 4,5 MB das funções). Só libera com a chave do conector.
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody
  try {
    const resposta = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (caminho, chave) => {
        if (!chaveAnunciosValida(chave)) throw new Error("Endereço da página inválido")
        if (!caminhoFotoValido(caminho)) throw new Error("Nome de arquivo inválido")
        return {
          allowedContentTypes: TIPOS_FOTO,
          maximumSizeInBytes: MAX_FOTO_BYTES,
          addRandomSuffix: true,
        }
      },
    })
    return Response.json(resposta)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Falha ao subir a foto" }, { status: 400 })
  }
}
