// Cliente do Mercado Livre para anúncios novos. Escrita exige o token de usuário da conta
// com "Publicação e sincronização" em leitura e escrita no aplicativo.

import type { ItemMl, FamiliaVeiculo } from "./montar"

const ML = "https://api.mercadolibre.com"

type Resp = { status: number; data: unknown }

async function mlFetch(token: string, method: string, path: string, body?: unknown, fetchFn: typeof fetch = fetch): Promise<Resp> {
  const r = await fetchFn(`${ML}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  })
  const text = await r.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: r.status, data }
}

type MlErro = { message?: string; error?: string; cause?: Array<{ type?: string; code?: string; message?: string }> }

// Mensagens do ML em uma lista legível: as causas de tipo "error" primeiro, depois a mensagem geral.
export function errosDoMl(data: unknown): string[] {
  const e = (data ?? {}) as MlErro
  const causas = (e.cause ?? []).filter((c) => (c.type ?? "error") === "error").map((c) => c.message ?? c.code ?? "")
  const lista = causas.filter(Boolean)
  if (!lista.length) lista.push(e.message ?? e.error ?? (typeof data === "string" ? data : JSON.stringify(data)))
  return lista
}

function permissao(status: number, data: unknown): string | null {
  const d = (data ?? {}) as { blocked_by?: string }
  if (status === 403 && d.blocked_by === "PolicyAgent") {
    return 'O aplicativo do painel ainda não tem "Publicação e sincronização" em leitura e escrita no Mercado Livre. Mude no devcenter e autorize a conta de novo.'
  }
  return null
}

// O ML devolve 400 mesmo quando só há avisos (ex.: "User has not mode me1" em conta só com Mercado Envios 2).
// Só avisos contam como válido; o primeiro erro de verdade reprova.
export function soAvisos(data: unknown): boolean {
  const causas = ((data ?? {}) as MlErro).cause ?? []
  return causas.length > 0 && causas.every((c) => c.type === "warning")
}

export async function validarItem(
  token: string,
  item: ItemMl,
  fetchFn?: typeof fetch,
): Promise<{ ok: true; avisos: string[] } | { ok: false; erros: string[] }> {
  const r = await mlFetch(token, "POST", "/items/validate", item, fetchFn)
  if (r.status === 204 || r.status === 200) return { ok: true, avisos: [] }
  if (r.status === 400 && soAvisos(r.data)) {
    return { ok: true, avisos: (((r.data ?? {}) as MlErro).cause ?? []).map((c) => c.message ?? c.code ?? "") }
  }
  const p = permissao(r.status, r.data)
  return { ok: false, erros: p ? [p] : errosDoMl(r.data) }
}

export async function criarItem(token: string, item: ItemMl, fetchFn?: typeof fetch): Promise<string> {
  const r = await mlFetch(token, "POST", "/items", item, fetchFn)
  const id = (r.data as { id?: string } | null)?.id
  if ((r.status === 201 || r.status === 200) && id) return id
  throw new Error(permissao(r.status, r.data) ?? `O Mercado Livre recusou o anúncio (HTTP ${r.status}): ${errosDoMl(r.data).join("; ")}`)
}

export async function definirDescricao(token: string, itemId: string, texto: string, fetchFn?: typeof fetch): Promise<void> {
  const r = await mlFetch(token, "POST", `/items/${encodeURIComponent(itemId)}/description`, { plain_text: texto }, fetchFn)
  if (r.status >= 300) throw new Error(`Descrição recusada (HTTP ${r.status}): ${errosDoMl(r.data).join("; ")}`)
}

const atributosFamilia = (f: FamiliaVeiculo) => [
  { id: "BRAND", value_name: f.marca },
  { id: "MODEL", value_name: f.modelo },
  { id: "VEHICLE_YEAR", value_name: String(f.ano) },
]

export async function contarVeiculos(token: string, f: FamiliaVeiculo, fetchFn?: typeof fetch): Promise<number> {
  const r = await mlFetch(
    token,
    "POST",
    "/catalog_compatibilities/products_search/count_family_products",
    { domain_id: "MLB-CARS_AND_VANS", attributes: atributosFamilia(f) },
    fetchFn,
  )
  if (r.status >= 300) throw new Error(`Busca de veículos falhou (HTTP ${r.status}): ${errosDoMl(r.data).join("; ")}`)
  return Number((r.data as { count?: number } | null)?.count ?? 0)
}

export async function adicionarCompatibilidades(
  token: string,
  itemId: string,
  familias: FamiliaVeiculo[],
  posicao: { valueId: string; valueName: string } | null,
  fetchFn?: typeof fetch,
): Promise<number> {
  const restrictions = posicao
    ? [{ attribute_id: "POSITION", attribute_values: [{ values: [{ value_id: posicao.valueId, value_name: posicao.valueName }] }] }]
    : undefined
  const body = {
    products_families: familias.map((f) => ({
      domain_id: "MLB-CARS_AND_VANS",
      creation_source: "DEFAULT",
      attributes: atributosFamilia(f),
      ...(restrictions ? { restrictions } : {}),
    })),
  }
  const r = await mlFetch(token, "POST", `/items/${encodeURIComponent(itemId)}/compatibilities`, body, fetchFn)
  if (r.status >= 300) throw new Error(`Compatibilidades recusadas (HTTP ${r.status}): ${errosDoMl(r.data).join("; ")}`)
  return Number((r.data as { created_compatibilities_count?: number } | null)?.created_compatibilities_count ?? 0)
}
