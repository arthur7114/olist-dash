// Token de USUÁRIO do Mercado Livre (escrita: promoções), guardado num lugar só.
// O dash faz o OAuth (/ml/authorize → /ml/callback) e é o único que renova o token:
// o refresh do ML é de uso único, então renovar em mais de um lugar derruba os outros.

const ML_API_URL = "https://api.mercadolibre.com"
const AUTORIZAR = "https://olist-dash.vercel.app/ml/authorize"
export const ML_STATE_COOKIE = "ml_oauth_state"

export type MlUserCredentials = {
  userId: string
  accessToken: string
  refreshToken: string
  accessExpiresAt: Date
  scope: string | null
}

export type MlCredentialStore = {
  load(): Promise<MlUserCredentials | null>
  save(credentials: MlUserCredentials): Promise<void>
}

export type MlOAuthEnv = { clientId: string; clientSecret: string; sellerId: string }

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  user_id?: number | string
  scope?: string
  error?: string
  message?: string
}

type Deps = {
  store: MlCredentialStore
  fetchFn?: typeof fetch
  env?: MlOAuthEnv
  now?: () => Date
}

async function postToken(params: Record<string, string>, fetchFn: typeof fetch): Promise<{ status: number; data: TokenResponse }> {
  const response = await fetchFn(`${ML_API_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
    cache: "no-store",
  })
  const data = (await response.json().catch(() => ({}))) as TokenResponse
  return { status: response.ok ? response.status : response.status || 500, data }
}

function toCredentials(data: TokenResponse, now: Date, fallbackRefresh?: string): MlUserCredentials {
  return {
    userId: String(data.user_id),
    accessToken: data.access_token!,
    refreshToken: data.refresh_token ?? fallbackRefresh!,
    accessExpiresAt: new Date(now.getTime() + (data.expires_in ?? 21600) * 1000),
    scope: data.scope ?? null,
  }
}

export async function completeMlAuthorization(
  input: Deps & { code: string; redirectUri: string },
): Promise<{ userId: string }> {
  const { code, redirectUri, store, fetchFn = fetch, env = mlOAuthEnv(), now = () => new Date() } = input
  const { status, data } = await postToken(
    { grant_type: "authorization_code", client_id: env.clientId, client_secret: env.clientSecret, code, redirect_uri: redirectUri },
    fetchFn,
  )
  if (!data.access_token || !data.refresh_token) {
    throw new Error(`O Mercado Livre recusou a autorização (HTTP ${status}): ${data.message ?? data.error ?? "sem detalhe"}`)
  }
  const credentials = toCredentials(data, now())
  if (credentials.userId !== env.sellerId) {
    throw new Error("Essa autorização foi feita com outra conta do Mercado Livre. Entre com a conta da loja e tente de novo.")
  }
  await store.save(credentials)
  return { userId: credentials.userId }
}

// Folga para não entregar um token que vence no meio da operação.
const MARGEM_MS = 5 * 60 * 1000

export async function getMlUserAccessToken(input: Deps): Promise<string> {
  const { store, fetchFn = fetch, env = mlOAuthEnv(), now = () => new Date() } = input
  const valido = (c: MlUserCredentials) => c.accessExpiresAt.getTime() > now().getTime() + MARGEM_MS
  const current = await store.load()
  if (!current) throw new Error(`O Mercado Livre ainda não foi autorizado. Abra ${AUTORIZAR} e clique em Autorizar.`)
  if (valido(current)) return current.accessToken

  const { data } = await postToken(
    { grant_type: "refresh_token", client_id: env.clientId, client_secret: env.clientSecret, refresh_token: current.refreshToken },
    fetchFn,
  )
  if (!data.access_token) {
    // Refresh é de uso único: se outra chamada renovou antes, o nosso já foi gasto e o dela está no banco.
    const latest = await store.load()
    if (latest && latest.refreshToken !== current.refreshToken && valido(latest)) return latest.accessToken
    throw new Error(`A autorização do Mercado Livre expirou. Abra ${AUTORIZAR} e clique em Autorizar de novo.`)
  }
  const renewed = toCredentials({ user_id: current.userId, ...data }, now(), current.refreshToken)
  await store.save(renewed)
  return renewed.accessToken
}

// Fixo, não derivado do request: o ML exige exatamente a URI cadastrada no devcenter,
// e deploys de preview têm outro domínio. Localhost não serve (o login do ML devolve 403).
export function mlRedirectUri(): string {
  return process.env.ML_REDIRECT_URI ?? "https://olist-dash.vercel.app/ml/callback"
}

export function mlAuthorizeUrl(state: string, env: Pick<MlOAuthEnv, "clientId"> = mlOAuthEnv()): string {
  const url = new URL("https://auth.mercadolivre.com.br/authorization")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", env.clientId)
  url.searchParams.set("redirect_uri", mlRedirectUri())
  url.searchParams.set("state", state)
  return url.toString()
}

export function mlOAuthEnv(): MlOAuthEnv {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error("ML_CLIENT_ID e ML_CLIENT_SECRET precisam estar configurados.")
  // Conta OEMPARTSOFICIAL: só ela pode ser autorizada, já que /ml/authorize é público.
  return { clientId, clientSecret, sellerId: process.env.ML_SELLER_ID ?? "587857974" }
}
