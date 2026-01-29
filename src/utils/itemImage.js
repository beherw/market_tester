// Item image service using XIVAPI
// XIVAPI provides item data including icon paths
// Format: https://xivapi.com/Item/{itemId} returns JSON with Icon field
// Icon field format: /i/020000/020801.png
// Full URL: https://xivapi.com/i/020000/020801.png
//
// Rate Limiting:
// XIVAPI rate limit: 20 requests per second (both API key and client IP)
// Source: https://xivapi.com/docs/Welcome
// Implementation uses sliding window algorithm to track requests in the last 1 second
// and ensures we never exceed 20 requests per second, maximizing throughput while
// staying within limits.

// Cache for icon paths to avoid repeated API calls
const iconCache = new Map();
// Track pending requests to avoid duplicate API calls
const pendingRequests = new Map();
// Track abort controllers for pending requests to allow cancellation
const abortControllers = new Map();

// Rate limiting queue for icon requests
// XIVAPI rate limit: 20 requests per second (both API key and client IP)
// We use 19 requests per second to stay safely below the limit
// This means minimum ~52.6ms between requests (1000ms / 19 ≈ 52.6ms)
class IconRequestQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.isPaused = false;
    this.pauseUntil = 0;
    
    // Rate limiting: 19 requests per second (1 req/sec slower than XIVAPI's 20 req/sec limit)
    this.MAX_REQUESTS_PER_SECOND = 19;
    this.MIN_DELAY_MS = 53; // 1000ms / 19 ≈ 52.6ms, rounded to 53ms minimum between requests
    
    // Track request timestamps for sliding window rate limiting
    this.requestTimestamps = [];
    
    // Track concurrent priority requests
    this.concurrentPriorityRequests = 0;
    this.MAX_CONCURRENT_PRIORITY = 5; // Allow up to 5 priority requests concurrently (reduced from 10 to limit concurrent loads for large result sets)
    
    // Retry configuration
    this.RATE_LIMIT_RETRY_DELAY = 2000; // Initial delay when hitting 429
    this.MAX_RETRY_DELAY = 10000; // Maximum retry delay
  }

  /**
   * Check if we can make a request now, or calculate delay needed
   * Uses sliding window: keep track of requests in the last 1 second
   * @returns {number} - Delay in ms before next request can be made (0 if can proceed immediately)
   */
  getDelayBeforeNextRequest() {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    
    // Remove timestamps older than 1 second
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneSecondAgo);
    
    // If we have fewer than MAX_REQUESTS_PER_SECOND requests in the last second, we can proceed
    if (this.requestTimestamps.length < this.MAX_REQUESTS_PER_SECOND) {
      return 0;
    }
    
    // We've hit the limit, calculate delay until oldest request expires
    const oldestTimestamp = this.requestTimestamps[0];
    const timeUntilOldestExpires = (oldestTimestamp + 1000) - now;
    
    // Add small buffer to ensure we don't exceed the limit
    return Math.max(timeUntilOldestExpires + 10, this.MIN_DELAY_MS);
  }

  /**
   * Record that a request was made
   */
  recordRequest() {
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Add a request to the queue
   * @param {number} itemId - Item ID
   * @param {Function} requestFn - Function that makes the API request
   * @param {AbortSignal} abortSignal - Optional abort signal to cancel the request
   * @param {boolean} priority - If true, bypass rate limiting for faster loading
   * @returns {Promise} - Promise that resolves when the request completes
   */
  async enqueue(itemId, requestFn, abortSignal = null, priority = false) {
    return new Promise((resolve, reject) => {
      const queueItem = {
        itemId,
        requestFn,
        resolve,
        reject,
        retryCount: 0,
        abortSignal,
        priority
      };
      
      if (priority) {
        // Priority items go to the front of the queue for immediate processing
        this.queue.unshift(queueItem);
      } else {
        this.queue.push(queueItem);
      }
      
      // Start processing if not already processing
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process a single request item
   */
  async processItem(item) {
    try {
      // Check if request was cancelled
      if (item.abortSignal && item.abortSignal.aborted) {
        item.reject(new Error('Request cancelled'));
        return;
      }

      // Priority items can be processed concurrently
      if (!item.priority) {
        // Non-priority items: check rate limit and wait if necessary
        const delay = this.getDelayBeforeNextRequest();
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Check again after delay
        if (item.abortSignal && item.abortSignal.aborted) {
          item.reject(new Error('Request cancelled'));
          return;
        }
      } else {
        // Priority items: allow concurrent processing with minimal delay
        // Stagger requests slightly (5ms) to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 5));
        
        // Check again after minimal delay
        if (item.abortSignal && item.abortSignal.aborted) {
          item.reject(new Error('Request cancelled'));
          return;
        }
        
        // Increment concurrent priority counter
        this.concurrentPriorityRequests++;
      }

      // Record that we're making a request (before the actual request)
      this.recordRequest();
      
      // Make the request (this runs concurrently for priority items)
      const result = await item.requestFn();
      
      item.resolve(result);
    } catch (error) {
      // Handle cancellation errors
      if (error.name === 'AbortError' || (item.abortSignal && item.abortSignal.aborted)) {
        item.reject(new Error('Request cancelled'));
        return;
      }
      // Handle 429 (Too Many Requests) errors
      if (error.status === 429 || (error.response && error.response.status === 429)) {
        // Exponential backoff
        const retryDelay = Math.min(
          this.RATE_LIMIT_RETRY_DELAY * Math.pow(2, item.retryCount),
          this.MAX_RETRY_DELAY
        );
        
        // Pause the queue
        this.isPaused = true;
        this.pauseUntil = Date.now() + retryDelay;
        
        // Clear recent timestamps to allow recovery after pause
        this.requestTimestamps = [];
        
        // Retry the request (put it back at the front of the queue)
        item.retryCount++;
        if (item.retryCount < 5) { // Max 5 retries
          this.queue.unshift(item);
        } else {
          // Give up after max retries
          item.reject(new Error('Rate limit exceeded. Please try again later.'));
        }
      } else {
        // For other errors, resolve with null (item might not exist)
        item.resolve(null);
      }
    } finally {
      // Decrement concurrent priority counter if this was a priority request
      if (item.priority) {
        this.concurrentPriorityRequests = Math.max(0, this.concurrentPriorityRequests - 1);
      }
      
      // Continue processing queue
      this.processQueue();
    }
  }

  /**
   * Process the queue with rate limiting
   * Processes priority items concurrently, non-priority items sequentially
   */
  async processQueue() {
    // Prevent concurrent execution of processQueue
    if (this.processing && this.queue.length === 0) {
      return;
    }
    
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    // Check if we're paused due to rate limiting
    const now = Date.now();
    if (this.isPaused && now < this.pauseUntil) {
      const waitTime = this.pauseUntil - now;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.isPaused = false;
      this.pauseUntil = 0;
    }

    // Process priority items concurrently (up to MAX_CONCURRENT_PRIORITY)
    // Process non-priority items sequentially
    const priorityItems = [];
    const nonPriorityItems = [];
    
    // Separate priority and non-priority items
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item.priority && this.concurrentPriorityRequests < this.MAX_CONCURRENT_PRIORITY) {
        priorityItems.push(item);
      } else {
        nonPriorityItems.push(item);
      }
    }
    
    // Put non-priority items back in queue
    this.queue.push(...nonPriorityItems);
    
    // Process all priority items concurrently
    if (priorityItems.length > 0) {
      this.processing = true;
      // Fire all priority requests concurrently (they'll handle their own delays)
      // Each will call processQueue() again when done to continue processing
      priorityItems.forEach(item => {
        this.processItem(item).catch(() => {
          // Errors are handled in processItem
        });
      });
      
      // Process non-priority items sequentially (one at a time)
      // Only process one non-priority item, then let priority items complete
      if (this.queue.length > 0 && this.concurrentPriorityRequests === 0) {
        // Only process non-priority if no priority items are running
        const item = this.queue.shift();
        await this.processItem(item);
      }
    } else if (this.queue.length > 0) {
      // Process one non-priority item at a time
      this.processing = true;
      const item = this.queue.shift();
      await this.processItem(item);
    } else {
      // No items to process, but priority items might still be running
      // Don't set processing to false yet - let priority items finish
      if (this.concurrentPriorityRequests === 0) {
        this.processing = false;
      }
    }
  }

  /**
   * Reset the request counter (useful when starting a new batch)
   */
  reset() {
    this.requestTimestamps = [];
  }

  /**
   * Clear all pending requests from the queue
   */
  clear() {
    // Reject all pending items in the queue
    this.queue.forEach(item => {
      if (item.reject) {
        item.reject(new Error('Request queue cleared'));
      }
    });
    this.queue = [];
    this.processing = false;
  }
}

// Create singleton instance
const iconRequestQueue = new IconRequestQueue();

/**
 * Calculate icon path from item ID (common pattern in FFXIV)
 * Format: /i/{folder}/{iconId}.png where folder is usually 6 digits and iconId is 6 digits
 * This is a fallback method - may not work for all items
 * @param {number} itemId - Item ID
 * @returns {string} - Calculated icon path
 */
function calculateIconPath(itemId) {
  // Convert item ID to 6-digit string with leading zeros
  const iconId = itemId.toString().padStart(6, '0');
  // Most items use folder 020000, but this may vary
  // Try common folder patterns
  const folders = ['020000', '021000', '022000', '023000', '024000'];
  return folders.map(folder => `https://xivapi.com/i/${folder}/${iconId}.png`);
}

/**
 * Get item icon path from XIVAPI (internal function, called via queue)
 * @param {number} itemId - Item ID
 * @param {AbortSignal} abortSignal - Optional abort signal to cancel the request
 * @returns {Promise<string|null>} - Icon URL or null if not found
 * @throws {Error} - Throws error for 429 status to trigger retry logic
 */
async function fetchIconPathFromAPI(itemId, abortSignal = null) {
  // Check if already aborted
  if (abortSignal && abortSignal.aborted) {
    throw new Error('Request cancelled');
  }

  // Create abort controller for timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 5000);

  // Merge abort signals: if external signal provided, abort timeout controller when external aborts
  // This allows both timeout and external cancellation to work
  if (abortSignal) {
    // If external signal aborts, abort timeout controller too
    abortSignal.addEventListener('abort', () => {
      timeoutController.abort();
      clearTimeout(timeoutId);
    });
  }

  // Use timeout controller's signal for fetch
  // This will be aborted by either timeout or external signal
  const signal = timeoutController.signal;

  try {
    // Use columns parameter to only fetch Icon field (faster)
    const response = await fetch(`https://xivapi.com/Item/${itemId}?columns=Icon`, {
      signal: signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 404) {
        // Item not found - this is expected for some items, cache null to avoid repeated requests
        iconCache.set(itemId, null);
        return null;
      }
      
      // For 429 (Too Many Requests), throw error to trigger queue retry logic
      if (response.status === 429) {
        const error = new Error('Rate limit exceeded');
        error.status = 429;
        error.response = { status: 429 };
        throw error;
      }
      
      // For other HTTP errors, cache null and return null
      iconCache.set(itemId, null);
      return null;
    }
    
    const data = await response.json();
    if (data && data.Icon) {
      // Icon path is relative, e.g., /i/020000/020801.png
      const iconUrl = `https://xivapi.com${data.Icon}`;
      // Cache the result
      iconCache.set(itemId, iconUrl);
      return iconUrl;
    }
    // Cache null for items without icon data
    iconCache.set(itemId, null);
    return null;
  } catch (error) {
    // Re-throw 429 errors so queue can handle them
    if (error.status === 429 || (error.response && error.response.status === 429)) {
      throw error;
    }
    
    // Handle abort errors
    if (error.name === 'AbortError' || (abortSignal && abortSignal.aborted)) {
      throw new Error('Request cancelled');
    }
    
    // For other errors (network, timeout, etc.), cache null and return null
    // Don't log errors as they are expected for some items
    iconCache.set(itemId, null);
    return null;
  }
}

/**
 * Get item image URL from XIVAPI with caching and rate limiting
 * @param {number} itemId - Item ID
 * @param {AbortSignal} abortSignal - Optional abort signal to cancel the request
 * @param {boolean} priority - If true, bypass rate limiting for faster loading (for first 10 icons)
 * @returns {Promise<string|null>} - Item image URL or null
 */
export async function getItemImageUrl(itemId, abortSignal = null, priority = false) {
  if (!itemId || itemId <= 0) {
    return null;
  }

  // Check if request was cancelled
  if (abortSignal && abortSignal.aborted) {
    return null;
  }

  // Check cache first (including null values for items that don't exist)
  if (iconCache.has(itemId)) {
    return iconCache.get(itemId);
  }

  // Check if there's already a pending request for this item
  if (pendingRequests.has(itemId)) {
    const existingPromise = pendingRequests.get(itemId);
    // If abort signal provided and request was cancelled, return null
    if (abortSignal && abortSignal.aborted) {
      return null;
    }
    return await existingPromise;
  }

  // Create abort controller for this specific request if not provided
  let controller = null;
  let signal = abortSignal;
  if (!signal) {
    controller = new AbortController();
    signal = controller.signal;
    abortControllers.set(itemId, controller);
  }

  // Create new request using the rate-limited queue
  // Priority items bypass rate limiting for faster loading
  const requestPromise = iconRequestQueue.enqueue(itemId, () => fetchIconPathFromAPI(itemId, signal), signal, priority)
    .then(result => {
      // Remove from pending requests and abort controllers when done
      pendingRequests.delete(itemId);
      abortControllers.delete(itemId);
      return result;
    })
    .catch(error => {
      // Remove from pending requests and abort controllers on error
      pendingRequests.delete(itemId);
      abortControllers.delete(itemId);
      // Return null for errors (item might not exist, rate limited, or cancelled)
      if (error.message === 'Request cancelled' || (signal && signal.aborted)) {
        return null;
      }
      return null;
    });

  pendingRequests.set(itemId, requestPromise);
  return await requestPromise;
}

/**
 * Get item image URL synchronously (returns cached value or null)
 * For use in components that need immediate value
 * @param {number} itemId - Item ID
 * @returns {string|null} - Cached icon URL or null
 */
export function getItemImageUrlSync(itemId) {
  if (!itemId || itemId <= 0) {
    return null;
  }
  return iconCache.get(itemId) || null;
}

/**
 * Get calculated icon URLs (fallback method, may not work for all items)
 * @param {number} itemId - Item ID
 * @returns {Array<string>} - Array of calculated icon URLs to try
 */
export function getCalculatedIconUrls(itemId) {
  if (!itemId || itemId <= 0) {
    return [];
  }
  return calculateIconPath(itemId);
}

/**
 * Preload icon for an item (useful for batch loading)
 * @param {number} itemId - Item ID
 * @returns {Promise<string|null>} - Icon URL or null
 */
export async function preloadItemIcon(itemId) {
  return await getItemImageUrl(itemId);
}

/**
 * Clear the icon cache and reset the request queue
 */
export function clearIconCache() {
  iconCache.clear();
  pendingRequests.clear();
  iconRequestQueue.reset();
}

/**
 * Cancel all pending icon requests and clear the queue
 */
export function cancelAllIconRequests() {
  // Abort all pending abort controllers
  abortControllers.forEach((controller, itemId) => {
    controller.abort();
  });
  abortControllers.clear();
  
  // Clear the queue (this will reject all pending promises)
  iconRequestQueue.clear();
  
  // Clear pending requests map
  pendingRequests.clear();
}

/**
 * Cancel icon requests for specific item IDs
 * @param {Array<number>} itemIds - Array of item IDs to cancel requests for
 */
export function cancelIconRequests(itemIds) {
  itemIds.forEach(itemId => {
    // Abort controller if exists
    const controller = abortControllers.get(itemId);
    if (controller) {
      controller.abort();
      abortControllers.delete(itemId);
    }
    // Remove from pending requests
    pendingRequests.delete(itemId);
  });
}
