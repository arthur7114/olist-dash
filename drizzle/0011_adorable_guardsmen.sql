ALTER TABLE "orders" ADD COLUMN "data_nota" date;--> statement-breakpoint
CREATE INDEX "orders_data_nota_idx" ON "orders" USING btree ("data_nota");--> statement-breakpoint
DELETE FROM "product_costs"
WHERE "ref" IN ('id:348319234', 'sku:416101R100 / KAC1180');--> statement-breakpoint
UPDATE "order_items"
SET "custo_unitario" = '152.54'
WHERE "sku" = '416101R100 / KAC1180';--> statement-breakpoint
UPDATE "orders" AS "o"
SET
	"custo_total" = "recalculated"."custo_total",
	"updated_at" = now()
FROM (
	SELECT
		"olist_id",
		sum("quantidade" * "custo_unitario") AS "custo_total"
	FROM "order_items"
	WHERE "olist_id" IN (
		SELECT "olist_id"
		FROM "order_items"
		WHERE "sku" = '416101R100 / KAC1180'
	)
	GROUP BY "olist_id"
) AS "recalculated"
WHERE "o"."olist_id" = "recalculated"."olist_id";
