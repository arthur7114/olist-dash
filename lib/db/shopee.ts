import { eq, sql } from "drizzle-orm"
import { getDb } from "./client"
import { shopeeCredentials, shopeeWalletEvents } from "./schema"
import { decryptSecret, encryptSecret } from "@/lib/crypto"
import type { ShopeeToken } from "@/lib/shopee-api"
import type { WalletEvent } from "@/lib/shopee-events"

export type ShopeeEventStatus =
  | "pending"
  | "done"
  | "already_paid"
  | "receivable_not_found"
  | "divergence"
  | "error"
  | "ignored"

export type StoredShopeeCredentials = {
  shopId: number
  refreshToken: string
  accessToken?: string
  accessExpiresAt?: Date
}

export async function getShopeeCredentials(): Promise<StoredShopeeCredentials | null> {
  const [row] = await getDb().select().from(shopeeCredentials).where(eq(shopeeCredentials.id, 1)).limit(1)
  if (!row) return null
  return {
    shopId: Number(row.shopId),
    refreshToken: decryptSecret(row.refreshToken),
    accessToken: row.accessToken ? decryptSecret(row.accessToken) : undefined,
    accessExpiresAt: row.accessExpiresAt ?? undefined,
  }
}

export async function saveShopeeCredentials(shopId: number, token: ShopeeToken): Promise<void> {
  const values = {
    id: 1,
    shopId: String(shopId),
    refreshToken: encryptSecret(token.refreshToken),
    accessToken: encryptSecret(token.accessToken),
    accessExpiresAt: new Date(Date.now() + token.expireIn * 1000),
    updatedAt: new Date(),
  }
  await getDb().insert(shopeeCredentials).values(values).onConflictDoUpdate({ target: shopeeCredentials.id, set: values })
}

// Grava o que a carteira mostrou. Evento já concluído (done) não muda; saque que passou
// de "esperando" a "cancelado" sai da fila.
export async function upsertWalletEvents(events: WalletEvent[]): Promise<void> {
  if (!events.length) return
  const rows = events.map((e) => ({
    key: e.key,
    kind: e.kind,
    transactionType: e.transactionType,
    orderSn: e.orderSn,
    withdrawalId: e.withdrawalId === null ? null : String(e.withdrawalId),
    amount: e.amount.toFixed(2),
    fee: e.fee.toFixed(2),
    txnTime: e.txnTime,
    walletState: e.state,
    status: e.state === "ignored" || e.state === "cancelled" ? "ignored" : "pending",
    raw: e.raw,
  }))
  for (let i = 0; i < rows.length; i += 200) {
    await getDb()
      .insert(shopeeWalletEvents)
      .values(rows.slice(i, i + 200))
      .onConflictDoUpdate({
        target: shopeeWalletEvents.key,
        set: {
          transactionType: sql`excluded.transaction_type`,
          amount: sql`excluded.amount`,
          fee: sql`excluded.fee`,
          txnTime: sql`excluded.txn_time`,
          walletState: sql`excluded.wallet_state`,
          raw: sql`excluded.raw`,
          status: sql`case when excluded.wallet_state = 'cancelled' and ${shopeeWalletEvents.status} = 'pending' then 'ignored' else ${shopeeWalletEvents.status} end`,
        },
        setWhere: sql`${shopeeWalletEvents.status} <> 'done'`,
      })
  }
}

export type WalletEventRow = {
  key: string
  kind: "income" | "withdrawal"
  orderSn: string | null
  withdrawalId: string | null
  amount: number
  fee: number
  txnTime: Date
  walletState: WalletEvent["state"]
  status: ShopeeEventStatus
  receivableId: number | null
  caixaSaidaId: number | null
  caixaEntradaId: number | null
}

export async function getWalletEventsToProcess(limit = 500): Promise<WalletEventRow[]> {
  const res = await getDb().execute(sql`
    select key, kind, order_sn as "orderSn", withdrawal_id as "withdrawalId", amount::float as amount, fee::float as fee,
           txn_time as "txnTime", wallet_state as "walletState", status, receivable_id as "receivableId",
           caixa_saida_id as "caixaSaidaId", caixa_entrada_id as "caixaEntradaId"
    from shopee_wallet_events
    where kind in ('income', 'withdrawal')
      and wallet_state = 'ready'
      and status in ('pending', 'receivable_not_found', 'error')
    order by checked_at asc, txn_time asc
    limit ${limit}
  `)
  return (res.rows as unknown as WalletEventRow[]).map((r) => ({ ...r, txnTime: new Date(r.txnTime) }))
}

export async function updateWalletEvent(
  key: string,
  patch: {
    status?: ShopeeEventStatus
    receivableId?: number | null
    caixaSaidaId?: number | null
    caixaEntradaId?: number | null
    detail?: unknown
    lastError?: string | null
    doneAt?: Date | null
  },
): Promise<void> {
  await getDb()
    .update(shopeeWalletEvents)
    .set({ ...patch, checkedAt: new Date() })
    .where(eq(shopeeWalletEvents.key, key))
}

export async function getWalletEventStats(): Promise<Record<string, number>> {
  const res = await getDb().execute(sql`
    select kind || ':' || status as k, count(*)::int as n from shopee_wallet_events group by 1 order by 1
  `)
  return Object.fromEntries((res.rows as Array<{ k: string; n: number }>).map((r) => [r.k, r.n]))
}
