-- Customer.phone was globally unique, but a phone number can legitimately
-- belong to a different real person at a different restaurant. Scope the
-- uniqueness to (restaurantId, phone) instead, matching how the checkout
-- upsert (bill.service.ts / runningOrder.service.ts) already intends to key
-- it. Verified against production data before writing this migration: zero
-- phone numbers are currently shared across more than one restaurantId, so
-- no data backfill/reconciliation is required.
DROP INDEX "Customer_phone_key";

CREATE UNIQUE INDEX "Customer_restaurantId_phone_key" ON "Customer"("restaurantId", "phone");
