-- =============================================================================
-- Zain Catering Services - Business Automation Database Schema
-- Simplified Layout without Menu Items and Complex Equipment Inventory tables.
-- =============================================================================

-- Separate schema for n8n's own internal workflow storage
CREATE SCHEMA IF NOT EXISTS n8n_internal;

-- Everything below lives in the default "public" schema = business data.

-- -----------------------------------------------------------------------------
-- CLIENTS
-- -----------------------------------------------------------------------------
CREATE TABLE clients (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(150) NOT NULL,
    phone           VARCHAR(20) NOT NULL UNIQUE,
    whatsapp_number VARCHAR(20),
    email           VARCHAR(150),
    address         TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_order_at   TIMESTAMPTZ
);

CREATE INDEX idx_clients_phone ON clients(phone);

-- -----------------------------------------------------------------------------
-- ORDERS
-- -----------------------------------------------------------------------------
CREATE TABLE orders (
    id             SERIAL PRIMARY KEY,
    order_ref      VARCHAR(30) NOT NULL UNIQUE,       -- e.g. ZC-2026-0001
    client_id      INTEGER NOT NULL REFERENCES clients(id),
    event_date     DATE NOT NULL,
    guest_count    INTEGER NOT NULL CHECK (guest_count > 0),
    venue_address  TEXT,
    notes          TEXT,
    sound_system   VARCHAR(50) NOT NULL DEFAULT 'None', -- Custom Sound System arrangement
    status         VARCHAR(20) NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','pending_pricing','confirmed','completed','cancelled')),
    source         VARCHAR(20) NOT NULL DEFAULT 'client_form'
                   CHECK (source IN ('client_form','internal_form')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at   TIMESTAMPTZ,
    completed_at   TIMESTAMPTZ
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_event_date ON orders(event_date);
CREATE INDEX idx_orders_client ON orders(client_id);

-- -----------------------------------------------------------------------------
-- INVOICES
-- -----------------------------------------------------------------------------
CREATE TABLE invoices (
    id               SERIAL PRIMARY KEY,
    order_id         INTEGER NOT NULL UNIQUE REFERENCES orders(id),
    invoice_number   VARCHAR(30) NOT NULL UNIQUE,   -- e.g. ZC-INV-2026-0001
    subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0,
    total            NUMERIC(12,2) NOT NULL DEFAULT 0,
    paid_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    balance          NUMERIC(12,2) GENERATED ALWAYS AS (total - paid_amount) STORED,
    status           VARCHAR(20) NOT NULL DEFAULT 'unpaid'
                     CHECK (status IN ('unpaid','partial','paid')),
    pdf_url          TEXT,
    issued_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- PAYMENTS
-- -----------------------------------------------------------------------------
CREATE TABLE payments (
    id               SERIAL PRIMARY KEY,
    invoice_id       INTEGER NOT NULL REFERENCES invoices(id),
    amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
    method           VARCHAR(20) CHECK (method IN ('cash','jazzcash','easypaisa','bank','other')),
    paid_at          TIMESTAMPTZ,
    is_promise       BOOLEAN NOT NULL DEFAULT false,
    promised_amount  NUMERIC(12,2),
    promised_date    DATE,
    promise_status   VARCHAR(20) DEFAULT 'pending'
                     CHECK (promise_status IN ('pending','fulfilled','broken') OR promise_status IS NULL),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_promised_date ON payments(promised_date) WHERE is_promise = true;

-- -----------------------------------------------------------------------------
-- REMINDER LOG
-- -----------------------------------------------------------------------------
CREATE TABLE reminder_log (
    id             SERIAL PRIMARY KEY,
    type           VARCHAR(30) NOT NULL CHECK (type IN ('payment_due','promise_due','event_upcoming','reengagement')),
    client_id      INTEGER REFERENCES clients(id),
    order_id       INTEGER REFERENCES orders(id),
    scheduled_for  DATE NOT NULL,
    sent_at        TIMESTAMPTZ,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sent','failed')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reminder_log_scheduled ON reminder_log(scheduled_for, status);

-- -----------------------------------------------------------------------------
-- SYSTEM ERRORS LOG
-- -----------------------------------------------------------------------------
CREATE TABLE system_errors (
    id           SERIAL PRIMARY KEY,
    node_name    VARCHAR(100),
    error_msg    TEXT,
    execution_id VARCHAR(50),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- INVOICE NUMBER SEQUENCE HELPERS
-- -----------------------------------------------------------------------------
CREATE SEQUENCE order_ref_seq START WITH 1;
CREATE SEQUENCE invoice_number_seq START WITH 1;
