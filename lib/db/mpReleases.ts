import { sql } from "drizzle-orm"
import { getDb } from "./client"
import { mpReleases } from "./schema"

export type MpReleaseCandidate = {
  olistId: string
  mlOrderId: string
  data: string
}

// Pedidos ML faturados/enviados/entregues cuja liberação ainda não terminou de
// conciliar: sem linha em mp_releases, com dinheiro ainda pendente, ou liberado
// mas com a baixa não concluída. Pedidos com veredito terminal (baixado, já
// pago, sem pagamento aprovado ou inexistente no ML) saem da fila.
// `situacao in (1,3,4,5,6,7)` = mesmas situações que o dash trata como "Pago"
// (exclui cancelado/2 e "Em aberto"/8).
// Quem já foi verificado nas últimas RECHECK_HOURS fica de fora: é o que faz as
// execuções encadeadas do workflow convergirem para completed=true em vez de
// re-verificar eternamente os pendentes e os sem-conta (pedidos de mai/2026,
// anteriores ao financeiro da Olist, nunca terão conta a receber).
const RECHECK_HOURS = Number(process.env.MP_RECONCILE_RECHECK_HOURS) || 20

export async function getMpReleaseCandidates(
  sinceDate: string,
  limit: number,
): Promise<MpReleaseCandidate[]> {
  const db = getDb()
  const res = await db.execute(sql`
    select o.olist_id as "olistId",
           o.raw->'ecommerce'->>'numeroPedidoEcommerce' as "mlOrderId",
           o.data::text as "data"
    from orders o
    left join mp_releases r on r.olist_id = o.olist_id
    where o.canal ilike 'mercado livre%'
      and o.situacao in (1,3,4,5,6,7)
      and o.data >= ${sinceDate}
      and coalesce(o.raw->'ecommerce'->>'numeroPedidoEcommerce', '') <> ''
      and (
        r.olist_id is null
        or (
          (
            -- 'disputed' volta à fila porque mediação se resolve: quando o
            -- pagamento é aprovado e liberado, a baixa passa a ser devida.
            r.release_status in ('pending', 'disputed')
            or (r.release_status = 'released' and r.baixa_status not in ('done', 'already_paid'))
          )
          and r.checked_at < now() - make_interval(hours => ${RECHECK_HOURS})
        )
      )
    order by r.checked_at asc nulls first, o.data asc
    limit ${limit}
  `)
  return res.rows as unknown as MpReleaseCandidate[]
}

export async function upsertMpRelease(row: {
  olistId: string
  mlOrderId: string
  releaseStatus: string
  releaseDate: Date | null
  amount: number
  receivableId?: number | null
  baixaStatus?: string
  baixaAt?: Date | null
  lastError?: string | null
}): Promise<void> {
  const db = getDb()
  const values = {
    olistId: row.olistId,
    mlOrderId: row.mlOrderId,
    releaseStatus: row.releaseStatus,
    releaseDate: row.releaseDate,
    amount: String(row.amount),
    receivableId: row.receivableId ?? null,
    baixaStatus: row.baixaStatus ?? "pending",
    baixaAt: row.baixaAt ?? null,
    lastError: row.lastError ?? null,
    checkedAt: new Date(),
  }
  await db
    .insert(mpReleases)
    .values(values)
    .onConflictDoUpdate({
      target: mpReleases.olistId,
      set: {
        mlOrderId: sql`excluded.ml_order_id`,
        releaseStatus: sql`excluded.release_status`,
        releaseDate: sql`excluded.release_date`,
        amount: sql`excluded.amount`,
        receivableId: sql`excluded.receivable_id`,
        baixaStatus: sql`excluded.baixa_status`,
        // Preserva o carimbo da baixa já feita (o upsert seguinte não a refaz).
        baixaAt: sql`coalesce(excluded.baixa_at, mp_releases.baixa_at)`,
        lastError: sql`excluded.last_error`,
        checkedAt: sql`excluded.checked_at`,
      },
    })
}

export type MpReconcileStats = {
  total: number
  released: number
  baixados: number
  pendentes: number
}

export async function getMpReleaseStats(sinceDate: string): Promise<MpReconcileStats> {
  const db = getDb()
  const res = await db.execute(sql`
    select count(*)::int as "total",
           count(*) filter (where r.release_status = 'released')::int as "released",
           count(*) filter (where r.baixa_status in ('done', 'already_paid'))::int as "baixados",
           count(*) filter (where r.release_status = 'pending')::int as "pendentes"
    from mp_releases r
    join orders o on o.olist_id = r.olist_id
    where o.data >= ${sinceDate}
  `)
  const row = res.rows[0] as unknown as MpReconcileStats | undefined
  return row ?? { total: 0, released: 0, baixados: 0, pendentes: 0 }
}
