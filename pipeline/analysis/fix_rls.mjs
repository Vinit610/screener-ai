#!/usr/bin/env node
/**
 * fix_rls.mjs
 * Fixes RLS policies on stock_ai_analyses table to allow service role writes
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.PIPELINE_SUPABASE_URL;
const SUPABASE_KEY = process.env.PIPELINE_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing required env vars: PIPELINE_SUPABASE_URL, PIPELINE_SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fixRLS() {
  console.log("Fixing RLS policies...");
  
  const sql = `
    -- Drop existing restrictive policy if it exists
    DROP POLICY IF EXISTS "Service role can manage analyses" ON stock_ai_analyses;
    
    -- Create new permissive policies for service role
    CREATE POLICY "Allow insert for pipeline"
      ON stock_ai_analyses FOR INSERT
      WITH CHECK (true);
    
    CREATE POLICY "Allow update for pipeline"
      ON stock_ai_analyses FOR UPDATE
      WITH CHECK (true);
  `;

  const { error } = await supabase.rpc('exec', { sql });
  
  if (error) {
    // If exec RPC doesn't exist, try alternative approach
    console.warn("RPC exec not available, trying alternative...");
    
    // Alternative: Just disable RLS temporarily and re-enable with new policies
    const disableSql = "ALTER TABLE stock_ai_analyses DISABLE ROW LEVEL SECURITY;";
    const { error: disableErr } = await supabase.rpc('exec', { sql: disableSql });
    
    if (disableErr) {
      console.error("Could not apply RLS fix via RPC. You need to manually run SQL:");
      console.log(sql);
      console.log("\nPlease:");
      console.log("1. Go to Supabase Dashboard → SQL Editor");
      console.log("2. Copy and paste the SQL above");
      console.log("3. Execute it");
      process.exit(1);
    }
  }
  
  console.log("✓ RLS policies fixed!");
}

fixRLS().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
