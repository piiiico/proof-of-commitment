import { Database } from "bun:sqlite";

const DB_PATH = process.env.DB_PATH ?? "data/poc.sqlite";

let db: Database;

export function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH, { create: true });
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    migrate(db);
  }
  return db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS commitments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      world_id_sub TEXT,
      visit_count INTEGER NOT NULL,
      total_seconds INTEGER NOT NULL,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_commitments_domain
      ON commitments(domain);

    -- Unique per (domain, world_id_sub) — NULLs excluded so anonymous dev
    -- submissions never conflict with each other.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_commitments_domain_world_id_sub
      ON commitments(domain, world_id_sub)
      WHERE world_id_sub IS NOT NULL;

    -- Materialized aggregate view: updated on each insert via trigger
    CREATE TABLE IF NOT EXISTS domain_stats (
      domain TEXT PRIMARY KEY,
      unique_commitments INTEGER NOT NULL DEFAULT 0,
      total_visits INTEGER NOT NULL DEFAULT 0,
      total_seconds INTEGER NOT NULL DEFAULT 0,
      avg_visits REAL NOT NULL DEFAULT 0,
      avg_seconds REAL NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Trigger to keep domain_stats in sync on new inserts
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_update_domain_stats
    AFTER INSERT ON commitments
    BEGIN
      INSERT INTO domain_stats (domain, unique_commitments, total_visits, total_seconds, avg_visits, avg_seconds, last_updated)
      VALUES (
        NEW.domain,
        1,
        NEW.visit_count,
        NEW.total_seconds,
        NEW.visit_count,
        NEW.total_seconds,
        datetime('now')
      )
      ON CONFLICT(domain) DO UPDATE SET
        unique_commitments = unique_commitments + 1,
        total_visits = total_visits + NEW.visit_count,
        total_seconds = total_seconds + NEW.total_seconds,
        avg_visits = CAST((total_visits + NEW.visit_count) AS REAL) / (unique_commitments + 1),
        avg_seconds = CAST((total_seconds + NEW.total_seconds) AS REAL) / (unique_commitments + 1),
        last_updated = datetime('now');
    END;
  `);
}

// ── Queries ──

export interface Commitment {
  domain: string;
  visitCount: number;
  totalSeconds: number;
  firstSeen: number;
  lastSeen: number;
}

export function insertCommitment(c: Commitment, worldIdSub?: string | null): void {
  const db = getDb();
  if (worldIdSub) {
    // Check if (domain, world_id_sub) already exists → upsert
    const existing = db.query(
      `SELECT id FROM commitments WHERE domain = ? AND world_id_sub = ? LIMIT 1`
    ).get(c.domain, worldIdSub) as { id: number } | null;

    if (existing) {
      // Update existing record — same user re-submitting. Trigger does NOT fire
      // so domain_stats.unique_commitments stays correct.
      db.run(
        `UPDATE commitments
         SET visit_count = ?, total_seconds = ?,
             first_seen = MIN(first_seen, ?),
             last_seen = MAX(last_seen, ?)
         WHERE domain = ? AND world_id_sub = ?`,
        [c.visitCount, c.totalSeconds, c.firstSeen, c.lastSeen, c.domain, worldIdSub]
      );
      return;
    }

    // New commitment — include world_id_sub; trigger updates domain_stats
    db.run(
      `INSERT INTO commitments (domain, world_id_sub, visit_count, total_seconds, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [c.domain, worldIdSub, c.visitCount, c.totalSeconds, c.firstSeen, c.lastSeen]
    );
  } else {
    // Anonymous insert (dev / no auth) — no deduplication, trigger fires
    db.run(
      `INSERT INTO commitments (domain, visit_count, total_seconds, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?)`,
      [c.domain, c.visitCount, c.totalSeconds, c.firstSeen, c.lastSeen]
    );
  }
}

export interface DomainStats {
  domain: string;
  uniqueCommitments: number;
  totalVisits: number;
  totalSeconds: number;
  avgVisits: number;
  avgSeconds: number;
  lastUpdated: string;
}

export function getDomainStats(domain: string): DomainStats | null {
  const db = getDb();
  const row = db.query(
    `SELECT domain, unique_commitments, total_visits, total_seconds,
            avg_visits, avg_seconds, last_updated
     FROM domain_stats WHERE domain = ?`
  ).get(domain) as Record<string, unknown> | null;

  if (!row) return null;

  return {
    domain: row.domain as string,
    uniqueCommitments: row.unique_commitments as number,
    totalVisits: row.total_visits as number,
    totalSeconds: row.total_seconds as number,
    avgVisits: row.avg_visits as number,
    avgSeconds: row.avg_seconds as number,
    lastUpdated: row.last_updated as string,
  };
}
