/**
 * Supabase Data Service
 * 
 * Centralized service for loading game data from Supabase.
 * Replaces all local JSON file imports.
 * 
 * ⚠️ CRITICAL PERFORMANCE RULE: NEVER LOAD ALL ITEMS AT ONCE
 * 
 * Always use targeted queries with WHERE clauses:
 * - Use getTwItemDescriptionsByIds(itemIds) instead of getTwItemDescriptions()
 * - Use getIlvlsByIds(itemIds) instead of getIlvls()
 * - Use getRaritiesByIds(itemIds) instead of getRarities()
 * - Use getItemPatchByIds(itemIds) instead of getItemPatch()
 * - Use getMarketItemsByIds(itemIds) instead of getMarketItems()
 * 
 * Functions without "ByIds" suffix load ALL data (19,000-50,000+ items) and should
 * ONLY be used as fallbacks or when you truly need all data.
 * 
 * Example workflow:
 * 1. Search database → get item IDs
 * 2. Use those IDs to fetch only needed data with *ByIds() functions
 * 3. Never load entire tables unless absolutely necessary
 * 
 * See PERFORMANCE_GUIDELINES.md for detailed best practices.
 */

import { supabase } from './supabaseClient';

// Cache for all data tables
const dataCache = {};
const loadPromises = {};

// Cache for targeted queries (by item IDs) to prevent duplicate requests
const targetedQueryCache = {
  ilvls: {},
  rarities: {},
  item_patch: {},
  market_items: {},
  tw_item_descriptions: {},
  equipment: {},
  ui_categories: {}
};
const targetedQueryPromises = {
  ilvls: {},
  rarities: {},
  item_patch: {},
  market_items: {},
  tw_item_descriptions: {},
  equipment: {},
  ui_categories: {}
};

/**
 * Generic function to load data from Supabase table
 * 
 * ⚠️ WARNING: This function loads ALL rows from the table!
 * 
 * Only use this for:
 * - Small tables (< 1000 rows) like patch_names
 * - Fallback scenarios when targeted queries fail
 * - Initial data preloading (rare)
 * 
 * For large tables, ALWAYS use targeted *ByIds() functions instead!
 * 
 * @param {string} tableName - Name of the Supabase table
 * @param {Function} transformFn - Optional function to transform data (e.g., array to object)
 * @param {AbortSignal} signal - Optional abort signal to cancel the request
 * @returns {Promise<any>} - Data from Supabase
 */
async function loadTableData(tableName, transformFn = null, signal = null) {
  // Return cached data if available
  if (dataCache[tableName]) {
    console.log(`[Supabase] 📦 Using cached ${tableName} (${Array.isArray(dataCache[tableName]) ? dataCache[tableName].length : Object.keys(dataCache[tableName]).length} items)`);
    return dataCache[tableName];
  }

  // If already loading, return the existing promise
  if (loadPromises[tableName]) {
    console.log(`[Supabase] ⏳ ${tableName} already loading, waiting for existing request...`);
    return loadPromises[tableName];
  }

  // Start loading from Supabase
  const loadStartTime = performance.now();
  console.log(`[Supabase] 📥 Loading ${tableName} from Supabase...`);
  
  // ⚠️ WARNING: Loading entire table - this should be avoided for large tables!
  const largeTables = ['tw_items', 'tw_item_descriptions', 'ilvls', 'rarities', 'item_patch', 'market_items'];
  if (largeTables.includes(tableName)) {
    console.warn(`[Supabase] ⚠️ WARNING: Loading ENTIRE table "${tableName}" (may contain 10,000+ rows)!`);
    console.warn(`[Supabase] ⚠️ Consider using targeted *ByIds() function instead (e.g., get${tableName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}ByIds())`);
    console.trace(`[Supabase] 🔍 Stack trace for ${tableName} full table load:`);
  }
  
  loadPromises[tableName] = (async () => {
    try {
      
      // Check if already aborted
      if (signal && signal.aborted) {
        throw new DOMException('Request aborted', 'AbortError');
      }
      
      // Supabase has a default limit of 1000 rows, so we need to paginate
      const pageSize = 1000;
      let allData = [];
      let from = 0;
      let hasMore = true;
      
      while (hasMore) {
        // Check if aborted before each request
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }
        
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .range(from, from + pageSize - 1);

        // Check if aborted after request
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        if (error) {
          console.error(`Error loading ${tableName} from Supabase:`, error);
          throw error;
        }

        if (data && data.length > 0) {
          allData = allData.concat(data);
          from += pageSize;
          // If we got fewer rows than requested, we've reached the end
          hasMore = data.length === pageSize;
        } else {
          hasMore = false;
        }
      }

      // Check if aborted before transforming
      if (signal && signal.aborted) {
        throw new DOMException('Request aborted', 'AbortError');
      }

      // Transform data if transform function provided
      let result = transformFn ? transformFn(allData) : allData;
      
      // Check if aborted before caching
      if (signal && signal.aborted) {
        throw new DOMException('Request aborted', 'AbortError');
      }
      
      // Cache the result
      dataCache[tableName] = result;
      
      const loadDuration = performance.now() - loadStartTime;
      const itemCount = Array.isArray(result) ? result.length : Object.keys(result).length;
      console.log(`[Supabase] ✅ Loaded ${tableName} from Supabase (${itemCount} items) in ${loadDuration.toFixed(2)}ms`);
      
      // Warn if loading large table without WHERE clause
      if (itemCount > 1000 && !signal) {
        console.warn(`[Supabase] ⚠️ Large table ${tableName} loaded (${itemCount} items). Consider using WHERE clauses for better performance.`);
      }
      
      return result;
    } catch (error) {
      // Don't log abort errors
      if (error.name === 'AbortError' || (signal && signal.aborted)) {
        throw error; // Re-throw abort errors
      }
      console.error(`Error loading ${tableName}:`, error);
      // Return empty fallback based on expected structure
      return transformFn ? transformFn([]) : [];
    } finally {
      // Clear the loading promise
      delete loadPromises[tableName];
    }
  })();

  return loadPromises[tableName];
}

