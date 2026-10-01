-- UUIDs and timestamps retain their original values during the PostgreSQL import.
-- JSON values are stored as JSON text; booleans are stored as 0/1.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  google_id TEXT UNIQUE NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  avatar_url TEXT,
  last_login TEXT,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE bastet_nodes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline',
  info TEXT CHECK (info IS NULL OR json_valid(info)),
  last_seen TEXT,
  websocket_connection INTEGER DEFAULT 0 CHECK (websocket_connection IN (0,1)),
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE scan_results (
  id TEXT PRIMARY KEY NOT NULL,
  node_id TEXT REFERENCES bastet_nodes(id) ON DELETE CASCADE,
  scan_id TEXT NOT NULL,
  results TEXT NOT NULL CHECK (json_valid(results)),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  privacy TEXT NOT NULL DEFAULT 'private',
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hackerone_handle TEXT,
  hackerone_last_synced TEXT,
  hackerone_metadata TEXT CHECK (hackerone_metadata IS NULL OR json_valid(hackerone_metadata)),
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE campaign_members (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'watcher',
  joined_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(campaign_id, user_id)
);

CREATE TABLE observations (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  node_id TEXT REFERENCES bastet_nodes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  status TEXT NOT NULL DEFAULT 'new',
  category TEXT,
  evidence TEXT CHECK (evidence IS NULL OR json_valid(evidence)),
  metadata TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE findings (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  observation_id TEXT REFERENCES observations(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  category TEXT,
  remediation TEXT,
  evidence TEXT CHECK (evidence IS NULL OR json_valid(evidence)),
  metadata TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'scan',
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'medium',
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  scan_config TEXT CHECK (scan_config IS NULL OR json_valid(scan_config)),
  results TEXT CHECK (results IS NULL OR json_valid(results)),
  metadata TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE campaign_messages (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  metadata TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE campaign_activities (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL,
  activity_data TEXT CHECK (activity_data IS NULL OR json_valid(activity_data)),
  created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_bastet_nodes_user_id ON bastet_nodes(user_id, created_at DESC);
CREATE INDEX idx_bastet_nodes_status ON bastet_nodes(status);
CREATE INDEX idx_scan_results_node_id ON scan_results(node_id);
CREATE INDEX idx_scan_results_scan_id ON scan_results(scan_id);
CREATE INDEX idx_campaigns_owner_id ON campaigns(owner_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_privacy ON campaigns(privacy);
CREATE INDEX idx_campaigns_hackerone_handle ON campaigns(hackerone_handle);
CREATE INDEX idx_campaign_members_user_id ON campaign_members(user_id, campaign_id);
CREATE INDEX idx_campaign_members_role ON campaign_members(role);
CREATE INDEX idx_observations_campaign_id ON observations(campaign_id);
CREATE INDEX idx_observations_node_id ON observations(node_id);
CREATE INDEX idx_findings_campaign_id ON findings(campaign_id);
CREATE INDEX idx_findings_observation_id ON findings(observation_id);
CREATE INDEX idx_findings_assigned_to ON findings(assigned_to);
CREATE INDEX idx_tasks_campaign_id ON tasks(campaign_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_campaign_messages_campaign_id ON campaign_messages(campaign_id, created_at);
CREATE INDEX idx_campaign_messages_user_id ON campaign_messages(user_id);
CREATE INDEX idx_campaign_activities_campaign_id ON campaign_activities(campaign_id, created_at DESC);
CREATE INDEX idx_campaign_activities_user_id ON campaign_activities(user_id);
CREATE INDEX idx_campaign_activities_created_at ON campaign_activities(created_at DESC);
