CREATE TABLE "ml_order_costs" (
	"ml_order_id" text PRIMARY KEY NOT NULL,
	"olist_id" text NOT NULL,
	"sale_fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"shipping_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"listing_type" text,
	"ml_status" text,
	"raw" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ml_order_costs_olist_id_unique" UNIQUE("olist_id")
);
