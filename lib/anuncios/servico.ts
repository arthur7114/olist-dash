// Orquestra Olist, rascunhos no banco e Mercado Livre para o conector de anúncios.

import { and, eq, inArray } from "drizzle-orm"
import { getDb } from "@/lib/db/client"
import { anuncioRascunhos } from "@/lib/db/schema"
import { mlCredentialStoreFor } from "@/lib/db/mlUserCredentials"
import { getMlUserAccessToken, type MlConta } from "@/lib/ml-user-token"
import { getOlistAccessToken } from "@/lib/olist-token"
import { fetchProductFull, fetchProductIdBySku, updateProductFull, type TinyProductFull } from "@/lib/olist-v3"
import { buildPutBody } from "@/lib/olist-catalog-fill"
import { MOLDES, type Formato, type Molde } from "./molde"
import { checarFicha, embalagemDoFormato, familiasDeVeiculo, lotesDeCompatibilidade, montarDescricao, montarItem, montarTitulo, type Ficha, type ItemMl } from "./montar"
import { adicionarCompatibilidades, contarVeiculos, criarItem, definirDescricao, validarItem } from "./ml"

export const CONTAS: MlConta[] = ["atual", "sp"]
export const FORMATOS: Formato[] = ["unidade", "par"]
export const MAX_POR_PUBLICACAO = 60

export type ProdutoOlist = { id: number; sku: string; gtin: string | null; estoque: number; produto: TinyProductFull }

export function skuDoFormato(molde: Molde, formato: Formato, sku: string): string {
  return `${sku.trim()}${molde.formatos[formato].skuSufixo}`
}

export async function buscarNaOlist(conta: MlConta, sku: string): Promise<ProdutoOlist | null> {
  const token = await getOlistAccessToken(conta)
  const id = await fetchProductIdBySku(token, sku)
  if (!id) return null
  const p = await fetchProductFull(token, id)
  if (p.situacao && p.situacao !== "A") return null
  return { id, sku: p.sku ?? sku, gtin: p.gtin?.trim() || null, estoque: Number(p.estoque?.quantidade ?? 0), produto: p }
}

export function moldeDe(familia = "amortecedor-tampa"): Molde {
  const m = MOLDES[familia]
  if (!m) throw new Error(`Não há molde para a família "${familia}". Existe: ${Object.keys(MOLDES).join(", ")}.`)
  return m
}

export type Preparo = { sku: string; travas: string[]; perguntas: string[]; olist: Record<string, string> }

export async function prepararLote(fichas: Ficha[], familia?: string): Promise<Preparo[]> {
  const molde = moldeDe(familia)
  const out: Preparo[] = []
  for (const ficha of fichas) {
    const { travas, perguntas } = checarFicha(ficha)
    const olist: Record<string, string> = {}
    for (const conta of CONTAS) {
      for (const formato of FORMATOS) {
        const sku = skuDoFormato(molde, formato, ficha.sku)
        try {
          const p = await buscarNaOlist(conta, sku)
          olist[`${conta}/${formato}`] = p ? `${p.estoque} un` : "não cadastrado"
        } catch (e) {
          olist[`${conta}/${formato}`] = `erro: ${e instanceof Error ? e.message.slice(0, 80) : "?"}`
        }
      }
    }
    out.push({ sku: ficha.sku, travas, perguntas, olist })
  }
  return out
}

type Linha = typeof anuncioRascunhos.$inferSelect

