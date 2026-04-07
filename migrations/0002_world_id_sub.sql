-- Add World ID sub for per-user deduplication
-- Allows detecting and preventing duplicate commitments from same verified user

ALTER TABLE commitments ADD COLUMN world_id_sub TEXT;

-- Unique constraint: one commitment record per (user, domain) pair.
-- WHERE clause excludes NULLs so dev/anonymous submissions don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commitments_domain_world_id_sub
  ON commitments(domain, world_id_sub)
  WHERE world_id_sub IS NOT NULL;
