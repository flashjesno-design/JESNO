'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(config.DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(path.join(config.DATA_DIR, 'achatflow.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  brand_color TEXT DEFAULT '#2f5d8a',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'starter',
  license_key TEXT,
  max_users INTEGER NOT NULL DEFAULT 5,
  max_fae_month INTEGER NOT NULL DEFAULT 0,
  features TEXT NOT NULL DEFAULT '[]',
  starts_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  department TEXT,
  delegate_id INTEGER,
  delegate_until TEXT,
  notif_email INTEGER NOT NULL DEFAULT 1,
  notif_whatsapp INTEGER NOT NULL DEFAULT 0,
  notif_inapp INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  reset_token_hash TEXT,
  reset_expires TEXT,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS ref_lists (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  system INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, key)
);
CREATE TABLE IF NOT EXISTS ref_items (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  list_key TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_items ON ref_items(tenant_id, list_key);

CREATE TABLE IF NOT EXISTS pscs (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  level TEXT,
  short_name TEXT,
  long_name TEXT,
  description TEXT,
  name_en TEXT
);
CREATE INDEX IF NOT EXISTS idx_pscs ON pscs(tenant_id, code);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ref TEXT,
  name TEXT NOT NULL,
  country TEXT,
  city TEXT,
  currency TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_suppliers ON suppliers(tenant_id, name);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'fae',
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT DEFAULT '#2f5d8a',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, scope, key)
);

CREATE TABLE IF NOT EXISTS fields (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'fae',
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  section_key TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 0,
  list_key TEXT,
  options TEXT,
  formula TEXT,
  default_value TEXT,
  help TEXT,
  width INTEGER NOT NULL DEFAULT 2,
  visible_if TEXT,
  role TEXT,
  decimals INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, scope, key)
);

CREATE TABLE IF NOT EXISTS fae (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  currency TEXT,
  fx_rate REAL,
  budget REAL, historical REAL, initial REAL, final REAL,
  budget_xof REAL, historical_xof REAL, initial_xof REAL, final_xof REAL,
  effort_xof REAL, saving_budget_xof REAL,
  department TEXT, purchase_type TEXT, spend_nature TEXT, strategy TEXT, saving_type TEXT,
  pscs_code TEXT, segment_code TEXT, supplier_name TEXT,
  offers_count INTEGER NOT NULL DEFAULT 0,
  conform_count INTEGER NOT NULL DEFAULT 0,
  launch_date TEXT, end_date TEXT, pr_number TEXT, requester TEXT,
  derogation TEXT,
  current_step INTEGER NOT NULL DEFAULT 0,
  cycle INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  validated_at TEXT,
  UNIQUE (tenant_id, year, seq)
);
CREATE INDEX IF NOT EXISTS idx_fae_tenant ON fae(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_fae_buyer ON fae(tenant_id, buyer_id);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  fae_id INTEGER NOT NULL REFERENCES fae(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  supplier_ref TEXT,
  supplier_name TEXT,
  conformity TEXT,
  amount REAL,
  amount_xof REAL,
  delay TEXT,
  retained INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_offers_fae ON offers(fae_id);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  approver_type TEXT NOT NULL DEFAULT 'role',
  approver_role TEXT,
  approver_user_id INTEGER,
  condition TEXT,
  sla_hours INTEGER NOT NULL DEFAULT 48,
  reminder_hours INTEGER NOT NULL DEFAULT 24,
  escalate_after_hours INTEGER NOT NULL DEFAULT 0,
  escalate_role TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fae_steps (
  id INTEGER PRIMARY KEY,
  fae_id INTEGER NOT NULL REFERENCES fae(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL,
  cycle INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  approver_type TEXT NOT NULL,
  approver_role TEXT,
  approver_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'waiting',
  sla_hours INTEGER,
  reminder_hours INTEGER,
  escalate_after_hours INTEGER,
  escalate_role TEXT,
  activated_at TEXT,
  due_at TEXT,
  last_reminder_at TEXT,
  escalated_at TEXT,
  acted_by INTEGER,
  acted_by_name TEXT,
  acted_at TEXT,
  comment TEXT
);
CREATE INDEX IF NOT EXISTS idx_fae_steps ON fae_steps(fae_id, cycle);
CREATE INDEX IF NOT EXISTS idx_fae_steps_pending ON fae_steps(tenant_id, status);

CREATE TABLE IF NOT EXISTS fae_events (
  id INTEGER PRIMARY KEY,
  fae_id INTEGER NOT NULL REFERENCES fae(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL,
  user_id INTEGER,
  user_name TEXT,
  type TEXT NOT NULL,
  message TEXT,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events ON fae_events(fae_id);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  fae_id INTEGER NOT NULL REFERENCES fae(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  stored TEXT NOT NULL,
  size INTEGER,
  mime TEXT,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER,
  user_id INTEGER,
  fae_id INTEGER,
  channel TEXT NOT NULL,
  event TEXT,
  recipient TEXT,
  subject TEXT,
  body TEXT,
  link TEXT,
  meta TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, channel, read_at);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  department TEXT NOT NULL,
  amount_xof REAL NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, year, department)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit ON audit_log(tenant_id, created_at);
`);

// ── Migrations idempotentes (bases déjà déployées) ──
function addColumn(table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('suppliers', 'email', 'TEXT');
addColumn('suppliers', 'phone', 'TEXT');
addColumn('suppliers', 'updated_at', 'TEXT');
addColumn('workflow_steps', 'approver_ids', 'TEXT');
addColumn('fae_steps', 'approver_ids', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS idx_suppliers_ref ON suppliers(tenant_id, ref)');

module.exports = db;
