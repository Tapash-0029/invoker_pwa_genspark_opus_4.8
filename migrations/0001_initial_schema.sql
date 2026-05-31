-- ============================================================
-- Invoker — Multi-Company SaaS Schema (Cloudflare D1 / SQLite)
-- ============================================================

-- ---------- Companies (Tenants) ----------
CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  type          TEXT NOT NULL DEFAULT 'hospital',     -- hospital | clinic | corporate | other
  logo_url      TEXT,
  brand_color   TEXT DEFAULT '#6366f1',
  address       TEXT,
  phone         TEXT,
  email         TEXT,
  currency      TEXT DEFAULT 'BDT',
  tax_rate      REAL DEFAULT 0,
  features_json TEXT DEFAULT '{}',                    -- feature toggles per tenant
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Branches (per-company isolation) ----------
CREATE TABLE IF NOT EXISTS branches (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  address     TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- ---------- Users (global identity) ----------
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,                        -- PBKDF2(salt:hash)
  avatar_url     TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Memberships (RBAC per company) ----------
-- role: admin | manager | staff | viewer
CREATE TABLE IF NOT EXISTS memberships (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  company_id  TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, company_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- ---------- Sessions / Devices (refresh tokens) ----------
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  refresh_token  TEXT UNIQUE NOT NULL,
  device         TEXT,
  ip             TEXT,
  user_agent     TEXT,
  revoked        INTEGER DEFAULT 0,
  expires_at     DATETIME NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ---------- Documents (invoice | certificate | report) ----------
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  branch_id     TEXT,
  type          TEXT NOT NULL,                          -- invoice | certificate | report
  number        TEXT,                                   -- INV-0001 etc
  template      TEXT DEFAULT 'classic',                 -- classic | modern | elegant
  title         TEXT,
  client_name   TEXT,
  client_email  TEXT,
  client_phone  TEXT,
  data_json     TEXT NOT NULL DEFAULT '{}',             -- line items, body, metadata
  subtotal      REAL DEFAULT 0,
  tax           REAL DEFAULT 0,
  discount      REAL DEFAULT 0,
  total         REAL DEFAULT 0,
  status        TEXT DEFAULT 'draft',                   -- draft | issued | paid | due | pending | cancelled
  pdf_key       TEXT,                                   -- R2 object key
  created_by    TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- ---------- Payments ----------
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  document_id   TEXT,
  method        TEXT NOT NULL,                          -- cash | bkash | nagad | card
  amount        REAL NOT NULL,
  tendered      REAL,                                   -- for cash change calc
  change_due    REAL DEFAULT 0,
  reference     TEXT,                                   -- txn id
  status        TEXT DEFAULT 'completed',               -- completed | pending | failed | refunded
  created_by    TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- ---------- Email Logs ----------
CREATE TABLE IF NOT EXISTS email_logs (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  document_id  TEXT,
  recipient    TEXT NOT NULL,
  subject      TEXT,
  status       TEXT DEFAULT 'sent',                     -- sent | failed | queued
  provider     TEXT DEFAULT 'ses',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Audit Logs ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  company_id   TEXT,
  user_id      TEXT,
  action       TEXT NOT NULL,
  entity       TEXT,
  entity_id    TEXT,
  meta_json    TEXT DEFAULT '{}',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Sync Events (edge real-time replacement for WS) ----------
CREATE TABLE IF NOT EXISTS sync_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   TEXT NOT NULL,
  event        TEXT NOT NULL,                           -- invoice.created etc
  payload_json TEXT DEFAULT '{}',
  actor_id     TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Indexes ----------
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_company ON memberships(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id, type);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_payments_company ON payments(company_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_company ON sync_events(company_id, id);
CREATE INDEX IF NOT EXISTS idx_branches_company ON branches(company_id);