/**
 * Transform array of objects to object with id as key
 * [{id: 1, ...}, {id: 2, ...}] → {1: {...}, 2: {...}}
 */
function arrayToObjectById(data) {
  const result = {};
  data.forEach(item => {
    const id = item.id;
    if (id !== undefined && id !== null) {
      // Remove id from the object if it's the key
      const { id: _, ...rest } = item;
      result[id] = rest;
    }
  });
  return result;
}

/**
 * Transform array of objects to object, keeping id in nested object
 * [{id: 1, tw: "name"}, ...] → {1: {tw: "name"}, ...}
 */
function arrayToObjectWithId(data) {
  const result = {};
  data.forEach(item => {
    const id = item.id;
    if (id !== undefined && id !== null) {
      result[id] = item;
    }
  });
  return result;
}

/**
 * Transform array to simple object (for simple key-value pairs)
 * [{id: 1, value: 100}, ...] → {1: 100, ...}
 */
function arrayToSimpleObject(data) {
  const result = {};
  data.forEach(item => {
    const id = item.id;
    const value = item.value;
    if (id !== undefined && id !== null) {
      result[id] = value;
    }
  });
  return result;
}

// ============================================================================
// Item Data Services
// ============================================================================

/**
 * Get Traditional Chinese item names
 * 
 * ⚠️ WARNING: This loads ALL 42,679 item names from the database!
 * 
 * DO NOT USE THIS unless you truly need all items.
 * 
 * Instead, use targeted queries:
 * - searchTwItems(searchText) - Search items by name
 * - getTwItemById(itemId) - Get single item by ID
 * 
 * @returns {Promise<Object>} - {itemId: {tw: "name"}}
 * @deprecated Use searchTwItems() or getTwItemById() instead for better performance
 */
export async function getTwItems() {
  console.warn(`[Supabase] ⚠️ getTwItems() called - this loads ALL 42,679 items!`);
  console.warn(`[Supabase] ⚠️ Use searchTwItems(searchText) or getTwItemById(itemId) instead.`);
  console.trace(`[Supabase] 🔍 Stack trace - find and replace with targeted query:`);
  return loadTableData('tw_items', (data) => {
    const result = {};
    data.forEach(row => {
      result[row.id] = { tw: row.tw };
    });
    return result;
  });
}

/**
 * Get a single item by ID using targeted query (efficient - doesn't load all items)
 * @param {number} itemId - Item ID
 * @returns {Promise<Object|null>} - {id, tw} or null if not found
 */
export async function getTwItemById(itemId) {
  if (!itemId || itemId <= 0) {
    return null;
  }
  
  try {
    const { data, error } = await supabase
      .from('tw_items')
      .select('id, tw')
      .eq('id', itemId)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    return { id: data.id, tw: data.tw };
  } catch (error) {
    console.error(`Error fetching item ${itemId} from Supabase:`, error);
    return null;
  }
}

/**
 * Build a search query for tw_items
 * @param {Array<string>} words - Array of search words
 * @param {boolean} fuzzy - Whether to use fuzzy matching
 * @returns {Function} - Function that returns a Supabase query builder
 */
function buildSearchQuery(words, fuzzy) {
  return () => {
    let query = supabase
      .from('tw_items')
      .select('id, tw')
      .not('tw', 'is', null)
      .neq('tw', '');

    // For each word, add a LIKE filter (case-insensitive)
    // Supabase chains filters with AND condition
    words.forEach(word => {
      if (fuzzy) {
        // Fuzzy matching: each character must appear in order
        // Pattern: %c1%c2%c3% matches "c1...c2...c3" in order
        const pattern = '%' + Array.from(word).join('%') + '%';
        query = query.ilike('tw', pattern);
      } else {
        // Exact substring matching: word must appear anywhere in the name
        query = query.ilike('tw', `%${word}%`);
      }
    });

    return query;
  };
}

/**
 * Search items by name using database queries (efficient - only fetches matching items)
 * @param {string} searchText - Search text (can contain multiple words separated by spaces)
 * @param {boolean} fuzzy - Whether to use fuzzy matching (if false, uses exact substring match)
 * @param {AbortSignal} signal - Optional abort signal to cancel the request
 * @returns {Promise<Object>} - {itemId: {tw: "name"}}
 */
