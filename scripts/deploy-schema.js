const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Read environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

// Create Supabase client with service role key
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function deploySchema() {
  try {
    console.log('Reading schema file...');
    const schema = fs.readFileSync('supabase-schema.sql', 'utf8');
    
    console.log('Executing schema...');
    const { data, error } = await supabase.rpc('exec_sql', { sql: schema });
    
    if (error) {
      console.error('Error executing schema:', error);
      process.exit(1);
    }
    
    console.log('Schema deployed successfully!');
    console.log('Result:', data);
    
  } catch (error) {
    console.error('Failed to deploy schema:', error);
    process.exit(1);
  }
}

deploySchema();
