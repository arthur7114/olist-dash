CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"olist_id" text NOT NULL,
	"sku" text DEFAULT 'sem-sku' NOT NULL,
	"produto_olist_id" integer,
	"descricao" text DEFAULT '' NOT NULL,
	"quantidade" integer DEFAULT 1 NOT NULL,
	"valor_unitario" numeric(14, 2) DEFAULT '0' NOT NULL,
	"custo_unitario" numeric(14, 2) DEFAULT '0' NOT NULL,
	"data" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "order_items_olist_idx" ON "order_items" USING btree ("olist_id");--> statement-breakpoint
CREATE INDEX "order_items_data_idx" ON "order_items" USING btree ("data");--> statement-breakpoint
CREATE INDEX "order_items_sku_idx" ON "order_items" USING btree ("sku");