ALTER TABLE "mp_releases" ADD COLUMN "net_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mp_releases" ADD COLUMN "fee_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "mp_releases" ADD COLUMN "baixa_scheme" text;--> statement-breakpoint
ALTER TABLE "mp_releases" ADD COLUMN "contas_lancadas_at" timestamp with time zone;