-- Add HackerOne integration metadata to campaigns table
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS hackerone_handle VARCHAR(255);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS hackerone_last_synced TIMESTAMP WITH TIME ZONE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS hackerone_metadata JSONB;

-- Create index for faster lookups of HackerOne campaigns
CREATE INDEX IF NOT EXISTS idx_campaigns_hackerone_handle ON campaigns(hackerone_handle) WHERE hackerone_handle IS NOT NULL;

-- Add comment to explain the columns
COMMENT ON COLUMN campaigns.hackerone_handle IS 'HackerOne program handle if campaign was imported from or synced with HackerOne';
COMMENT ON COLUMN campaigns.hackerone_last_synced IS 'Timestamp of last sync with HackerOne program data';
COMMENT ON COLUMN campaigns.hackerone_metadata IS 'Additional HackerOne metadata (program URL, state, offers_bounties, etc.)';