export async function searchTwItems(searchText, fuzzy = false, signal = null) {
  if (!searchText || !searchText.trim()) {
    return {};
  }

  // Check if already aborted
  if (signal && signal.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  const trimmedSearchText = searchText.trim();
  const hasSpaces = trimmedSearchText.includes(' ');
  const words = hasSpaces 
    ? trimmedSearchText.split(/\s+/).filter(w => w)
    : [trimmedSearchText];

  if (words.length === 0) {
    return {};
  }

  // Build query factory function
  const buildQuery = buildSearchQuery(words, fuzzy);

  // Fetch all matching rows (with pagination if needed)
  const pageSize = 1000;
  let allData = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    // Check if aborted before each request
    if (signal && signal.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }
    
    // Rebuild query for each page (Supabase queries are immutable)
    const query = buildQuery();
    const { data, error } = await query.range(from, from + pageSize - 1);

    // Check if aborted after request
    if (signal && signal.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    if (error) {
      console.error(`Error searching tw_items:`, error);
      throw error;
    }

    if (data && data.length > 0) {
      allData = allData.concat(data);
      from += pageSize;
      hasMore = data.length === pageSize;
    } else {
      hasMore = false;
    }
  }

  // Check if aborted before transforming
  if (signal && signal.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  // Transform to same format as getTwItems
  const result = {};
  allData.forEach(row => {
    if (row.tw && row.tw.trim() !== '') {
      result[row.id] = { tw: row.tw };
    }
  });

  return result;
}

/**
 * Get Traditional Chinese item descriptions
 * 
 * ⚠️ WARNING: This loads ALL 19,032 item descriptions from the database!
 * 
 * DO NOT USE THIS unless you truly need all descriptions.
 * 
 * Instead, use: getTwItemDescriptionsByIds(itemIds) to load only specific items.
 * 
 * @returns {Promise<Object>} - {itemId: {tw: "description"}}
 * @deprecated Use getTwItemDescriptionsByIds() instead for better performance
 */
export async function getTwItemDescriptions() {
  // Log stack trace to identify where this is being called from (should rarely be called)
  console.warn(`[Supabase] ⚠️ getTwItemDescriptions() called - this loads ALL 19,032 descriptions!`);
  console.warn(`[Supabase] ⚠️ Use getTwItemDescriptionsByIds(itemIds) instead to load only what you need.`);
  console.trace(`[Supabase] 🔍 Stack trace - find and replace with targeted query:`);
  return loadTableData('tw_item_descriptions', (data) => {
    const result = {};
    data.forEach(row => {
      result[row.id] = { tw: row.tw };
    });
    return result;
  });
}

/**
 * Get Traditional Chinese item descriptions for specific item IDs (efficient - uses WHERE IN)
 * @param {Array<number>} itemIds - Array of item IDs to fetch descriptions for
 * @param {AbortSignal} signal - Optional abort signal to cancel the request
 * @returns {Promise<Object>} - {itemId: {tw: "description"}}
 */
export async function getTwItemDescriptionsByIds(itemIds, signal = null) {
  if (!itemIds || itemIds.length === 0) {
    return {};
  }

  // Check if already aborted
  if (signal && signal.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  // Check cache and filter out already-cached items
  const cacheKey = itemIds.sort((a, b) => a - b).join(',');
  const cached = targetedQueryCache.tw_item_descriptions[cacheKey];
  if (cached) {
    console.log(`[Supabase] 📦 Using cached tw_item_descriptions for ${itemIds.length} items`);
    return cached;
  }

  // Check if same query is already in progress
  const existingPromise = targetedQueryPromises.tw_item_descriptions[cacheKey];
  if (existingPromise) {
    console.log(`[Supabase] ⏳ tw_item_descriptions for ${itemIds.length} items already loading, waiting...`);
    return existingPromise;
  }

  const loadStartTime = performance.now();
  console.log(`[Supabase] 📥 Loading tw_item_descriptions for ${itemIds.length} items from Supabase...`);

  // Create promise and store it
  const promise = (async () => {
    try {
      // Supabase supports up to 1000 items in an IN clause, so we need to batch if needed
      const batchSize = 1000;
      const result = {};
      
      for (let i = 0; i < itemIds.length; i += batchSize) {
        // Check if aborted before each batch
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        const batch = itemIds.slice(i, i + batchSize);
        const { data, error } = await supabase
          .from('tw_item_descriptions')
          .select('id, tw')
          .in('id', batch);

        // Check if aborted after request
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        if (error) {
          console.error(`Error loading tw_item_descriptions for items:`, error);
          throw error;
        }

        if (data) {
          data.forEach(row => {
            result[row.id] = { tw: row.tw };
          });
        }
      }

      const loadDuration = performance.now() - loadStartTime;
      const loadedCount = Object.keys(result).length;
      // Only log if we actually loaded items (avoid logging "0 items" for single-item queries that don't have descriptions)
      if (loadedCount > 0 || itemIds.length > 1) {
        console.log(`[Supabase] ✅ Loaded tw_item_descriptions for ${loadedCount} items in ${loadDuration.toFixed(2)}ms`);
      }
      
      // Merge into the shared cache so getTwItemDescriptions() can use it
      // This prevents loading all descriptions if someone calls getTwItemDescriptions() later
      if (!dataCache['tw_item_descriptions']) {
        dataCache['tw_item_descriptions'] = {};
      }
      Object.assign(dataCache['tw_item_descriptions'], result);
      
      // Cache the result for this specific query
      targetedQueryCache.tw_item_descriptions[cacheKey] = result;
      
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || (signal && signal.aborted)) {
        throw error;
      }
      console.error(`Error loading tw_item_descriptions by IDs:`, error);
      return {};
    } finally {
      // Remove promise from cache
      delete targetedQueryPromises.tw_item_descriptions[cacheKey];
    }
  })();

  targetedQueryPromises.tw_item_descriptions[cacheKey] = promise;
  return promise;
}

/**
 * Get marketable item IDs
 * 
 * ⚠️ WARNING: This loads ALL 16,670 marketable item IDs from the database!
 * 
 * DO NOT USE THIS unless you truly need all marketable items.
 * 
 * Instead, use: getMarketItemsByIds(itemIds) to check only specific items.
 * 
 * @returns {Promise<Array<number>>} - Array of marketable item IDs
 * @deprecated Use getMarketItemsByIds() instead for better performance
 */
export async function getMarketItems() {
  console.warn(`[Supabase] ⚠️ getMarketItems() called - this loads ALL 16,670 marketable items!`);
  console.warn(`[Supabase] ⚠️ Use getMarketItemsByIds(itemIds) instead to check only what you need.`);
  console.trace(`[Supabase] 🔍 Stack trace - find and replace with targeted query:`);
  return loadTableData('market_items', (data) => {
    return data.map(row => parseInt(row.id, 10)).filter(id => !isNaN(id));
  });
}

/**
 * Check which items from a list are marketable (efficient - uses WHERE IN)
 * @param {Array<number>} itemIds - Array of item IDs to check
 * @param {AbortSignal} signal - Optional abort signal to cancel the request
 * @returns {Promise<Set<number>>} - Set of marketable item IDs from the provided list
 */
export async function getMarketItemsByIds(itemIds, signal = null) {
  if (!itemIds || itemIds.length === 0) {
    return new Set();
  }

  // Check if already aborted
  if (signal && signal.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  // Check cache and filter out already-cached items
  const cacheKey = itemIds.sort((a, b) => a - b).join(',');
  const cached = targetedQueryCache.market_items[cacheKey];
  if (cached) {
    console.log(`[Supabase] 📦 Using cached marketability check for ${itemIds.length} items`);
    return cached;
  }

  // Check if same query is already in progress
  const existingPromise = targetedQueryPromises.market_items[cacheKey];
  if (existingPromise) {
    console.log(`[Supabase] ⏳ Marketability check for ${itemIds.length} items already in progress, waiting...`);
    return existingPromise;
  }

  const loadStartTime = performance.now();
  console.log(`[Supabase] 📥 Checking marketability for ${itemIds.length} items from Supabase...`);

  // Create promise and store it
  const promise = (async () => {
    try {
      const marketableSet = new Set();
      
      // Supabase supports up to 1000 items in an IN clause, so we need to batch if needed
      const batchSize = 1000;
      
      for (let i = 0; i < itemIds.length; i += batchSize) {
        // Check if aborted before each batch
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        const batch = itemIds.slice(i, i + batchSize);
        const { data, error } = await supabase
          .from('market_items')
          .select('id')
          .in('id', batch);

        // Check if aborted after request
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        if (error) {
          console.error(`Error checking marketability for items:`, error);
          throw error;
        }

        if (data) {
          data.forEach(row => {
            const id = parseInt(row.id, 10);
            if (!isNaN(id)) {
              marketableSet.add(id);
            }
          });
        }
      }

      const loadDuration = performance.now() - loadStartTime;
      console.log(`[Supabase] ✅ Found ${marketableSet.size} marketable items out of ${itemIds.length} in ${loadDuration.toFixed(2)}ms`);
      
      // Cache the result for this specific query
      targetedQueryCache.market_items[cacheKey] = marketableSet;
      
      return marketableSet;
    } catch (error) {
      if (error.name === 'AbortError' || (signal && signal.aborted)) {
        throw error;
      }
      console.error(`Error checking marketability by IDs:`, error);
      return new Set();
    } finally {
      // Remove promise from cache
      delete targetedQueryPromises.market_items[cacheKey];
    }
  })();

  targetedQueryPromises.market_items[cacheKey] = promise;
  return promise;
}

/**
 * Get equipment data
 * 
 * ⚠️ WARNING: This loads ALL 24,098 equipment items from the database!
 * 
 * DO NOT USE THIS unless you truly need all equipment data.
 * 
 * Instead, use:
 * - getEquipmentByIds(itemIds) to load only specific items
 * - getEquipmentByJobs(jobAbbrs) to load equipment matching specific jobs
 * 
 * @returns {Promise<Object>} - {itemId: {equipSlotCategory, jobs, ...}}
 * @deprecated Use getEquipmentByIds() or getEquipmentByJobs() instead for better performance
 */
export async function getEquipment() {
  console.warn('[Supabase] ⚠️ Loading all equipment (24,098 items). Consider using getEquipmentByIds() or getEquipmentByJobs() for better performance.');
  console.trace('[Supabase] Full equipment table load called from:');
  return loadTableData('equipment', arrayToObjectWithId);
}

/**
 * Get equipment data for specific item IDs (targeted query - efficient)
 * @param {Array<number>} itemIds - Array of item IDs
 * @param {AbortSignal} signal - Optional abort signal to cancel the request
 * @returns {Promise<Object>} - {itemId: {equipSlotCategory, jobs, level, ...}}
 */
export async function getEquipmentByIds(itemIds, signal = null) {
  if (!itemIds || itemIds.length === 0) {
    return {};
  }

  // Remove duplicates and filter invalid IDs
  const uniqueIds = [...new Set(itemIds.filter(id => id && id > 0))];
  if (uniqueIds.length === 0) {
    return {};
  }

  // Create cache key from sorted IDs
  const cacheKey = uniqueIds.sort((a, b) => a - b).join(',');

  // Check cache first
  if (targetedQueryCache.equipment && targetedQueryCache.equipment[cacheKey]) {
    console.log(`[Supabase] 📦 Using cached equipment for ${uniqueIds.length} items`);
    return targetedQueryCache.equipment[cacheKey];
  }

  // Check if there's already a pending request for these IDs
  if (targetedQueryPromises.equipment && targetedQueryPromises.equipment[cacheKey]) {
    return targetedQueryPromises.equipment[cacheKey];
  }

  // Initialize cache if needed
  if (!targetedQueryCache.equipment) {
    targetedQueryCache.equipment = {};
  }
  if (!targetedQueryPromises.equipment) {
    targetedQueryPromises.equipment = {};
  }

  const loadStartTime = performance.now();
  console.log(`[Supabase] 📥 Loading equipment for ${uniqueIds.length} items from Supabase...`);

  // Create promise and store it
  const promise = (async () => {
    try {
      const result = {};
      
      // Supabase supports up to 1000 items in an IN clause, so we need to batch if needed
      const batchSize = 1000;
      
      for (let i = 0; i < uniqueIds.length; i += batchSize) {
        // Check if aborted before each batch
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        const batch = uniqueIds.slice(i, i + batchSize);
        const { data, error } = await supabase
          .from('equipment')
          .select('*')
          .in('id', batch);

        // Check if aborted after request
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        if (error) {
          console.error(`Error loading equipment for items:`, error);
          throw error;
        }

        if (data) {
          data.forEach(row => {
            const id = row.id;
            if (id !== undefined && id !== null) {
              result[id] = row;
            }
          });
        }
      }

      const loadDuration = performance.now() - loadStartTime;
      console.log(`[Supabase] ✅ Loaded equipment for ${Object.keys(result).length} items in ${loadDuration.toFixed(2)}ms`);
      
      // Cache the result for this specific query
      targetedQueryCache.equipment[cacheKey] = result;
      
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || (signal && signal.aborted)) {
        throw error;
      }
      console.error(`Error loading equipment by IDs:`, error);
      return {};
    } finally {
      // Remove promise from cache
      delete targetedQueryPromises.equipment[cacheKey];
    }
  })();

  targetedQueryPromises.equipment[cacheKey] = promise;
  return promise;
}

/**
 * Get equipment data matching specific job abbreviations (targeted query - efficient)
 * Uses Supabase array overlap operator to find equipment where jobs array contains any of the specified job abbreviations
 * @param {Array<string>} jobAbbrs - Array of job abbreviations (e.g., ['PLD', 'WAR', 'CRP'])
 * @param {AbortSignal} signal - Optional abort signal to cancel the request
 * @returns {Promise<Object>} - {itemId: {equipSlotCategory, jobs, level, ...}}
 */
export async function getEquipmentByJobs(jobAbbrs, signal = null) {
  if (!jobAbbrs || jobAbbrs.length === 0) {
    return {};
  }

  // Remove duplicates
  const uniqueJobAbbrs = [...new Set(jobAbbrs.filter(abbr => abbr))];
  if (uniqueJobAbbrs.length === 0) {
    return {};
  }

  // Create cache key from sorted job abbreviations
  const cacheKey = uniqueJobAbbrs.sort().join(',');

  // Check cache first
  if (targetedQueryCache.equipment && targetedQueryCache.equipment[`jobs:${cacheKey}`]) {
    console.log(`[Supabase] 📦 Using cached equipment for jobs: ${uniqueJobAbbrs.join(', ')}`);
    return targetedQueryCache.equipment[`jobs:${cacheKey}`];
  }

  // Check if there's already a pending request for these jobs
  if (targetedQueryPromises.equipment && targetedQueryPromises.equipment[`jobs:${cacheKey}`]) {
    return targetedQueryPromises.equipment[`jobs:${cacheKey}`];
  }

  // Initialize cache if needed
  if (!targetedQueryCache.equipment) {
    targetedQueryCache.equipment = {};
  }
  if (!targetedQueryPromises.equipment) {
    targetedQueryPromises.equipment = {};
  }

  const loadStartTime = performance.now();
  console.log(`[Supabase] 📥 Loading equipment for jobs: ${uniqueJobAbbrs.join(', ')} from Supabase...`);

  // Create promise and store it
  const promise = (async () => {
    try {
      const result = {};
      
      // Query each job separately and merge results
      // This is more reliable than trying to use complex OR conditions with array contains
      // Supabase's .contains() works for single values, so we query each job and deduplicate
      for (const abbr of uniqueJobAbbrs) {
        // Check if aborted before each request
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }
        
        // Use .filter() with 'cs' (contains) operator and Postgres array syntax
        // Format: filter('jobs', 'cs', '{SGE}') checks if jobs array contains 'SGE'
        const { data: jobData, error: jobError } = await supabase
          .from('equipment')
          .select('*')
          .filter('jobs', 'cs', `{${abbr}}`);
        
        // Check if aborted after request
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }
        
        if (jobError) {
          console.error(`Error loading equipment for job ${abbr}:`, jobError);
          // Continue with other jobs even if one fails
          continue;
        }
        
        if (jobData) {
          jobData.forEach(row => {
            const id = row.id;
            if (id !== undefined && id !== null) {
              // Merge into result (deduplication happens automatically since we use id as key)
              result[id] = row;
            }
          });
        }
      }

      const loadDuration = performance.now() - loadStartTime;
      console.log(`[Supabase] ✅ Loaded equipment for ${Object.keys(result).length} items (${uniqueJobAbbrs.length} jobs) in ${loadDuration.toFixed(2)}ms`);
      
      // Cache the result for this specific query
      targetedQueryCache.equipment[`jobs:${cacheKey}`] = result;
      
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || (signal && signal.aborted)) {
        throw error;
      }
      console.error(`Error loading equipment by jobs:`, error);
      return {};
    } finally {
      // Remove promise from cache
      delete targetedQueryPromises.equipment[`jobs:${cacheKey}`];
    }
  })();

  targetedQueryPromises.equipment[`jobs:${cacheKey}`] = promise;
  return promise;
}

