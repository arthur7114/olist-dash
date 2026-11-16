CREATE TABLE IF NOT EXISTS "anuncio_rascunhos" (
	"id" serial PRIMARY KEY NOT NULL,
	"lote" text NOT NULL,
	"familia" text NOT NULL,
	"sku" text NOT NULL,
	"formato" text NOT NULL,
	"conta" text NOT NULL,
	"status" text DEFAULT 'rascunho' NOT NULL,
	"ficha" jsonb NOT NULL,
	"item" jsonb,
	"descricao" text,
	"motivo" text,
	"item_id" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anuncio_rascunhos_unico" ON "anuncio_rascunhos" USING btree ("lote","sku","formato","conta");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "anuncio_rascunhos_lote_idx" ON "anuncio_rascunhos" USING btree ("lote");