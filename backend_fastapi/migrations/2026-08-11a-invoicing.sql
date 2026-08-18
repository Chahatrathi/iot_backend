-- Migration: invoicing system for Aracharat Ventures LLP (PO / invoice / CN / DN / register).
-- Mirrors the offline JSON data layer (D:\opencode\invoices) into Postgres so the
-- SUPER_ADMIN web module can read/write it. Orders keep items/milestones/payments/
-- invoices as JSONB — identical shape to the offline orders/*.json files.
-- Run once against the production database, e.g. in pgAdmin4, in filename order.
-- Every statement is idempotent (IF NOT EXISTS), so re-running is harmless.
-- Data seeding happens in 2026-08-11b-invoicing-seed.sql (generated from the offline data).

-- 1. Seller (Aracharat Ventures LLP) — single row, id = 1.
CREATE TABLE IF NOT EXISTS invoice_seller (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    entity_type TEXT,
    llpin TEXT,
    pan TEXT,
    registered_office TEXT,
    state TEXT,
    state_code TEXT,
    email TEXT,
    phone TEXT,
    gst_registered BOOLEAN NOT NULL DEFAULT FALSE,
    gst_levied BOOLEAN NOT NULL DEFAULT FALSE,
    gstin TEXT,
    arn TEXT,
    registration_application_date TEXT,
    gst_rates JSONB NOT NULL DEFAULT '{}'::jsonb,
    bank JSONB NOT NULL DEFAULT '{}'::jsonb,
    jurisdiction TEXT
);

-- 2. Buyers (LCB Fertilizers + future buyers).
CREATE TABLE IF NOT EXISTS invoice_buyers (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    billing_address TEXT,
    delivery_address TEXT,
    state TEXT,
    state_code TEXT,
    gstin TEXT,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT
);

-- 3. Orders (one row per PO; ledger lives in the payments/invoices JSONB arrays).
CREATE TABLE IF NOT EXISTS invoice_orders (
    po_no TEXT PRIMARY KEY,
    po_date TEXT,
    buyer TEXT NOT NULL REFERENCES invoice_buyers (key),
    account TEXT NOT NULL DEFAULT 'hardware',
    goods BOOLEAN NOT NULL DEFAULT TRUE,
    state TEXT NOT NULL DEFAULT 'CREATED',
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
    payments JSONB NOT NULL DEFAULT '[]'::jsonb,
    invoices JSONB NOT NULL DEFAULT '[]'::jsonb,
    freight NUMERIC NOT NULL DEFAULT 0,
    freight_in_rate BOOLEAN NOT NULL DEFAULT FALSE,
    discount NUMERIC NOT NULL DEFAULT 0,
    items_value NUMERIC NOT NULL DEFAULT 0,
    contract_value NUMERIC NOT NULL DEFAULT 0,
    advances_received NUMERIC NOT NULL DEFAULT 0,
    cumulative_billed NUMERIC NOT NULL DEFAULT 0,
    shipping_address JSONB,
    shipping_state_code TEXT,
    place_of_supply TEXT,
    payment_terms TEXT,
    delivery_terms TEXT,
    validity TEXT,
    remarks TEXT,
    e_way_bill JSONB,
    gst_collectable BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_orders_state ON invoice_orders (state);
CREATE INDEX IF NOT EXISTS idx_invoice_orders_buyer ON invoice_orders (buyer);

-- 4. Gapless serial register (one row per financial year / kind / income-tag).
--    allocate_number() bumps last_seq atomically (INSERT ... ON CONFLICT ... RETURNING).
CREATE TABLE IF NOT EXISTS invoice_register (
    fy TEXT NOT NULL,                 -- e.g. '26-27'
    kind TEXT NOT NULL,               -- PO | INV | CN | DN | RV | CMB
    tag TEXT NOT NULL DEFAULT '',     -- SH | SS | CON | FER | '' (untagged series)
    last_seq INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (fy, kind, tag)
);

-- 5. Bank transaction ledger (deposit reconciliation / combined invoices).
CREATE TABLE IF NOT EXISTS invoice_transactions (
    s_no INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    remarks TEXT,
    bank_ref TEXT,
    allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
    combined_invoice TEXT
);