/**
 * Get item levels
 * 
 * ⚠️ WARNING: This loads ALL 50,900 item levels from the database!
 * 
 * DO NOT USE THIS unless you truly need all ilvls.
 * 
 * Instead, use: getIlvlsByIds(itemIds) to load only specific items.
 * 
 * @returns {Promise<Object>} - {itemId: ilvl}
 * @deprecated Use getIlvlsByIds() instead for better performance
 */
export async function getIlvls() {
  console.warn(`[Supabase] ⚠️ getIlvls() called - this loads ALL 50,900 ilvls!`);
  console.warn(`[Supabase] ⚠️ Use getIlvlsByIds(itemIds) instead to load only what you need.`);
  console.trace(`[Supabase] 🔍 Stack trace - find and replace with targeted query:`);
  return loadTableData('ilvls', arrayToSimpleObject);
}

/**
 * Get item levels for specific item IDs (efficient - uses WHERE IN)
 * @param {Array<number>} itemIds - Array of item IDs to fetch ilvls for
 * @param {AbortSignal} signal - Optional abort signal to cancel the request
 * @returns {Promise<Object>} - {itemId: ilvl}
 */
export async function getIlvlsByIds(itemIds, signal = null) {
  if (!itemIds || itemIds.length === 0) {
    return {};
  }

  // Check if already aborted
  if (signal && signal.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  // Check cache and filter out already-cached items
  const cacheKey = itemIds.sort((a, b) => a - b).join(',');
  const cached = targetedQueryCache.ilvls[cacheKey];
  if (cached) {
    console.log(`[Supabase] 📦 Using cached ilvls for ${itemIds.length} items`);
    return cached;
  }

  // Check if same query is already in progress
  const existingPromise = targetedQueryPromises.ilvls[cacheKey];
  if (existingPromise) {
    console.log(`[Supabase] ⏳ ilvls for ${itemIds.length} items already loading, waiting...`);
    return existingPromise;
  }

  const loadStartTime = performance.now();
  console.log(`[Supabase] 📥 Loading ilvls for ${itemIds.length} items from Supabase...`);

  // Create promise and store it
  const promise = (async () => {
    try {
      const result = {};
      
      // Supabase supports up to 1000 items in an IN clause, so we need to batch if needed
      const batchSize = 1000;
      
      for (let i = 0; i < itemIds.length; i += batchSize) {
        // Check if aborted before each batch
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        const batch = itemIds.slice(i, i + batchSize);
        const { data, error } = await supabase
          .from('ilvls')
          .select('id, value')
          .in('id', batch);

        // Check if aborted after request
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        if (error) {
          console.error(`Error loading ilvls for items:`, error);
          throw error;
        }

        if (data) {
          data.forEach(row => {
            const id = row.id;
            if (id !== undefined && id !== null) {
              result[id] = row.value;
            }
          });
        }
      }

      const loadDuration = performance.now() - loadStartTime;
      console.log(`[Supabase] ✅ Loaded ilvls for ${Object.keys(result).length} items in ${loadDuration.toFixed(2)}ms`);
      
      // Cache the result for this specific query
      targetedQueryCache.ilvls[cacheKey] = result;
      
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || (signal && signal.aborted)) {
        throw error;
      }
      console.error(`Error loading ilvls by IDs:`, error);
      return {};
    } finally {
      // Remove promise from cache
      delete targetedQueryPromises.ilvls[cacheKey];
    }
  })();

  targetedQueryPromises.ilvls[cacheKey] = promise;
  return promise;
}

