-- UTM attribution capture for checkout leads.
--
-- Before this migration, /api/checkout-intent persisted only {email, tier,
-- source}. UTM parameters arriving at /pricing (e.g. CLI funnel sends
-- utm_source=cli&utm_campaign=watch-cmd) were stripped at the API boundary —
-- they survived in the browser URL but never reached D1 nor Stripe metadata.
-- That made CLI-driven conversions invisible to attribution.
--
-- After this migration, checkout_leads carries the five standard UTM fields +
-- HTTP referrer, and the worker forwards them to Stripe checkout session
-- metadata[utm_*] so Stripe Dashboard exports + webhook handlers can attribute
-- paid Developer/Pro subs back to the funnel that drove them.
--
-- SQLite ADD COLUMN is non-idempotent: re-running this migration on a database
-- that already has the columns will error with "duplicate column name". That's
-- the expected protection — apply once per environment.

ALTER TABLE checkout_leads ADD COLUMN utm_source TEXT;
ALTER TABLE checkout_leads ADD COLUMN utm_medium TEXT;
ALTER TABLE checkout_leads ADD COLUMN utm_campaign TEXT;
ALTER TABLE checkout_leads ADD COLUMN utm_content TEXT;
ALTER TABLE checkout_leads ADD COLUMN utm_term TEXT;
ALTER TABLE checkout_leads ADD COLUMN referrer TEXT;

CREATE INDEX IF NOT EXISTS idx_checkout_leads_utm_campaign ON checkout_leads(utm_campaign);
CREATE INDEX IF NOT EXISTS idx_checkout_leads_utm_source ON checkout_leads(utm_source);
