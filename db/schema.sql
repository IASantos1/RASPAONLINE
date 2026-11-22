CREATE TABLE IF NOT EXISTS scratch_issues (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode = 'DEMO'),
  model TEXT NOT NULL CHECK (model IN ('sorte', 'cofre', 'semana', 'fortuna')),
  price_eur NUMERIC(8,2) NOT NULL CHECK (price_eur > 0),
  ticket_count INTEGER NOT NULL CHECK (ticket_count = 1000),
  batch_size INTEGER NOT NULL CHECK (batch_size = 100),
  target_rtp_percent NUMERIC(5,2) NOT NULL CHECK (target_rtp_percent = 40),
  sales_cents BIGINT NOT NULL,
  prizes_cents BIGINT NOT NULL,
  actual_rtp_percent NUMERIC(8,4) NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  manifest_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scratch_batches (
  issue_id TEXT NOT NULL REFERENCES scratch_issues(id),
  batch_number INTEGER NOT NULL CHECK (batch_number BETWEEN 1 AND 10),
  first_ticket INTEGER NOT NULL,
  last_ticket INTEGER NOT NULL,
  ticket_count INTEGER NOT NULL CHECK (ticket_count = 100),
  winning_tickets INTEGER NOT NULL,
  sales_cents BIGINT NOT NULL,
  prizes_cents BIGINT NOT NULL,
  PRIMARY KEY (issue_id, batch_number)
);

CREATE TABLE IF NOT EXISTS scratch_tickets (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES scratch_issues(id),
  model TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  batch_number INTEGER NOT NULL,
  grid JSONB NOT NULL,
  prize_multiplier INTEGER NOT NULL,
  prize_cents BIGINT NOT NULL,
  winning_symbol_id TEXT,
  ticket_hash CHAR(64) NOT NULL,
  revealed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (issue_id, batch_number)
    REFERENCES scratch_batches(issue_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_scratch_issues_created_at
  ON scratch_issues (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scratch_tickets_issue_batch
  ON scratch_tickets (issue_id, batch_number);

-- Resultados e metadados de emissão são imutáveis após a criação.
CREATE OR REPLACE FUNCTION raspaonline_reject_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registos de emissão são imutáveis.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scratch_issues_immutable ON scratch_issues;
CREATE TRIGGER trg_scratch_issues_immutable
BEFORE UPDATE OR DELETE ON scratch_issues
FOR EACH ROW EXECUTE FUNCTION raspaonline_reject_mutation();

DROP TRIGGER IF EXISTS trg_scratch_batches_immutable ON scratch_batches;
CREATE TRIGGER trg_scratch_batches_immutable
BEFORE UPDATE OR DELETE ON scratch_batches
FOR EACH ROW EXECUTE FUNCTION raspaonline_reject_mutation();

CREATE OR REPLACE FUNCTION raspaonline_protect_ticket_result()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bilhetes não podem ser apagados.';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.issue_id IS DISTINCT FROM OLD.issue_id
     OR NEW.model IS DISTINCT FROM OLD.model
     OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
     OR NEW.batch_number IS DISTINCT FROM OLD.batch_number
     OR NEW.grid IS DISTINCT FROM OLD.grid
     OR NEW.prize_multiplier IS DISTINCT FROM OLD.prize_multiplier
     OR NEW.prize_cents IS DISTINCT FROM OLD.prize_cents
     OR NEW.winning_symbol_id IS DISTINCT FROM OLD.winning_symbol_id
     OR NEW.ticket_hash IS DISTINCT FROM OLD.ticket_hash
     OR (OLD.revealed_at IS NOT NULL AND NEW.revealed_at IS DISTINCT FROM OLD.revealed_at) THEN
    RAISE EXCEPTION 'Resultado do bilhete é imutável.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scratch_tickets_immutable ON scratch_tickets;
CREATE TRIGGER trg_scratch_tickets_immutable
BEFORE UPDATE OR DELETE ON scratch_tickets
FOR EACH ROW EXECUTE FUNCTION raspaonline_protect_ticket_result();

-- Carteiras e contas exclusivamente demonstrativas.
CREATE TABLE IF NOT EXISTS demo_wallet_users (
  id UUID PRIMARY KEY,
  display_name VARCHAR(40) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS demo_wallets (
  user_id UUID PRIMARY KEY REFERENCES demo_wallet_users(id),
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS demo_wallet_transactions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES demo_wallet_users(id),
  type TEXT NOT NULL CHECK (type IN ('demo_credit', 'ticket_purchase', 'prize_credit')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents <> 0),
  balance_after_cents BIGINT NOT NULL CHECK (balance_after_cents >= 0),
  reference_id TEXT,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_wallet_transactions_user_created
  ON demo_wallet_transactions(user_id, created_at DESC);

-- A venda é registada à parte para preservar a imutabilidade do resultado pré-gerado.
CREATE TABLE IF NOT EXISTS demo_ticket_sales (
  ticket_id TEXT PRIMARY KEY REFERENCES scratch_tickets(id),
  user_id UUID NOT NULL REFERENCES demo_wallet_users(id),
  purchase_price_cents BIGINT NOT NULL CHECK (purchase_price_cents > 0),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demo_ticket_sales_user
  ON demo_ticket_sales(user_id, purchased_at DESC);

CREATE OR REPLACE FUNCTION raspaonline_reject_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registos financeiros demo são append-only.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_demo_wallet_transactions_append_only ON demo_wallet_transactions;
CREATE TRIGGER trg_demo_wallet_transactions_append_only
BEFORE UPDATE OR DELETE ON demo_wallet_transactions
FOR EACH ROW EXECUTE FUNCTION raspaonline_reject_append_only();

DROP TRIGGER IF EXISTS trg_demo_ticket_sales_append_only ON demo_ticket_sales;
CREATE TRIGGER trg_demo_ticket_sales_append_only
BEFORE UPDATE OR DELETE ON demo_ticket_sales
FOR EACH ROW EXECUTE FUNCTION raspaonline_reject_append_only();