/**
 * Get item rarities
 * 
 * ⚠️ WARNING: This loads ALL 50,900 item rarities from the database!
 * 
 * DO NOT USE THIS unless you truly need all rarities.
 * 
 * Instead, use: getRaritiesByIds(itemIds) to load only specific items.
 * 
 * @returns {Promise<Object>} - {itemId: rarity}
 * @deprecated Use getRaritiesByIds() instead for better performance
 */
export async function getRarities() {
  console.warn(`[Supabase] ⚠️ getRarities() called - this loads ALL 50,900 rarities!`);
  console.warn(`[Supabase] ⚠️ Use getRaritiesByIds(itemIds) instead to load only what you need.`);
  console.trace(`[Supabase] 🔍 Stack trace - find and replace with targeted query:`);
  return loadTableData('rarities', arrayToSimpleObject);
}

/**
 * Get item rarities for specific item IDs (efficient - uses WHERE IN)
 * @param {Array<number>} itemIds - Array of item IDs to fetch rarities for
 * @param {AbortSignal} signal - Optional abort signal to cancel the request
 * @returns {Promise<Object>} - {itemId: rarity}
 */
export async function getRaritiesByIds(itemIds, signal = null) {
  if (!itemIds || itemIds.length === 0) {
    return {};
  }

  // Check if already aborted
  if (signal && signal.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  // Check cache
  const cacheKey = itemIds.sort((a, b) => a - b).join(',');
  const cached = targetedQueryCache.rarities[cacheKey];
  if (cached) {
    console.log(`[Supabase] 📦 Using cached rarities for ${itemIds.length} items`);
    return cached;
  }

  // Check if same query is already in progress
  const existingPromise = targetedQueryPromises.rarities[cacheKey];
  if (existingPromise) {
    console.log(`[Supabase] ⏳ rarities for ${itemIds.length} items already loading, waiting...`);
    return existingPromise;
  }

  const loadStartTime = performance.now();
  console.log(`[Supabase] 📥 Loading rarities for ${itemIds.length} items from Supabase...`);

  // Create promise and store it
  const promise = (async () => {
    try {
      const result = {};
      
      // Supabase supports up to 1000 items in an IN clause, so we need to batch if needed
      const batchSize = 1000;
      
      for (let i = 0; i < itemIds.length; i += batchSize) {
        // Check if aborted before each batch
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        const batch = itemIds.slice(i, i + batchSize);
        const { data, error } = await supabase
          .from('rarities')
          .select('id, value')
          .in('id', batch);

        // Check if aborted after request
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        if (error) {
          console.error(`Error loading rarities for items:`, error);
          throw error;
        }

        if (data) {
          data.forEach(row => {
            const id = row.id;
            if (id !== undefined && id !== null) {
              result[id] = row.value;
            }
          });
        }
      }

      const loadDuration = performance.now() - loadStartTime;
      console.log(`[Supabase] ✅ Loaded rarities for ${Object.keys(result).length} items in ${loadDuration.toFixed(2)}ms`);
      
      // Cache the result for this specific query
      targetedQueryCache.rarities[cacheKey] = result;
      
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || (signal && signal.aborted)) {
        throw error;
      }
      console.error(`Error loading rarities by IDs:`, error);
      return {};
    } finally {
      // Remove promise from cache
      delete targetedQueryPromises.rarities[cacheKey];
    }
  })();

  targetedQueryPromises.rarities[cacheKey] = promise;
  return promise;
}