export async function gerarRascunhos(lote: string, fichas: Ficha[], familia?: string): Promise<Linha[]> {
  const molde = moldeDe(familia)
  const db = getDb()
  for (const ficha of fichas) {
    const { travas, perguntas } = checarFicha(ficha)
    for (const conta of CONTAS) {
      for (const formato of FORMATOS) {
        const sku = skuDoFormato(molde, formato, ficha.sku)
        let status = "rascunho"
        let motivo: string | null = null
        let item: ItemMl | null = null
        let descricao: string | null = null
        if (travas.length || perguntas.length) {
          status = "bloqueado"
          motivo = `Falta na ficha: ${[...travas, ...perguntas].join("; ")}`
        } else {
          const titulo = montarTitulo(molde, formato, ficha)
          const p = await buscarNaOlist(conta, sku).catch(() => null)
          if (!titulo) {
            status = "bloqueado"
            motivo = "O título não cabe em 60 caracteres com o OEM; ajuste o título à mão."
          } else if (!p) {
            status = "bloqueado"
            motivo = `SKU ${sku} não está cadastrado (ou está inativo) na Olist ${conta === "sp" ? "SP" : "atual"}.`
          } else {
            item = montarItem(molde, formato, ficha, { sku, gtin: p.gtin, estoque: p.estoque }, titulo)
            descricao = montarDescricao(molde, formato, ficha)
            if (p.estoque <= 0) motivo = "Estoque zero na Olist: o anúncio sai sem unidades."
          }
        }
        const values = { lote, familia: molde.familia, sku, formato, conta, status, ficha, item, descricao, motivo, itemId: null, atualizadoEm: new Date() }
        await db
          .insert(anuncioRascunhos)
          .values(values)
          .onConflictDoUpdate({ target: [anuncioRascunhos.lote, anuncioRascunhos.sku, anuncioRascunhos.formato, anuncioRascunhos.conta], set: values })
      }
    }
  }
  return listarLote(lote)
}

export async function listarLote(lote: string): Promise<Linha[]> {
  return getDb().select().from(anuncioRascunhos).where(eq(anuncioRascunhos.lote, lote)).orderBy(anuncioRascunhos.id)
}

export async function lerRascunho(id: number): Promise<Linha | null> {
  const [r] = await getDb().select().from(anuncioRascunhos).where(eq(anuncioRascunhos.id, id)).limit(1)
  return r ?? null
}

export async function ajustarRascunho(id: number, mudanca: { titulo?: string; preco?: number; descricao?: string }): Promise<Linha> {
  const r = await lerRascunho(id)
  if (!r) throw new Error(`Rascunho ${id} não existe.`)
  if (r.status === "publicado") throw new Error("Esse anúncio já foi publicado; mude direto no Mercado Livre.")
  if (!r.item) throw new Error(`Rascunho ${id} está bloqueado: ${r.motivo ?? "sem anúncio montado"}.`)
  const item = { ...(r.item as ItemMl) }
  if (mudanca.titulo !== undefined) {
    if (mudanca.titulo.length > 60) throw new Error("O título passa de 60 caracteres.")
    item.family_name = mudanca.titulo
  }
  if (mudanca.preco !== undefined) item.price = mudanca.preco
  const [novo] = await getDb()
    .update(anuncioRascunhos)
    .set({ item, descricao: mudanca.descricao ?? r.descricao, status: "rascunho", atualizadoEm: new Date() })
    .where(eq(anuncioRascunhos.id, id))
    .returning()
  return novo
}

async function tokenMl(conta: string): Promise<string> {
  const c = conta as MlConta
  return getMlUserAccessToken({ store: mlCredentialStoreFor(c), conta: c })
}

export type ResultadoPublicacao = { id: number; sku: string; formato: string; conta: string; resultado: string; itemId?: string }

