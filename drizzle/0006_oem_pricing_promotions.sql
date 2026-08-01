CREATE TABLE "ml_items" (
	"item_id" text PRIMARY KEY NOT NULL,
	"seller_sku" text,
	"title" text DEFAULT '' NOT NULL,
	"category_id" text,
	"listing_type_id" text,
	"currency_id" text DEFAULT 'BRL' NOT NULL,
	"current_price" numeric(16, 2),
	"status" text DEFAULT 'unknown' NOT NULL,
	"shipping_mode" text,
	"logistic_type" text,
	"free_shipping" integer DEFAULT 0 NOT NULL,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ml_items_seller_sku_idx" ON "ml_items" USING btree ("seller_sku");
--> statement-breakpoint
CREATE INDEX "ml_items_status_idx" ON "ml_items" USING btree ("status");
--> statement-breakpoint
CREATE TABLE "ml_promotions" (
	"key" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"promotion_id" text NOT NULL,
	"offer_id" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"original_price" numeric(16, 2),
	"candidate_price" numeric(16, 2),
	"min_price" numeric(16, 2),
	"max_price" numeric(16, 2),
	"suggested_price" numeric(16, 2),
	"fee_reduction" numeric(16, 2) DEFAULT '0' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ml_promotions_item_id_idx" ON "ml_promotions" USING btree ("item_id");
--> statement-breakpoint
CREATE INDEX "ml_promotions_status_idx" ON "ml_promotions" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "ml_promotions_synced_at_idx" ON "ml_promotions" USING btree ("synced_at");
--> statement-breakpoint
WITH order_payloads AS (
	SELECT CASE
		WHEN jsonb_typeof("raw") = 'array' THEN "raw"
		ELSE jsonb_build_array("raw")
	END AS payload
	FROM "ml_order_costs"
	WHERE "raw" IS NOT NULL
), order_rows AS (
	SELECT jsonb_array_elements(payload) AS order_row
	FROM order_payloads
), sold_items AS (
	SELECT item_row->'item'->>'id' AS item_id,
		COALESCE(item_row->>'seller_sku', item_row->'item'->>'seller_sku', item_row->'item'->>'seller_custom_field') AS seller_sku,
		COALESCE(item_row->'item'->>'title', '') AS title,
		COALESCE(item_row->>'listing_type_id', 'unknown') AS listing_type_id
	FROM order_rows
	CROSS JOIN LATERAL jsonb_array_elements(COALESCE(order_row->'order_items', '[]'::jsonb)) AS item_row
)
INSERT INTO "ml_items" ("item_id", "seller_sku", "title", "listing_type_id", "status", "raw")
SELECT DISTINCT ON (item_id) item_id, seller_sku, title, listing_type_id, 'historical', jsonb_build_object('source', 'ml_order_costs_backfill')
FROM sold_items
WHERE item_id ~ '^MLB[0-9]+$'
ORDER BY item_id
ON CONFLICT ("item_id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "pricing_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"tax_rate_bps" integer,
	"ads_rate_bps" integer DEFAULT 0 NOT NULL,
	"fixed_cost" numeric(16, 2) DEFAULT '0' NOT NULL,
	"minimum_margin_bps" integer,
	"target_margin_bps" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_overrides" (
	"item_id" text PRIMARY KEY NOT NULL,
	"seller_sku" text,
	"product_cost" numeric(16, 2),
	"shipping_cost" numeric(16, 2),
	"tax_rate_bps" integer,
	"ads_rate_bps" integer,
	"fixed_cost" numeric(16, 2),
	"minimum_margin_bps" integer,
	"target_margin_bps" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ml_commercial_sync_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"cursor" text,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"items_synced" integer DEFAULT 0 NOT NULL,
	"promotions_synced" integer DEFAULT 0 NOT NULL
);