/**
 * Get item patch versions
 * 
 * ⚠️ WARNING: This loads ALL 48,455 item patch versions from the database!
 * 
 * DO NOT USE THIS unless you truly need all patch data.
 * 
 * Instead, use: getItemPatchByIds(itemIds) to load only specific items.
 * 
 * @returns {Promise<Object>} - {itemId: patchId}
 * @deprecated Use getItemPatchByIds() instead for better performance
 */
export async function getItemPatch() {
  console.warn(`[Supabase] ⚠️ getItemPatch() called - this loads ALL 48,455 patch versions!`);
  console.warn(`[Supabase] ⚠️ Use getItemPatchByIds(itemIds) instead to load only what you need.`);
  console.trace(`[Supabase] 🔍 Stack trace - find and replace with targeted query:`);
  return loadTableData('item_patch', arrayToSimpleObject);
}

/**
 * Get item patch versions for specific item IDs (efficient - uses WHERE IN)
 * @param {Array<number>} itemIds - Array of item IDs to fetch patch data for
 * @param {AbortSignal} signal - Optional abort signal to cancel the request
 * @returns {Promise<Object>} - {itemId: patchId}
 */
export async function getItemPatchByIds(itemIds, signal = null) {
  if (!itemIds || itemIds.length === 0) {
    return {};
  }

  // Check if already aborted
  if (signal && signal.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  // Check cache
  const cacheKey = itemIds.sort((a, b) => a - b).join(',');
  const cached = targetedQueryCache.item_patch[cacheKey];
  if (cached) {
    console.log(`[Supabase] 📦 Using cached item_patch for ${itemIds.length} items`);
    return cached;
  }

  // Check if same query is already in progress
  const existingPromise = targetedQueryPromises.item_patch[cacheKey];
  if (existingPromise) {
    console.log(`[Supabase] ⏳ item_patch for ${itemIds.length} items already loading, waiting...`);
    return existingPromise;
  }

  const loadStartTime = performance.now();
  console.log(`[Supabase] 📥 Loading item_patch for ${itemIds.length} items from Supabase...`);

  // Create promise and store it
  const promise = (async () => {
    try {
      const result = {};
      
      // Supabase supports up to 1000 items in an IN clause, so we need to batch if needed
      const batchSize = 1000;
      
      for (let i = 0; i < itemIds.length; i += batchSize) {
        // Check if aborted before each batch
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        const batch = itemIds.slice(i, i + batchSize);
        const { data, error } = await supabase
          .from('item_patch')
          .select('id, value')
          .in('id', batch);

        // Check if aborted after request
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        if (error) {
          console.error(`Error loading item_patch for items:`, error);
          throw error;
        }

        if (data) {
          data.forEach(row => {
            const id = row.id;
            if (id !== undefined && id !== null) {
              result[id] = row.value;
            }
          });
        }
      }

      const loadDuration = performance.now() - loadStartTime;
      console.log(`[Supabase] ✅ Loaded item_patch for ${Object.keys(result).length} items in ${loadDuration.toFixed(2)}ms`);
      
      // Cache the result for this specific query
      targetedQueryCache.item_patch[cacheKey] = result;
      
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || (signal && signal.aborted)) {
        throw error;
      }
      console.error(`Error loading item_patch by IDs:`, error);
      return {};
    } finally {
      // Remove promise from cache
      delete targetedQueryPromises.item_patch[cacheKey];
    }
  })();

  targetedQueryPromises.item_patch[cacheKey] = promise;
  return promise;
}

