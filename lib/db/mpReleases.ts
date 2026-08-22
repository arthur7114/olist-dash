import { sql } from "drizzle-orm"
import { getDb } from "./client"
import { mpReleases } from "./schema"

// Máquina de estados fechada da baixa (persistida como text no Postgres).
export type MpBaixaStatus =
  | "pending"
  | "done"
  | "already_paid"
  | "receivable_not_found"
  | "divergence"
  | "error"

export type MpReleaseCandidate = {
  olistId: string
  mlOrderId: string
  data: string
  // Da raw do pedido: id da NF (fluxo Full usa /notas/{id}/lancar-contas).
  idNotaFiscal: string | null
  // Carimbo de lancar-contas já executado (nunca relançar).
  contasLancadasAt: string | Date | null
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
           o.data::text as "data",
           o.raw->>'idNotaFiscal' as "idNotaFiscal",
           r.contas_lancadas_at as "contasLancadasAt"
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
  netAmount?: number | null
  feeAmount?: number | null
  charges?: unknown
  receivableId?: number | null
  baixaStatus?: MpBaixaStatus
  baixaScheme?: "gross" | "net_fee" | null
  baixaAt?: Date | null
  contasLancadasAt?: Date | null
  lastError?: string | null
}): Promise<void> {
  const db = getDb()
  const values = {
    olistId: row.olistId,
    mlOrderId: row.mlOrderId,
    releaseStatus: row.releaseStatus,
    releaseDate: row.releaseDate,
    amount: String(row.amount),
    netAmount: row.netAmount != null ? String(row.netAmount) : null,
    feeAmount: row.feeAmount != null ? String(row.feeAmount) : null,
    charges: row.charges ?? null,
    receivableId: row.receivableId ?? null,
    baixaStatus: row.baixaStatus ?? "pending",
    baixaScheme: row.baixaScheme ?? null,
    baixaAt: row.baixaAt ?? null,
    contasLancadasAt: row.contasLancadasAt ?? null,
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
        // Último veredito do MP quando calculado; senão preserva o anterior.
        netAmount: sql`coalesce(excluded.net_amount, mp_releases.net_amount)`,
        feeAmount: sql`coalesce(excluded.fee_amount, mp_releases.fee_amount)`,
        charges: sql`coalesce(excluded.charges, mp_releases.charges)`,
        receivableId: sql`excluded.receivable_id`,
        baixaStatus: sql`excluded.baixa_status`,
        baixaScheme: sql`coalesce(excluded.baixa_scheme, mp_releases.baixa_scheme)`,
        // Preserva o carimbo da baixa já feita (o upsert seguinte não a refaz)
        // e o de lancar-contas (nunca relançar as contas da NF).
        baixaAt: sql`coalesce(excluded.baixa_at, mp_releases.baixa_at)`,
        contasLancadasAt: sql`coalesce(excluded.contas_lancadas_at, mp_releases.contas_lancadas_at)`,
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
