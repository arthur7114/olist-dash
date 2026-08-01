CREATE TABLE "ml_product_evolution_sync_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"cursor_month" text,
	"covered_months" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "ml_product_monthly_metrics" (
	"month" date NOT NULL,
	"product_key" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_orders" integer DEFAULT 0 NOT NULL,
	"created_units" integer DEFAULT 0 NOT NULL,
	"created_revenue" numeric(16, 2) DEFAULT '0' NOT NULL,
	"paid_orders" integer DEFAULT 0 NOT NULL,
	"paid_units" integer DEFAULT 0 NOT NULL,
	"paid_revenue" numeric(16, 2) DEFAULT '0' NOT NULL,
	"visits" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ml_product_monthly_metrics_month_product_key_pk" PRIMARY KEY("month","product_key")
);
--> statement-breakpoint
CREATE INDEX "ml_product_monthly_metrics_month_idx" ON "ml_product_monthly_metrics" USING btree ("month");