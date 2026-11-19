"use client"

import { useRef, useState, type DragEvent } from "react"
import { upload } from "@vercel/blob/client"
import { Check, Copy, ImageUp, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { extensaoDoTipo, linhaDeFotos, MAX_FOTO_BYTES, normalizarSku, SLOTS_FOTO, type SlotFoto } from "@/lib/anuncios/fotos"

type Estado =
  | { fase: "vazio" }
  | { fase: "subindo"; pct: number; previa: string }
  | { fase: "pronto"; url: string; previa: string }
  | { fase: "erro"; msg: string }

const VAZIO: Record<SlotFoto, Estado> = {
  carro: { fase: "vazio" },
  carroPar: { fase: "vazio" },
  medidas: { fase: "vazio" },
  aplicacao: { fase: "vazio" },
}

export function FotosUploader({ chave, skuInicial }: { chave: string; skuInicial: string }) {
  const [sku, setSku] = useState(normalizarSku(skuInicial))
  const [fotos, setFotos] = useState<Record<SlotFoto, Estado>>(VAZIO)
  const [copiado, setCopiado] = useState(false)

  const definir = (slot: SlotFoto, e: Estado) => setFotos((f) => ({ ...f, [slot]: e }))

  async function subir(slot: SlotFoto, arquivo: File) {
    const ext = extensaoDoTipo(arquivo.type)
    if (!ext) return definir(slot, { fase: "erro", msg: "Use foto em JPG, PNG ou WEBP." })
    if (arquivo.size > MAX_FOTO_BYTES) return definir(slot, { fase: "erro", msg: "Foto maior que 15 MB." })
    const previa = URL.createObjectURL(arquivo)
    definir(slot, { fase: "subindo", pct: 0, previa })
    try {
      const blob = await upload(`anuncios/${sku}/${slot}.${ext}`, arquivo, {
        access: "public",
        handleUploadUrl: "/api/anuncios/fotos",
        clientPayload: chave,
        onUploadProgress: ({ percentage }) => definir(slot, { fase: "subindo", pct: Math.round(percentage), previa }),
      })
      definir(slot, { fase: "pronto", url: blob.url, previa })
    } catch {
      URL.revokeObjectURL(previa)
      definir(slot, { fase: "erro", msg: "Não consegui subir. Tente de novo." })
    }
  }

  const links = Object.fromEntries(
    SLOTS_FOTO.flatMap((s) => {
      const e = fotos[s.id]
      return e.fase === "pronto" ? [[s.id, e.url]] : []
    }),
  ) as Partial<Record<SlotFoto, string>>
  const prontas = Object.keys(links).length
  const linha = linhaDeFotos(links)

  async function copiar() {
    await navigator.clipboard.writeText(`SKU: ${sku}\n${linha}`)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  function trocarSku(valor: string) {
    const novo = normalizarSku(valor)
    if (novo !== sku && prontas > 0) setFotos(VAZIO)
    setSku(novo)
  }

  const skuOk = sku.length >= 2

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="sku">SKU unitário</Label>
        <Input
          id="sku"
          value={sku}
          onChange={(e) => trocarSku(e.target.value)}
          placeholder="Ex.: SW0888"
          className="max-w-xs font-mono uppercase"
          autoComplete="off"
        />
        {!skuOk && <p className="text-xs text-muted-foreground">Escreva o SKU para liberar as fotos.</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {SLOTS_FOTO.map((s) => (
          <Slot key={s.id} rotulo={s.rotulo} estado={fotos[s.id]} ativo={skuOk} onArquivo={(f) => subir(s.id, f)} />
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">
            Linha para colar na conversa <span className="text-muted-foreground">({prontas} de 4 fotos)</span>
          </p>
          <Button type="button" size="sm" onClick={copiar} disabled={!skuOk || prontas === 0}>
            {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiado ? "Copiado" : "Copiar"}
          </Button>
        </div>
        <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-muted-foreground">
          {`SKU: ${sku || "<SKU>"}\n${linha}`}
        </pre>
        {prontas > 0 && prontas < 4 && (
          <p className="text-xs text-muted-foreground">Faltou foto? Pode copiar assim e mandar o link que faltar depois.</p>
        )}
      </div>
    </div>
  )
}

function Slot({ rotulo, estado, ativo, onArquivo }: { rotulo: string; estado: Estado; ativo: boolean; onArquivo: (f: File) => void }) {
  const entrada = useRef<HTMLInputElement>(null)
  const [sobre, setSobre] = useState(false)
  const ocupado = estado.fase === "subindo"

  function soltar(e: DragEvent) {
    e.preventDefault()
    setSobre(false)
    const f = e.dataTransfer.files?.[0]
    if (f && ativo && !ocupado) onArquivo(f)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-foreground">{rotulo}</span>
      <button
        type="button"
        disabled={!ativo || ocupado}
        onClick={() => entrada.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (ativo) setSobre(true)
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={soltar}
        className={cn(
          "relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground transition-colors",
          ativo && !ocupado && "hover:border-primary hover:text-foreground",
          sobre && "border-primary bg-primary/5",
          !ativo && "cursor-not-allowed opacity-60",
          estado.fase === "erro" && "border-destructive",
        )}
      >
        {(estado.fase === "subindo" || estado.fase === "pronto") && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={estado.previa} alt={rotulo} className="absolute inset-0 h-full w-full object-contain" />
        )}
        {estado.fase === "vazio" && (
          <span className="flex flex-col items-center gap-2 px-4 text-center">
            <ImageUp className="h-6 w-6" />
            Solte a foto aqui ou clique para escolher
          </span>
        )}
        {estado.fase === "subindo" && (
          <span className="relative flex items-center gap-2 rounded-md bg-background/90 px-3 py-1.5 text-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Subindo {estado.pct}%
          </span>
        )}
        {estado.fase === "pronto" && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-xs text-foreground">
            <RotateCcw className="h-3 w-3" /> Trocar
          </span>
        )}
        {estado.fase === "erro" && (
          <span className="flex flex-col items-center gap-2 px-4 text-center text-destructive">
            <TriangleAlert className="h-6 w-6" />
            {estado.msg}
          </span>
        )}
      </button>
      {estado.fase === "pronto" && (
        <a href={estado.url} target="_blank" rel="noreferrer" className="truncate font-mono text-xs text-muted-foreground underline-offset-2 hover:underline">
          {estado.url}
        </a>
      )}
      <input
        ref={entrada}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onArquivo(f)
          e.target.value = ""
        }}
      />
    </div>
  )
}
