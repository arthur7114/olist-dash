ALTER TABLE "pricing_overrides" RENAME COLUMN "item_id" TO "key";
--> statement-breakpoint
ALTER TABLE "pricing_overrides" ADD COLUMN "scope" text DEFAULT 'item' NOT NULL;
--> statement-breakpoint
ALTER TABLE "pricing_overrides" ADD COLUMN "item_id" text;
--> statement-breakpoint
UPDATE "pricing_overrides"
SET "item_id" = "key",
    "key" = 'item:' || "key";