/**
 * Get patch names
 * @returns {Promise<Object>} - {patchId: {name, ...}}
 */
export async function getPatchNames() {
  return loadTableData('patch_names', arrayToObjectWithId);
}

// ============================================================================
// Recipe Data Services
// ============================================================================

/**
 * Get crafting recipes
 * @returns {Promise<Array>} - Array of recipe objects
 */
export async function getTwRecipes() {
  return loadTableData('tw_recipes');
}

// ============================================================================
// Category/UI Data Services
// ============================================================================

/**
 * Get Traditional Chinese UI category names
 * @returns {Promise<Object>} - {categoryId: {tw: "name"}}
 */
export async function getTwItemUICategories() {
  return loadTableData('tw_item_ui_categories', (data) => {
    const result = {};
    data.forEach(row => {
      result[row.id] = { tw: row.tw };
    });
    return result;
  });
}

/**
 * Get UI category data
 * 
 * ⚠️ WARNING: This loads ALL 50,900 ui_categories from the database!
 * 
 * DO NOT USE THIS unless you truly need all ui_categories data.
 * 
 * Instead, use: getUICategoriesByIds(itemIds) to load only specific items.
 * 
 * @returns {Promise<Object>} - {itemId: categoryId} (assuming id is itemId and category is categoryId)
 * @deprecated Use getUICategoriesByIds() instead for better performance
 */
export async function getUICategories() {
  console.warn('[Supabase] ⚠️ Loading all ui_categories (50,900 items). Consider using getUICategoriesByIds() for better performance.');
  console.trace('[Supabase] Full ui_categories table load called from:');
  return loadTableData('ui_categories', (data) => {
    // Transform to {itemId: categoryId} mapping
    const result = {};
    data.forEach(item => {
      const itemId = item.id;
      const categoryId = item.category;
      if (itemId !== undefined && itemId !== null) {
        result[itemId] = categoryId;
      }
    });
    return result;
  });
}

/**
 * Get UI category data for specific item IDs (targeted query - efficient)
 * Returns mapping of itemId to categoryId
 * @param {Array<number>} itemIds - Array of item IDs
 * @param {AbortSignal} signal - Optional abort signal to cancel the request
 * @returns {Promise<Object>} - {itemId: categoryId}
 */
