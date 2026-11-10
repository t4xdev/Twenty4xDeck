CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT, email TEXT, company TEXT, role TEXT, note TEXT,
  fleet_size TEXT, vessel_types TEXT, priorities TEXT, modules TEXT,
  attribution TEXT, seconds INTEGER, origin TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS leads_created ON leads (created_at DESC);

-- One row per opening of a tracked link (a portal URL with utm_* tags). Filled by POST /visit.
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  visitor_id TEXT, session_id TEXT, is_return INTEGER NOT NULL DEFAULT 0,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
  page TEXT, referrer TEXT,
  ip TEXT, city TEXT, region TEXT, country TEXT, postal TEXT, lat TEXT, lon TEXT, timezone TEXT,
  network_org TEXT, asn INTEGER,
  browser TEXT, os TEXT, device TEXT, screen TEXT, language TEXT, client_timezone TEXT, user_agent TEXT,
  seconds_on_page INTEGER, origin TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS visits_created ON visits (created_at DESC);
CREATE INDEX IF NOT EXISTS visits_session ON visits (session_id);
CREATE INDEX IF NOT EXISTS visits_visitor ON visits (visitor_id, utm_campaign, created_at);
CREATE INDEX IF NOT EXISTS visits_content ON visits (utm_content);

-- One row per client link made on GET /links. A visit belongs to a link when visits.utm_content = links.code.
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  code TEXT NOT NULL UNIQUE,
  client TEXT NOT NULL, company TEXT, email TEXT, note TEXT, campaign TEXT,
  url TEXT NOT NULL
);
