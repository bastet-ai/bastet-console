-- Campaign Management Database Schema
-- This extends the existing schema with campaign-related tables

-- Campaigns table - Main campaign entity
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  scope TEXT NOT NULL, -- Target scope for scanning
  status VARCHAR(50) DEFAULT 'active' NOT NULL, -- 'active', 'paused', 'completed', 'archived'
  privacy VARCHAR(20) DEFAULT 'private' NOT NULL, -- 'private', 'public'
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Campaign members table - User roles within campaigns
CREATE TABLE IF NOT EXISTS campaign_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  role VARCHAR(20) DEFAULT 'watcher' NOT NULL, -- 'owner', 'manager', 'collaborator', 'watcher'
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(campaign_id, user_id)
);

-- Observations table - Raw data from scanning nodes
CREATE TABLE IF NOT EXISTS observations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  node_id UUID REFERENCES bastet_nodes(id) ON DELETE SET NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  severity VARCHAR(20) DEFAULT 'info' NOT NULL, -- 'critical', 'high', 'medium', 'low', 'info'
  status VARCHAR(20) DEFAULT 'new' NOT NULL, -- 'new', 'reviewed', 'escalated', 'dismissed'
  category VARCHAR(100), -- 'vulnerability', 'configuration', 'network', etc.
  evidence JSONB, -- Raw evidence data from scan
  metadata JSONB, -- Additional metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Findings table - Escalated observations that require action
CREATE TABLE IF NOT EXISTS findings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  observation_id UUID REFERENCES observations(id) ON DELETE SET NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  severity VARCHAR(20) DEFAULT 'medium' NOT NULL, -- 'critical', 'high', 'medium', 'low'
  status VARCHAR(20) DEFAULT 'open' NOT NULL, -- 'open', 'in_progress', 'resolved', 'false_positive'
  priority VARCHAR(20) DEFAULT 'medium' NOT NULL, -- 'critical', 'high', 'medium', 'low'
  category VARCHAR(100),
  remediation TEXT,
  evidence JSONB,
  metadata JSONB,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tasks table - Scan jobs and other campaign tasks
CREATE TABLE IF NOT EXISTS tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  type VARCHAR(50) DEFAULT 'scan' NOT NULL, -- 'scan', 'manual', 'review', 'remediation'
  status VARCHAR(20) DEFAULT 'pending' NOT NULL, -- 'pending', 'in_progress', 'completed', 'failed', 'cancelled'
  priority VARCHAR(20) DEFAULT 'medium' NOT NULL, -- 'critical', 'high', 'medium', 'low'
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date TIMESTAMP WITH TIME ZONE,
  scan_config JSONB, -- Configuration for scan tasks
  results JSONB, -- Task results
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat messages table - Real-time collaboration
CREATE TABLE IF NOT EXISTS campaign_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  message TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text' NOT NULL, -- 'text', 'system', 'file', 'task_update'
  metadata JSONB, -- For file attachments, mentions, etc.
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_campaigns_owner_id ON campaigns(owner_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_privacy ON campaigns(privacy);
CREATE INDEX IF NOT EXISTS idx_campaign_members_campaign_id ON campaign_members(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_members_user_id ON campaign_members(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_members_role ON campaign_members(role);
CREATE INDEX IF NOT EXISTS idx_observations_campaign_id ON observations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_observations_node_id ON observations(node_id);
CREATE INDEX IF NOT EXISTS idx_observations_severity ON observations(severity);
CREATE INDEX IF NOT EXISTS idx_observations_status ON observations(status);
CREATE INDEX IF NOT EXISTS idx_findings_campaign_id ON findings(campaign_id);
CREATE INDEX IF NOT EXISTS idx_findings_observation_id ON findings(observation_id);
CREATE INDEX IF NOT EXISTS idx_findings_assigned_to ON findings(assigned_to);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_tasks_campaign_id ON tasks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_campaign_id ON campaign_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_user_id ON campaign_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_created_at ON campaign_messages(created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for campaigns
CREATE POLICY "Users can view campaigns they are members of" ON campaigns
  FOR SELECT USING (
    id IN (
      SELECT campaign_id FROM campaign_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Campaign owners can update their campaigns" ON campaigns
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Campaign owners can delete their campaigns" ON campaigns
  FOR DELETE USING (owner_id = auth.uid());

CREATE POLICY "Users can create campaigns" ON campaigns
  FOR INSERT WITH CHECK (owner_id = auth.uid());

-- RLS Policies for campaign_members
CREATE POLICY "Users can view campaign members of campaigns they belong to" ON campaign_members
  FOR SELECT USING (
    campaign_id IN (
      SELECT campaign_id FROM campaign_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Campaign owners can manage members" ON campaign_members
  FOR ALL USING (
    campaign_id IN (
      SELECT id FROM campaigns WHERE owner_id = auth.uid()
    )
  );

-- RLS Policies for observations
CREATE POLICY "Campaign members can view observations" ON observations
  FOR SELECT USING (
    campaign_id IN (
      SELECT campaign_id FROM campaign_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Campaign collaborators can create observations" ON observations
  FOR INSERT WITH CHECK (
    campaign_id IN (
      SELECT campaign_id FROM campaign_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager', 'collaborator')
    )
  );

CREATE POLICY "Campaign collaborators can update observations" ON observations
  FOR UPDATE USING (
    campaign_id IN (
      SELECT campaign_id FROM campaign_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager', 'collaborator')
    )
  );

-- RLS Policies for findings
CREATE POLICY "Campaign members can view findings" ON findings
  FOR SELECT USING (
    campaign_id IN (
      SELECT campaign_id FROM campaign_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Campaign collaborators can manage findings" ON findings
  FOR ALL USING (
    campaign_id IN (
      SELECT campaign_id FROM campaign_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager', 'collaborator')
    )
  );

-- RLS Policies for tasks
CREATE POLICY "Campaign members can view tasks" ON tasks
  FOR SELECT USING (
    campaign_id IN (
      SELECT campaign_id FROM campaign_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Campaign collaborators can manage tasks" ON tasks
  FOR ALL USING (
    campaign_id IN (
      SELECT campaign_id FROM campaign_members 
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager', 'collaborator')
    )
  );

-- RLS Policies for campaign_messages
CREATE POLICY "Campaign members can view messages" ON campaign_messages
  FOR SELECT USING (
    campaign_id IN (
      SELECT campaign_id FROM campaign_members 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Campaign members can create messages" ON campaign_messages
  FOR INSERT WITH CHECK (
    campaign_id IN (
      SELECT campaign_id FROM campaign_members 
      WHERE user_id = auth.uid()
    )
  );

-- Create triggers for updated_at timestamps
CREATE TRIGGER update_campaigns_updated_at 
  BEFORE UPDATE ON campaigns 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_observations_updated_at 
  BEFORE UPDATE ON observations 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_findings_updated_at 
  BEFORE UPDATE ON findings 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at 
  BEFORE UPDATE ON tasks 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_campaign_messages_updated_at 
  BEFORE UPDATE ON campaign_messages 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Add avatar_url column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE;