export async function getUICategoriesByIds(itemIds, signal = null) {
  if (!itemIds || itemIds.length === 0) {
    return {};
  }

  // Remove duplicates and filter invalid IDs
  const uniqueIds = [...new Set(itemIds.filter(id => id && id > 0))];
  if (uniqueIds.length === 0) {
    return {};
  }

  // Create cache key from sorted IDs
  const cacheKey = uniqueIds.sort((a, b) => a - b).join(',');

  // Check cache first
  if (targetedQueryCache.ui_categories && targetedQueryCache.ui_categories[cacheKey]) {
    console.log(`[Supabase] 📦 Using cached ui_categories for ${uniqueIds.length} items`);
    return targetedQueryCache.ui_categories[cacheKey];
  }

  // Check if there's already a pending request for these IDs
  if (targetedQueryPromises.ui_categories && targetedQueryPromises.ui_categories[cacheKey]) {
    return targetedQueryPromises.ui_categories[cacheKey];
  }

  // Initialize cache if needed
  if (!targetedQueryCache.ui_categories) {
    targetedQueryCache.ui_categories = {};
  }
  if (!targetedQueryPromises.ui_categories) {
    targetedQueryPromises.ui_categories = {};
  }

  const loadStartTime = performance.now();
  console.log(`[Supabase] 📥 Loading ui_categories for ${uniqueIds.length} items from Supabase...`);

  // Create promise and store it
  const promise = (async () => {
    try {
      const result = {};
      
      // Supabase supports up to 1000 items in an IN clause, so we need to batch if needed
      const batchSize = 1000;
      
      for (let i = 0; i < uniqueIds.length; i += batchSize) {
        // Check if aborted before each batch
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        const batch = uniqueIds.slice(i, i + batchSize);
        const { data, error } = await supabase
          .from('ui_categories')
          .select('id, category')
          .in('id', batch);

        // Check if aborted after request
        if (signal && signal.aborted) {
          throw new DOMException('Request aborted', 'AbortError');
        }

        if (error) {
          console.error(`Error loading ui_categories for items:`, error);
          throw error;
        }

        if (data) {
          data.forEach(row => {
            const itemId = row.id;
            const categoryId = row.category;
            if (itemId !== undefined && itemId !== null) {
              result[itemId] = categoryId;
            }
          });
        }
      }

      const loadDuration = performance.now() - loadStartTime;
      console.log(`[Supabase] ✅ Loaded ui_categories for ${Object.keys(result).length} items in ${loadDuration.toFixed(2)}ms`);
      
      // Cache the result for this specific query
      targetedQueryCache.ui_categories[cacheKey] = result;
      
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || (signal && signal.aborted)) {
        throw error;
      }
      console.error(`Error loading ui_categories by IDs:`, error);
      return {};
    } finally {
      // Remove promise from cache
      delete targetedQueryPromises.ui_categories[cacheKey];
    }
  })();

  targetedQueryPromises.ui_categories[cacheKey] = promise;
  return promise;
}

/**
 * Get equipment slot category definitions
 * @returns {Promise<Object>} - {slotId: {...}}
 */
export async function getEquipSlotCategories() {
  return loadTableData('equip_slot_categories', arrayToObjectWithId);
}

// ============================================================================
// Job Data Services
// ============================================================================

/**
 * Get Traditional Chinese job abbreviations
 * @returns {Promise<Object>} - {jobId: {tw: "abbr"}}
 */
export async function getTwJobAbbr() {
  return loadTableData('tw_job_abbr', (data) => {
    const result = {};
    data.forEach(row => {
      result[row.id] = { tw: row.tw };
    });
    return result;
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Clear all cached data (useful for testing or forced refresh)
 * 
 * ⚠️ NOTE: After clearing cache, make sure to use targeted queries (*ByIds functions)
 * instead of loading all data again.
 */
export function clearCache() {
  Object.keys(dataCache).forEach(key => delete dataCache[key]);
  Object.keys(loadPromises).forEach(key => delete loadPromises[key]);
  // Also clear targeted query caches
  Object.keys(targetedQueryCache).forEach(table => {
    Object.keys(targetedQueryCache[table]).forEach(key => delete targetedQueryCache[table][key]);
  });
  Object.keys(targetedQueryPromises).forEach(table => {
    Object.keys(targetedQueryPromises[table]).forEach(key => delete targetedQueryPromises[table][key]);
  });
}

/**
 * Preload all data tables (useful for initial app load)
 * 
 * ⚠️ WARNING: This loads ALL data from ALL tables (100,000+ items)!
 * 
 * DO NOT USE THIS in production - it will severely impact performance.
 * 
 * Only use for:
 * - Development/testing
 * - Offline mode preparation
 * - One-time data migration
 * 
 * For normal operations, load data on-demand using targeted queries.
 * 
 * @deprecated Do not use in production - loads too much data at once
 */
export async function preloadAllData() {
  console.error(`[Supabase] ❌ CRITICAL: preloadAllData() called - this loads ALL data (100,000+ items)!`);
  console.error(`[Supabase] ❌ This should NOT be used in production. Load data on-demand instead.`);
  console.trace(`[Supabase] 🔍 Stack trace - remove this call:`);
  
  const tables = [
    getTwItems(),
    getTwItemDescriptions(),
    getMarketItems(),
    getEquipment(),
    getIlvls(),
    getRarities(),
    getItemPatch(),
    getPatchNames(),
    getTwRecipes(),
    getTwItemUICategories(),
    getUICategories(),
    getEquipSlotCategories(),
    getTwJobAbbr(),
  ];
  
  await Promise.allSettled(tables);
  console.log('All data preloaded from Supabase');
}
