-- Create campaign_activities table for tracking important events
CREATE TABLE IF NOT EXISTS campaign_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  activity_type VARCHAR(50) NOT NULL, -- 'campaign_created', 'member_added', 'member_removed', 'observation_added', 'finding_created', 'task_created', 'task_completed', 'message_sent'
  activity_data JSONB, -- Flexible data for different activity types
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_campaign_activities_campaign_id ON campaign_activities(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_activities_user_id ON campaign_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_activities_type ON campaign_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_campaign_activities_created_at ON campaign_activities(created_at DESC);

-- Enable RLS for campaign_activities
ALTER TABLE campaign_activities ENABLE ROW LEVEL SECURITY;

-- Policy for campaign members to read activities
CREATE POLICY "Campaign members can read activities" ON campaign_activities
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM campaign_members WHERE campaign_id = campaign_activities.campaign_id AND user_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM campaigns WHERE id = campaign_activities.campaign_id AND owner_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM campaigns WHERE id = campaign_activities.campaign_id AND privacy = 'public' AND auth.role() = 'authenticated')
  );

-- Policy for campaign members to create activities
CREATE POLICY "Campaign members can create activities" ON campaign_activities
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM campaign_members WHERE campaign_id = campaign_activities.campaign_id AND user_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM campaigns WHERE id = campaign_activities.campaign_id AND owner_id = auth.uid())
  );

-- Create function to automatically log campaign activities
CREATE OR REPLACE FUNCTION log_campaign_activity()
RETURNS TRIGGER AS $$
BEGIN
  -- Log campaign creation
  IF TG_TABLE_NAME = 'campaigns' AND TG_OP = 'INSERT' THEN
    INSERT INTO campaign_activities (campaign_id, user_id, activity_type, activity_data)
    VALUES (NEW.id, NEW.owner_id, 'campaign_created', jsonb_build_object(
      'campaign_name', NEW.name,
      'campaign_description', NEW.description
    ));
  END IF;

  -- Log member additions
  IF TG_TABLE_NAME = 'campaign_members' AND TG_OP = 'INSERT' THEN
    INSERT INTO campaign_activities (campaign_id, user_id, activity_type, activity_data)
    VALUES (NEW.campaign_id, NEW.user_id, 'member_added', jsonb_build_object(
      'member_name', (SELECT name FROM users WHERE id = NEW.user_id),
      'member_role', NEW.role
    ));
  END IF;

  -- Log member removals
  IF TG_TABLE_NAME = 'campaign_members' AND TG_OP = 'DELETE' THEN
    INSERT INTO campaign_activities (campaign_id, user_id, activity_type, activity_data)
    VALUES (OLD.campaign_id, OLD.user_id, 'member_removed', jsonb_build_object(
      'member_name', (SELECT name FROM users WHERE id = OLD.user_id),
      'member_role', OLD.role
    ));
  END IF;

  -- Log observation additions
  IF TG_TABLE_NAME = 'observations' AND TG_OP = 'INSERT' THEN
    INSERT INTO campaign_activities (campaign_id, user_id, activity_type, activity_data)
    VALUES (NEW.campaign_id, NEW.created_by, 'observation_added', jsonb_build_object(
      'observation_title', NEW.title,
      'observation_severity', NEW.severity
    ));
  END IF;

  -- Log finding creations
  IF TG_TABLE_NAME = 'findings' AND TG_OP = 'INSERT' THEN
    INSERT INTO campaign_activities (campaign_id, user_id, activity_type, activity_data)
    VALUES (NEW.campaign_id, NEW.created_by, 'finding_created', jsonb_build_object(
      'finding_title', NEW.title,
      'finding_status', NEW.status
    ));
  END IF;

  -- Log task creations
  IF TG_TABLE_NAME = 'tasks' AND TG_OP = 'INSERT' THEN
    INSERT INTO campaign_activities (campaign_id, user_id, activity_type, activity_data)
    VALUES (NEW.campaign_id, NEW.created_by, 'task_created', jsonb_build_object(
      'task_title', NEW.title,
      'task_type', NEW.type,
      'task_status', NEW.status
    ));
  END IF;

  -- Log task completions
  IF TG_TABLE_NAME = 'tasks' AND TG_OP = 'UPDATE' AND OLD.status != 'completed' AND NEW.status = 'completed' THEN
    INSERT INTO campaign_activities (campaign_id, user_id, activity_type, activity_data)
    VALUES (NEW.campaign_id, NEW.assigned_to, 'task_completed', jsonb_build_object(
      'task_title', NEW.title,
      'task_type', NEW.type
    ));
  END IF;

  -- Log messages
  IF TG_TABLE_NAME = 'campaign_messages' AND TG_OP = 'INSERT' THEN
    INSERT INTO campaign_activities (campaign_id, user_id, activity_type, activity_data)
    VALUES (NEW.campaign_id, NEW.sender_id, 'message_sent', jsonb_build_object(
      'message_preview', LEFT(NEW.content, 100)
    ));
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic activity logging
CREATE TRIGGER trigger_log_campaign_created
  AFTER INSERT ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION log_campaign_activity();

CREATE TRIGGER trigger_log_member_added
  AFTER INSERT ON campaign_members
  FOR EACH ROW
  EXECUTE FUNCTION log_campaign_activity();

CREATE TRIGGER trigger_log_member_removed
  AFTER DELETE ON campaign_members
  FOR EACH ROW
  EXECUTE FUNCTION log_campaign_activity();

CREATE TRIGGER trigger_log_observation_added
  AFTER INSERT ON observations
  FOR EACH ROW
  EXECUTE FUNCTION log_campaign_activity();

CREATE TRIGGER trigger_log_finding_created
  AFTER INSERT ON findings
  FOR EACH ROW
  EXECUTE FUNCTION log_campaign_activity();

CREATE TRIGGER trigger_log_task_created
  AFTER INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_campaign_activity();

CREATE TRIGGER trigger_log_task_completed
  AFTER UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_campaign_activity();

CREATE TRIGGER trigger_log_message_sent
  AFTER INSERT ON campaign_messages
  FOR EACH ROW
  EXECUTE FUNCTION log_campaign_activity();
