CREATE TABLE "shopee_credentials" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"shop_id" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token" text,
	"access_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopee_wallet_events" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"transaction_type" text NOT NULL,
	"order_sn" text,
	"withdrawal_id" text,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"fee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"txn_time" timestamp with time zone NOT NULL,
	"wallet_state" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"receivable_id" integer,
	"caixa_saida_id" integer,
	"caixa_entrada_id" integer,
	"detail" jsonb,
	"raw" jsonb,
	"last_error" text,
	"done_at" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "shopee_wallet_events_status_idx" ON "shopee_wallet_events" USING btree ("status","kind");