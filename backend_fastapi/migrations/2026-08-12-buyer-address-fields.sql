-- Migration: structured buyer address fields for the Create-PO buyer form.
-- The web module lets the user enter buyer name, address line 1/2, city,
-- state, PIN code and GST number when creating a PO. billing_address is
-- composed from these on insert so existing documents keep working.
-- Idempotent — safe to re-run.
ALTER TABLE invoice_buyers ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE invoice_buyers ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE invoice_buyers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE invoice_buyers ADD COLUMN IF NOT EXISTS pincode TEXT;
