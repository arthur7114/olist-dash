-- IF NOT EXISTS: a mesma tabela já foi criada no banco compartilhado pelo preview do
-- primeiro commit deste PR (migração 0012_mixed_blindfold, renumerada depois do merge).
CREATE TABLE IF NOT EXISTS "ml_user_credentials" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"ml_user_id" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token" text NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"scope" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