// Sem confirmar: só valida no ML (não publica). Com confirmar: valida, publica, descrição,
// compatibilidades e medidas na Olist. Rascunho já publicado nunca é publicado de novo.
export async function publicar(ids: number[], confirmar: boolean): Promise<ResultadoPublicacao[]> {
  if (ids.length > MAX_POR_PUBLICACAO) throw new Error(`No máximo ${MAX_POR_PUBLICACAO} anúncios por vez.`)
  const db = getDb()
  const linhas = await db.select().from(anuncioRascunhos).where(inArray(anuncioRascunhos.id, ids)).orderBy(anuncioRascunhos.id)
  const out: ResultadoPublicacao[] = []
  for (const r of linhas) {
    const base = { id: r.id, sku: r.sku, formato: r.formato, conta: r.conta }
    if (r.status === "publicado") {
      out.push({ ...base, resultado: "já publicado", itemId: r.itemId ?? undefined })
      continue
    }
    if (!r.item || r.status === "bloqueado") {
      out.push({ ...base, resultado: `bloqueado: ${r.motivo ?? "sem anúncio montado"}` })
      continue
    }
    const set = (v: Partial<Linha>) => db.update(anuncioRascunhos).set({ ...v, atualizadoEm: new Date() }).where(eq(anuncioRascunhos.id, r.id))
    try {
      const token = await tokenMl(r.conta)
      const item = r.item as ItemMl
      const v = await validarItem(token, item)
      if (!v.ok) {
        await set({ status: "erro", motivo: v.erros.join("; ") })
        out.push({ ...base, resultado: `recusado na validação: ${v.erros.join("; ")}` })
        continue
      }
      if (!confirmar) {
        await set({ status: "validado", motivo: null })
        out.push({ ...base, resultado: "validado (não publicado)" })
        continue
      }
      const itemId = await criarItem(token, item)
      await set({ status: "publicado", itemId, motivo: null })
      const pendencias = await completarPublicacao(token, itemId, r)
      if (pendencias.length) await set({ motivo: pendencias.join("; ") })
      out.push({ ...base, itemId, resultado: pendencias.length ? `publicado, com pendência: ${pendencias.join("; ")}` : "publicado" })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await set({ status: "erro", motivo: msg })
      out.push({ ...base, resultado: `erro: ${msg}` })
    }
  }
  return out
}

// Depois do POST: descrição, compatibilidades e medidas na Olist. Falha aqui não desfaz o anúncio.
async function completarPublicacao(token: string, itemId: string, r: Linha): Promise<string[]> {
  const pend: string[] = []
  const molde = moldeDe(r.familia)
  const formato = r.formato as Formato
  const ficha = r.ficha as Ficha
  if (r.descricao) await definirDescricao(token, itemId, r.descricao).catch((e) => pend.push(`descrição: ${(e as Error).message}`))
  try {
    const familias = []
    for (const f of familiasDeVeiculo(ficha.aplicacoes)) familias.push({ ...f, veiculos: await contarVeiculos(token, f) })
    const lotes = lotesDeCompatibilidade(familias)
    if (!lotes.length) pend.push("compatibilidades: nenhum veículo encontrado no catálogo do ML para a aplicação")
    for (const l of lotes) await adicionarCompatibilidades(token, itemId, l, molde.formatos[formato].posicao)
  } catch (e) {
    pend.push(`compatibilidades: ${(e as Error).message}`)
  }
  if (formato === "unidade") {
    await gravarMedidasOlist(r.conta as MlConta, r.sku, ficha).catch((e) => pend.push(`medidas na Olist: ${(e as Error).message}`))
  }
  return pend
}

// Só preenche medidas vazias no produto unitário da Olist da mesma conta.
async function gravarMedidasOlist(conta: MlConta, sku: string, ficha: Ficha): Promise<void> {
  const p = await buscarNaOlist(conta, sku)
  if (!p) return
  const d = p.produto.dimensoes ?? {}
  const emb = embalagemDoFormato("unidade", ficha)
  const vazio = (n: unknown) => !(Number(n) > 0)
  if (![d.largura, d.altura, d.comprimento, d.pesoBruto].some(vazio)) return
  const body = buildPutBody(p.produto, {
    dimensoes: { largura: emb.larguraCm, altura: emb.alturaCm, comprimento: emb.comprimentoCm, pesoBruto: emb.pesoKg },
  })
  const dims = (body.dimensoes ?? {}) as Record<string, unknown>
  if (vazio(dims.pesoLiquido)) dims.pesoLiquido = emb.pesoKg
  body.dimensoes = dims
  await updateProductFull(await getOlistAccessToken(conta), p.id, body)
}

export async function rascunhosPorStatus(lote: string, status: string[]): Promise<Linha[]> {
  return getDb()
    .select()
    .from(anuncioRascunhos)
    .where(and(eq(anuncioRascunhos.lote, lote), inArray(anuncioRascunhos.status, status)))
    .orderBy(anuncioRascunhos.id)
}
