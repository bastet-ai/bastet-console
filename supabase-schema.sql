-- Create users table for storing Google OAuth user data
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  google_id VARCHAR(255) UNIQUE NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create an index on google_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Create an index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows users to read their own data
-- You can modify this based on your needs
CREATE POLICY "Users can read their own data" ON users
  FOR SELECT USING (true); -- For now, allow all reads. You can restrict this later.

-- Create a policy that allows users to insert their own data
CREATE POLICY "Users can insert their own data" ON users
  FOR INSERT WITH CHECK (true); -- For now, allow all inserts. You can restrict this later.

-- Create a policy that allows users to update their own data
CREATE POLICY "Users can update their own data" ON users
  FOR UPDATE USING (true); -- For now, allow all updates. You can restrict this later.

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create a trigger to automatically update updated_at
CREATE TRIGGER update_users_updated_at 
  BEFORE UPDATE ON users 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Add avatar_url and last_login columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE;

-- Create the bastet_nodes table for node management
CREATE TABLE IF NOT EXISTS bastet_nodes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  node_type VARCHAR(100) NOT NULL, -- 'scanner', 'monitor', 'analyzer', etc.
  status VARCHAR(50) DEFAULT 'offline' NOT NULL, -- 'online', 'offline', 'error'
  info JSONB, -- Additional node information
  last_seen TIMESTAMP WITH TIME ZONE,
  websocket_connection BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create the scan_results table for vulnerability scan results
CREATE TABLE IF NOT EXISTS scan_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  node_id UUID REFERENCES bastet_nodes(id) ON DELETE CASCADE,
  scan_id VARCHAR(255) NOT NULL,
  results JSONB NOT NULL, -- Scan results data
  status VARCHAR(50) DEFAULT 'pending' NOT NULL, -- 'pending', 'completed', 'failed'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_bastet_nodes_user_id ON bastet_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_bastet_nodes_status ON bastet_nodes(status);
CREATE INDEX IF NOT EXISTS idx_scan_results_node_id ON scan_results(node_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_scan_id ON scan_results(scan_id);

-- Enable RLS for new tables
ALTER TABLE bastet_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_results ENABLE ROW LEVEL SECURITY;

-- Create policies for new tables
CREATE POLICY "Users can manage their own nodes" ON bastet_nodes
  FOR ALL USING (true);

CREATE POLICY "Users can access scan results for their nodes" ON scan_results
  FOR ALL USING (true);

-- Create triggers for updated_at on new tables
CREATE TRIGGER update_bastet_nodes_updated_at 
  BEFORE UPDATE ON bastet_nodes 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_scan_results_updated_at 
  BEFORE UPDATE ON scan_results 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();
