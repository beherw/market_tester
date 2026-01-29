/**
 * Supabase Data Service
 * 
 * Centralized service for loading game data from Supabase.
 * Replaces all local JSON file imports.
 */

import { supabase } from './supabaseClient';

// Cache for all data tables
const dataCache = {};
const loadPromises = {};

/**
 * Generic function to load data from Supabase table
 * @param {string} tableName - Name of the Supabase table
 * @param {Function} transformFn - Optional function to transform data (e.g., array to object)
 * @param {AbortSignal} signal - Optional abort signal to cancel the request
 * @returns {Promise<any>} - Data from Supabase
 */
async function loadTableData(tableName, transformFn = null, signal = null) {
  // Return cached data if available
  if (dataCache[tableName]) {
    return dataCache[tableName];
  }

  // If already loading, return the existing promise
  if (loadPromises[tableName]) {
    return loadPromises[tableName];
  }

  // Start loading from Supabase
  loadPromises[tableName] = (async () => {
    try {
      console.log(`Loading ${tableName} from Supabase...`);
      
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
      
      console.log(`Loaded ${tableName} from Supabase (${Array.isArray(result) ? result.length : Object.keys(result).length} items)`);
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
 * @returns {Promise<Object>} - {itemId: {tw: "name"}}
 */
export async function getTwItems() {
  return loadTableData('tw_items', (data) => {
    const result = {};
    data.forEach(row => {
      result[row.id] = { tw: row.tw };
    });
    return result;
  });
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
 * @returns {Promise<Object>} - {itemId: {tw: "description"}}
 */
export async function getTwItemDescriptions() {
  return loadTableData('tw_item_descriptions', (data) => {
    const result = {};
    data.forEach(row => {
      result[row.id] = { tw: row.tw };
    });
    return result;
  });
}

/**
 * Get marketable item IDs
 * @returns {Promise<Array<number>>} - Array of marketable item IDs
 */
export async function getMarketItems() {
  return loadTableData('market_items', (data) => {
    return data.map(row => parseInt(row.id, 10)).filter(id => !isNaN(id));
  });
}

/**
 * Get equipment data
 * @returns {Promise<Object>} - {itemId: {equipSlotCategory, jobs, ...}}
 */
export async function getEquipment() {
  return loadTableData('equipment', arrayToObjectWithId);
}

/**
 * Get item levels
 * @returns {Promise<Object>} - {itemId: ilvl}
 */
export async function getIlvls() {
  return loadTableData('ilvls', arrayToSimpleObject);
}

/**
 * Get item rarities
 * @returns {Promise<Object>} - {itemId: rarity}
 */
export async function getRarities() {
  return loadTableData('rarities', arrayToSimpleObject);
}

/**
 * Get item patch versions
 * @returns {Promise<Object>} - {itemId: patchId}
 */
export async function getItemPatch() {
  return loadTableData('item_patch', arrayToSimpleObject);
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
 * @returns {Promise<Object>} - {categoryId: {...}}
 */
export async function getUICategories() {
  return loadTableData('ui_categories', arrayToObjectWithId);
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
 */
export function clearCache() {
  Object.keys(dataCache).forEach(key => delete dataCache[key]);
  Object.keys(loadPromises).forEach(key => delete loadPromises[key]);
}

/**
 * Preload all data tables (useful for initial app load)
 */
export async function preloadAllData() {
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
