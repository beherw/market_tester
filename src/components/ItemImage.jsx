// Item image component using XIVAPI
import { useState, useEffect, useRef, useCallback } from 'react';
import { getItemImageUrl, getItemImageUrlSync, getCalculatedIconUrls } from '../utils/itemImage';

export default function ItemImage({ itemId, alt, className, priority = false, loadDelay = 0, isTradable = undefined, ...props }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [fallbackUrls, setFallbackUrls] = useState([]);
  const [currentFallbackIndex, setCurrentFallbackIndex] = useState(0);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [usingCalculatedUrl, setUsingCalculatedUrl] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const timeoutRef = useRef(null);
  const imgRef = useRef(null);
  const abortControllerRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const fallbackUrlsRef = useRef([]);
  const currentFallbackIndexRef = useRef(0);
  const isTradableRef = useRef(isTradable);

  // Update ref when isTradable changes
  useEffect(() => {
    isTradableRef.current = isTradable;
  }, [isTradable]);

  // Simplified icon loading: wait for sort, then load sequentially from top to bottom
  // Only load icons for page 1 items, respecting API rate limits
  useEffect(() => {
    // Very large delays (>= 100000ms) indicate "wait for sort" - don't load yet
    const waitForSortThreshold = 100000;
    
    // If delay is very large, we're waiting for sorting - don't load yet
    if (loadDelay >= waitForSortThreshold) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setShouldLoad(false);
      return;
    }
    
    // Clear any pending timeouts
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    // Don't load if item is explicitly marked as untradeable
    if (isTradable === false) {
      setShouldLoad(false);
      return;
    }
    
    // Load with the specified delay (sequential loading from top to bottom)
    // Delay is calculated as index * 53ms to respect API rate limits (19 req/sec)
    timeoutRef.current = setTimeout(() => {
      // Check isTradable when timeout fires using ref (current value)
      // This allows icons to load even if tradeability data loads asynchronously
      if (isTradableRef.current === false) {
        setShouldLoad(false);
      } else {
        setShouldLoad(true);
      }
    }, loadDelay);
    
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [loadDelay, isTradable]);

  // Load image with retry logic
  const loadImage = useCallback((attemptNumber = 0) => {
    if (!itemId || itemId <= 0) {
      setIsLoading(false);
      setHasError(true);
      return;
    }

    // Check cache first
    const cachedUrl = getItemImageUrlSync(itemId);
    if (cachedUrl) {
      setImageUrl(cachedUrl);
      setIsLoading(false);
      setHasError(false);
      setUsingCalculatedUrl(false);
      setRetryCount(0);
      return;
    }

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();
    const abortSignal = abortControllerRef.current.signal;

    // Set calculated fallback URLs
    const calculatedUrls = getCalculatedIconUrls(itemId);
    setFallbackUrls(calculatedUrls);
    fallbackUrlsRef.current = calculatedUrls; // Also store in ref for error handler
    currentFallbackIndexRef.current = 0; // Reset index

    // Track if we're using calculated URL (use ref to avoid stale closure)
    let isUsingCalculated = false;

    setIsLoading(true);

    // Fetch from API (no priority flag - sequential loading respects rate limits)
    getItemImageUrl(itemId, abortSignal, false)
      .then(url => {
        // Check if component is still mounted and request wasn't cancelled
        if (abortSignal.aborted) {
          return;
        }
        if (url) {
          // Update to API URL if we got one (replaces calculated URL)
          setImageUrl(url);
          setHasError(false);
          setUsingCalculatedUrl(false);
          setRetryCount(0); // Reset retry count on success
        } else {
          // API failed, try retry if we haven't exceeded max retries
          if (attemptNumber < 2) {
            // Retry after a delay (exponential backoff: 500ms, 1000ms)
            const retryDelay = (attemptNumber + 1) * 500;
            retryTimeoutRef.current = setTimeout(() => {
              // CRITICAL: Check if request was aborted before retrying
              if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
                loadImage(attemptNumber + 1);
              }
            }, retryDelay);
          } else {
            // Max retries reached, use calculated URLs if available
            if (calculatedUrls.length > 0 && !isUsingCalculated) {
              setImageUrl(calculatedUrls[0]);
              setCurrentFallbackIndex(0);
              currentFallbackIndexRef.current = 0;
              setUsingCalculatedUrl(true);
            } else if (calculatedUrls.length === 0) {
              setHasError(true);
            }
          }
        }
        setIsLoading(false);
      })
      .catch(error => {
        // Ignore cancellation errors
        if (error.message === 'Request cancelled' || abortSignal.aborted) {
          return;
        }
        
        // Try retry if we haven't exceeded max retries
        if (attemptNumber < 2) {
          // Retry after a delay (exponential backoff: 500ms, 1000ms)
          const retryDelay = (attemptNumber + 1) * 500;
          retryTimeoutRef.current = setTimeout(() => {
            // CRITICAL: Check if request was aborted before retrying
            if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
              loadImage(attemptNumber + 1);
            }
          }, retryDelay);
        } else {
          // Max retries reached
          console.error(`Failed to load item image after ${attemptNumber + 1} attempts:`, error);
          // Keep using calculated URLs if we have them
          if (calculatedUrls.length > 0 && !isUsingCalculated) {
            setImageUrl(calculatedUrls[0]);
            setCurrentFallbackIndex(0);
            currentFallbackIndexRef.current = 0;
            setUsingCalculatedUrl(true);
          } else if (calculatedUrls.length === 0) {
            setHasError(true);
          }
        }
        setIsLoading(false);
      });
  }, [itemId, priority]);

  // 加载图片
  useEffect(() => {
    if (!shouldLoad) {
      // CRITICAL: When shouldLoad becomes false, abort any pending requests and clear retry timeouts
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      return;
    }

    // Reset retry count when starting a new load
    setRetryCount(0);
    
    // Start loading
    loadImage(0);

    // Cleanup: abort request on unmount or when itemId/shouldLoad changes
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [itemId, shouldLoad, loadImage]);

  const handleImageError = useCallback(() => {
    // Use refs to get current values (avoids stale closure issues)
    const currentIndex = currentFallbackIndexRef.current;
    const urls = fallbackUrlsRef.current;
    
    // Try next fallback URL
    if (currentIndex < urls.length - 1) {
      const nextIndex = currentIndex + 1;
      currentFallbackIndexRef.current = nextIndex;
      setCurrentFallbackIndex(nextIndex);
      setImageUrl(urls[nextIndex]);
    } else {
      // All fallback URLs failed, retry API call if we haven't exceeded max retries
      setRetryCount(prevCount => {
        if (prevCount < 2) {
          const newRetryCount = prevCount + 1;
          // Retry after a delay (exponential backoff: 500ms, 1000ms)
          const retryDelay = newRetryCount * 500;
          retryTimeoutRef.current = setTimeout(() => {
            // Reset fallback index and retry loading
            currentFallbackIndexRef.current = 0;
            setCurrentFallbackIndex(0);
            loadImage(newRetryCount);
          }, retryDelay);
          return newRetryCount;
        } else {
          // Max retries reached, all URLs failed
          setHasError(true);
          setImageUrl(null);
          return prevCount;
        }
      });
    }
  }, [loadImage]);

  // Extract width and height from className to maintain aspect ratio
  const getDimensions = () => {
    if (!className) return { width: 'w-10', height: 'h-10' };
    
    // Match Tailwind width/height classes (w-10, w-20, h-10, etc.)
    const widthMatch = className.match(/\bw-(\d+)\b/);
    const heightMatch = className.match(/\bh-(\d+)\b/);
    
    const width = widthMatch ? `w-${widthMatch[1]}` : 'w-10';
    const height = heightMatch ? `h-${heightMatch[1]}` : 'h-10';
    
    return { width, height };
  };

  const { width, height } = getDimensions();
  // Preserve other classes from className but ensure dimensions are set
  const otherClasses = className?.split(' ').filter(c => !c.match(/^(w-|h-)/)).join(' ') || '';
  const containerClasses = `${width} ${height} bg-purple-900/40 rounded border border-purple-500/30 flex items-center justify-center flex-shrink-0 ${otherClasses}`.trim();

  // No longer using Intersection Observer - simplified sequential loading

  // Show placeholder while loading or on error - always reserve space
  if (!shouldLoad) {
    // 尚未开始加载，显示占位符
    return (
      <div ref={imgRef} className={containerClasses}>
        <span className="text-xs text-gray-500 opacity-50">...</span>
      </div>
    );
  }

  if (isLoading || (hasError && !imageUrl)) {
    return (
      <div ref={imgRef} className={containerClasses}>
        {isLoading ? (
          <span className="text-xs text-gray-500 animate-pulse">...</span>
        ) : (
          <span className="text-xs text-gray-500">?</span>
        )}
      </div>
    );
  }

  if (!imageUrl) {
    return (
      <div ref={imgRef} className={containerClasses}>
        <span className="text-xs text-gray-500">?</span>
      </div>
    );
  }

  return (
    <div ref={imgRef} className={containerClasses}>
      <img
        src={imageUrl}
        alt={alt || `Item ${itemId}`}
        className="w-full h-full object-contain"
        onError={handleImageError}
        data-item-id={itemId}
        {...props}
      />
    </div>
  );
}
