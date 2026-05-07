-- Endorsements for GitHub repos
-- Verified humans (World ID) can endorse repos once per repo
-- Prevents fake social proof by requiring real World ID ZK proofs

CREATE TABLE IF NOT EXISTS endorsements (
  id TEXT PRIMARY KEY,                              -- nanoid-style hex
  repo_owner TEXT NOT NULL,                         -- GitHub owner (lowercase)
  repo_name TEXT NOT NULL,                          -- GitHub repo name (lowercase)
  world_id_nullifier TEXT NOT NULL,                 -- World ID sub (unique per user per app)
  proof TEXT NOT NULL,                              -- raw World ID JWT for audit
  created_at INTEGER NOT NULL                       -- Unix timestamp
);

-- One endorsement per verified human per repo
CREATE UNIQUE INDEX IF NOT EXISTS idx_endorsements_repo_user
  ON endorsements(repo_owner, repo_name, world_id_nullifier);

-- Fast count lookups per repo
CREATE INDEX IF NOT EXISTS idx_endorsements_repo
  ON endorsements(repo_owner, repo_name);
