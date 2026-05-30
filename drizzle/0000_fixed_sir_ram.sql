CREATE TABLE "olist_credentials" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token" text,
	"access_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"olist_id" text PRIMARY KEY NOT NULL,
	"numero_pedido" text DEFAULT '' NOT NULL,
	"numero_nf" text DEFAULT '-' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"produto" text DEFAULT '' NOT NULL,
	"canal" text DEFAULT '' NOT NULL,
	"vendedor" text DEFAULT '' NOT NULL,
	"forma_pagamento" text DEFAULT 'Não informado' NOT NULL,
	"status_pagamento" text DEFAULT 'Pendente' NOT NULL,
	"valor_venda" numeric(14, 2) DEFAULT '0' NOT NULL,
	"valor_frete" numeric(14, 2) DEFAULT '0' NOT NULL,
	"devolucao" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxa_comissao" numeric(14, 2) DEFAULT '0' NOT NULL,
	"custo_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"data" date NOT NULL,
	"situacao" integer,
	"detail_level" text DEFAULT 'summary' NOT NULL,
	"raw" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_costs" (
	"ref" text PRIMARY KEY NOT NULL,
	"custo" numeric(14, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"cursor_data" date,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"status" text,
	"last_error" text,
	"orders_synced" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "orders_data_idx" ON "orders" USING btree ("data");