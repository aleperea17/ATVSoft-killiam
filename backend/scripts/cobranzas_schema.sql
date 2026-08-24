-- Cobranzas v1 — esquema. Idempotente. No borra datos.
-- Ejemplo: psql "$DATABASE_URL" -f backend/scripts/cobranzas_schema.sql
-- En un deploy con Docker: docker compose exec -T postgres psql -U USER -d DB < backend/scripts/cobranzas_schema.sql

ALTER TABLE lead
  ADD COLUMN IF NOT EXISTS precio_contrato DOUBLE PRECISION;

ALTER TABLE lead
  ADD COLUMN IF NOT EXISTS contrato_pendiente BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE lead
  ADD COLUMN IF NOT EXISTS saldo_a_favor DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE lead
  ADD COLUMN IF NOT EXISTS proximo_vencimiento DATE;

ALTER TABLE lead ALTER COLUMN debe DROP NOT NULL;

ALTER TABLE seguimiento_report
  ADD COLUMN IF NOT EXISTS lead_id INTEGER;

CREATE TABLE IF NOT EXISTS lead_payment (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
    monto DOUBLE PRECISION NOT NULL,
    fecha_cobro DATE NOT NULL,
    member_id INTEGER NOT NULL,
    concepto VARCHAR DEFAULT '',
    metodo VARCHAR DEFAULT '',
    comprobante_url VARCHAR DEFAULT '',
    nota VARCHAR DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS idx_lead_payment_user_id ON lead_payment (user_id);
CREATE INDEX IF NOT EXISTS idx_lead_payment_lead_id ON lead_payment (lead_id);
