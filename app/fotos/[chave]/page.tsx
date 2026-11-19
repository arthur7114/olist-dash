import type { Metadata } from "next"
import Image from "next/image"
import { notFound } from "next/navigation"
import { chaveAnunciosValida } from "@/lib/anuncios/chave"
import { FotosUploader } from "@/components/anuncios/fotos-uploader"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Fotos do anúncio · OEM Parts",
  robots: { index: false, follow: false },
}

type Props = { params: Promise<{ chave: string }>; searchParams: Promise<{ sku?: string }> }

// Página de fotos dos anúncios novos. O endereço leva a chave do conector: errada, responde 404.
export default async function PaginaFotos({ params, searchParams }: Props) {
  const { chave } = await params
  if (!chaveAnunciosValida(chave)) notFound()
  const { sku } = await searchParams

  return (
    <div className="min-h-svh bg-background">
      <header className="flex h-14 items-center gap-3 border-b border-border px-4 md:px-6">
        <Image src="/oem-logo-black.png" alt="OEM Parts" width={88} height={48} priority className="h-7 w-auto object-contain dark:hidden" />
        <Image src="/oem-logo-white.png" alt="OEM Parts" width={88} height={48} priority className="hidden h-7 w-auto object-contain dark:block" />
        <span className="text-sm text-muted-foreground">/ Fotos do anúncio</span>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 md:p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Fotos do anúncio</h1>
          <p className="text-sm text-muted-foreground text-pretty">
            Escreva o SKU, solte as 4 fotos e copie a linha de fotos para a conversa com o Claude. Quem já tem os links pode colar direto na conversa.
          </p>
        </div>
        <FotosUploader chave={chave} skuInicial={sku ?? ""} />
      </main>
    </div>
  )
}
