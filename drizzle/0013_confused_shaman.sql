CREATE TABLE "ml_user_credentials" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"ml_user_id" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"scope" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
