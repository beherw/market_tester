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
 * Test Supabase connection
 * @returns {Promise<boolean>} - True if connection successful
 */
export async function testSupabaseConnection() {
  try {
    const { error } = await supabase.from('market_items').select('id').limit(1);
    return !error;
  } catch (error) {
    console.error('Supabase connection test failed:', error);
    return false;
  }
}
