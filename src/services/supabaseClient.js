/**
 * Supabase Client Configuration
 * 
 * This file initializes the Supabase client for accessing game data.
 * Uses public anon key for client-side access (read-only).
 */

import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const SUPABASE_URL = 'https://dojkqotccerymtnqnyfj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_hMotsHXlY9psWRl35E3Ppw_WAH4P7Pf';

// Create Supabase client
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Test Supabase connection with detailed logging
 * @returns {Promise<boolean>} - True if connection successful
 */
export async function testSupabaseConnection() {
  const startTime = performance.now();
  console.log('[Supabase] 🔌 Connecting to database...');
  
  try {
    const { data, error, status } = await supabase
      .from('market_items')
      .select('id')
      .limit(1);
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    if (error) {
      console.error(`[Supabase] ❌ Connection failed after ${duration.toFixed(2)}ms:`, error);
      return false;
    }
    
    console.log(`[Supabase] ✅ Connected successfully in ${duration.toFixed(2)}ms (status: ${status})`);
    return true;
  } catch (error) {
    const endTime = performance.now();
    const duration = endTime - startTime;
    console.error(`[Supabase] ❌ Connection test failed after ${duration.toFixed(2)}ms:`, error);
    return false;
  }
}

/**
 * Initialize Supabase connection on page load
 * Call this as early as possible to establish connection
 */
export async function initializeSupabaseConnection() {
  console.log('[Supabase] 🚀 Initializing database connection...');
  const connectionStartTime = performance.now();
  
  const connected = await testSupabaseConnection();
  
  const totalTime = performance.now() - connectionStartTime;
  
  if (connected) {
    console.log(`[Supabase] ✨ Database ready (total init time: ${totalTime.toFixed(2)}ms)`);
  } else {
    console.warn(`[Supabase] ⚠️ Database connection failed (total init time: ${totalTime.toFixed(2)}ms)`);
  }
  
  return connected;
}
