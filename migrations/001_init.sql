-- DVU Trading Dashboard - Initial Postgres schema
-- This schema is optional: the app can run on KV only, but Postgres enables durable history/reporting.

BEGIN;

-- UUID helper
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Bookkeeping for idempotent migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Normalized signal storage (mirrors /api/webhook record fields but in Postgres)
CREATE TABLE IF NOT EXISTS dvu_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- normalized signal
  source TEXT NOT NULL CHECK (source IN ('scanner', 'full')),
  ticker TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  timeframe_minutes INT NOT NULL,
  signal_timestamp TIMESTAMPTZ NOT NULL,
  confluence_score INT NOT NULL,
  confluence_max INT NOT NULL,

  -- decision outcome
  confidence NUMERIC(6, 2) NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('SKIP', 'PAPER', 'EXECUTE')),
  action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL', 'HOLD')),
  instrument_type TEXT NOT NULL CHECK (instrument_type IN ('STOCK', 'CALL', 'PUT')),
  symbol TEXT NOT NULL,
  quantity INT NOT NULL,
  entry_price NUMERIC(18, 6),
  stop_loss NUMERIC(18, 6),
  target1 NUMERIC(18, 6),
  target2 NUMERIC(18, 6),

  status TEXT,
  reason TEXT,

  -- raw payload + full evaluated output for debugging / iteration
  webhook JSONB,
  evaluated JSONB
);

CREATE INDEX IF NOT EXISTS dvu_signals_ticker_ts_idx ON dvu_signals (ticker, signal_timestamp DESC);
CREATE INDEX IF NOT EXISTS dvu_signals_received_at_idx ON dvu_signals (received_at DESC);

-- Execution records (if auto-trading enabled)
CREATE TABLE IF NOT EXISTS dvu_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES dvu_signals(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  broker TEXT NOT NULL DEFAULT 'tradier',
  order_id TEXT,
  order_status TEXT,
  raw JSONB
);

CREATE INDEX IF NOT EXISTS dvu_executions_signal_id_idx ON dvu_executions (signal_id);
CREATE INDEX IF NOT EXISTS dvu_executions_created_at_idx ON dvu_executions (created_at DESC);

-- Daily counters (useful for rate limiting / reporting)
CREATE TABLE IF NOT EXISTS dvu_daily_metrics (
  day DATE PRIMARY KEY,
  signals_total INT NOT NULL DEFAULT 0,
  trades_executed INT NOT NULL DEFAULT 0,
  trades_rejected INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;


