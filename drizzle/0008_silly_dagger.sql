CREATE TABLE "mp_releases" (
	"olist_id" text PRIMARY KEY NOT NULL,
	"ml_order_id" text NOT NULL,
	"release_status" text DEFAULT 'unknown' NOT NULL,
	"release_date" timestamp with time zone,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"receivable_id" integer,
	"baixa_status" text DEFAULT 'pending' NOT NULL,
	"baixa_at" timestamp with time zone,
	"last_error" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mp_releases_status_idx" ON "mp_releases" USING btree ("release_status","baixa_status");