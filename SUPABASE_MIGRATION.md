# Supabase Migration Guide

This document tracks the migration from local JSON files to Supabase.

## Migration Status

### ✅ Completed Migrations

1. **market_items** (`market-items.json` → `market_items` table)
   - **File**: `src/services/universalis.js`
   - **Status**: ✅ Migrated
   - **Usage**: `getMarketableItems()` now fetches from Supabase
   - **Fallback**: Returns empty Set if Supabase fails

### 🔄 Next Candidates for Migration

Based on size and usage patterns, recommended order:

1. **ilvls** (`ilvls.json` → `ilvls` table)
   - Small, simple structure
   - Used in: App.jsx, ItemTable.jsx, MSQPriceChecker.jsx, AdvancedSearch.jsx
   - Structure: `{ "itemId": ilvl }`

2. **rarities** (`rarities.json` → `rarities` table)
   - Small, simple structure
   - Used in: ItemTable.jsx, AdvancedSearch.jsx
   - Structure: `{ "itemId": rarity }`

3. **equip_slot_categories** (`equip-slot-categories.json` → `equip_slot_categories` table)
   - Small, used in MSQPriceChecker.jsx
   - Structure: `{ "slotId": { ... } }`

4. **tw_job_abbr** (`tw-job-abbr.json` → `tw_job_abbr` table)
   - Small, used in multiple components
   - Structure: `{ "jobId": { "tw": "abbr" } }`

## How to Migrate a JSON File

### Step 1: Verify Table Exists in Supabase
Check that the table is synced:
```bash
cd json_converter
node sync_smart.js
```

### Step 2: Create Supabase Service Function
Add a function to `src/services/supabaseClient.js` or create a new service file:

```javascript
import { supabase } from './supabaseClient';

/**
 * Get data from Supabase table
 * @returns {Promise<Object|Array>} - Data from Supabase
 */
export async function getDataFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('table_name')
      .select('*');
    
    if (error) throw error;
    
    // Transform data if needed (e.g., convert array to object)
    return data;
  } catch (error) {
    console.error('Error loading data from Supabase:', error);
    // Return fallback or empty data
    return {};
  }
}
```

### Step 3: Update Import Statements
Replace:
```javascript
import data from '../../teamcraft_git/libs/data/src/lib/json/file.json';
```

With:
```javascript
import { getDataFromSupabase } from './services/supabaseService';
```

### Step 4: Update Usage
Replace synchronous access:
```javascript
const value = data[itemId];
```

With async access:
```javascript
const data = await getDataFromSupabase();
const value = data[itemId];
```

### Step 5: Add Caching
For frequently accessed data, add caching:
```javascript
let cachedData = null;
let loadPromise = null;

export async function getData() {
  if (cachedData) return cachedData;
  if (loadPromise) return loadPromise;
  
  loadPromise = (async () => {
    cachedData = await getDataFromSupabase();
    return cachedData;
  })();
  
  return loadPromise;
}
```

## Testing Migration

1. **Test Supabase Connection**:
   ```javascript
   import { testSupabaseConnection } from './services/supabaseClient';
   const connected = await testSupabaseConnection();
   console.log('Supabase connected:', connected);
   ```

2. **Compare Data**:
   - Load data from both JSON and Supabase
   - Compare row counts
   - Spot-check a few values

3. **Test Functionality**:
   - Use the feature that depends on the data
   - Verify it works the same as before

## Benefits of Supabase Migration

- ✅ **Smaller Bundle Size**: JSON files not bundled into app
- ✅ **Faster Builds**: No need to process large JSON files
- ✅ **Always Up-to-Date**: Data updates automatically via GitHub Actions
- ✅ **Better Performance**: Data cached by Supabase CDN
- ✅ **Scalability**: Can handle larger datasets without build issues

## Rollback Plan

If a migration causes issues, you can temporarily revert:

1. Keep the old import statement commented
2. Add a feature flag:
   ```javascript
   const USE_SUPABASE = true; // Set to false to rollback
   
   if (USE_SUPABASE) {
     return await getDataFromSupabase();
   } else {
     return localJsonData;
   }
   ```
