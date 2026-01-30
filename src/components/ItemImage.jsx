// Item image component using XIVAPI
import { useState, useEffect, useRef, useCallback } from 'react';
import { getItemImageUrl, getItemImageUrlSync, getCalculatedIconUrls } from '../utils/itemImage';

export default function ItemImage({ itemId, alt, className, priority = false, loadDelay = 0, isTradable = undefined, ...props }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [iconIsLoading, setIconIsLoading] = useState(true);
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
      setIconIsLoading(false);
      setHasError(true);
      return;
    }

    // Check cache first
    const cachedUrl = getItemImageUrlSync(itemId);
    if (cachedUrl) {
      setImageUrl(cachedUrl);
      setIconIsLoading(false);
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

    // OPTIMIZATION: Immediately show calculated URL for instant visual feedback
    // This makes the page feel much faster - users see icons immediately
    // The API URL will replace it in the background when available
    if (calculatedUrls.length > 0) {
      // Always set calculated URL if available - this ensures we show something immediately
      setImageUrl(calculatedUrls[0]);
      setUsingCalculatedUrl(true);
      // Keep iconIsLoading=true to show loading indicator while fetching API URL
      setIconIsLoading(true);
    } else {
      // No calculated URL - set loading state and wait for API
      setIconIsLoading(true);
    }

    // Fetch from API (no priority flag - sequential loading respects rate limits)
    // This runs in background - calculated URL is already shown for instant feedback
    getItemImageUrl(itemId, abortSignal)
      .then(url => {
        // Check if component is still mounted and request wasn't cancelled
        if (abortSignal.aborted) {
          return;
        }
        if (url) {
          // Update to API URL if we got one (replaces calculated URL seamlessly)
          // Only update if different to avoid unnecessary re-renders
          setImageUrl(prevUrl => {
            if (prevUrl !== url) {
              setUsingCalculatedUrl(false);
              return url;
            }
            return prevUrl;
          });
          setHasError(false);
          setRetryCount(0); // Reset retry count on success
          setIconIsLoading(false); // API URL loaded, stop loading indicator
        } else {
          // API failed, but we already have calculated URL showing
          // Only retry if we don't have a calculated URL
          if (calculatedUrls.length === 0) {
            // No calculated URL available, try retry
            if (attemptNumber < 2) {
              const retryDelay = (attemptNumber + 1) * 500;
              retryTimeoutRef.current = setTimeout(() => {
                if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
                  loadImage(attemptNumber + 1);
                }
              }, retryDelay);
            } else {
              setHasError(true);
              setIconIsLoading(false);
            }
          } else {
            // Have calculated URL, stop loading indicator
            setIconIsLoading(false);
          }
        }
      })
      .catch(error => {
        // Ignore cancellation errors
        if (error.message === 'Request cancelled' || abortSignal.aborted) {
          return;
        }
        
        // Try retry only if no calculated URL available
        if (calculatedUrls.length === 0) {
          if (attemptNumber < 2) {
            const retryDelay = (attemptNumber + 1) * 500;
            retryTimeoutRef.current = setTimeout(() => {
              if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
                loadImage(attemptNumber + 1);
              }
            }, retryDelay);
          } else {
            console.error(`Failed to load item image after ${attemptNumber + 1} attempts:`, error);
            setHasError(true);
            setIconIsLoading(false);
          }
        } else {
          // Have calculated URL, stop loading indicator
          setIconIsLoading(false);
        }
      });
  }, [itemId]);

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
      // Clear imageUrl when shouldLoad becomes false to prevent stale images
      // But keep iconIsLoading state to avoid flickering
      return;
    }

    // Reset retry count when starting a new load
    setRetryCount(0);
    // Reset error state when starting to load
    setHasError(false);
    // Reset loading state when starting to load
    setIconIsLoading(true);
    
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
    // 尚未开始加载，显示loading indicator
    return (
      <div ref={imgRef} className={containerClasses}>
        <div className="flex gap-1">
          <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}></span>
          <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1s' }}></span>
          <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1s' }}></span>
        </div>
      </div>
    );
  }

  // If we have an image URL (calculated or API), show it immediately
  // Show loading indicator (three dots) on top of image while fetching API URL
  if (imageUrl) {
    return (
      <div ref={imgRef} className={`${containerClasses} relative`}>
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-contain"
          onError={handleImageError}
          data-item-id={itemId}
          {...props}
        />
        {/* Loading indicator: three animated dots */}
        {iconIsLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded pointer-events-none">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}></span>
              <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1s' }}></span>
              <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1s' }}></span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // No image URL yet - show loading or error state
  if (iconIsLoading) {
    return (
      <div ref={imgRef} className={containerClasses}>
        <div className="flex gap-1">
          <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}></span>
          <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1s' }}></span>
          <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1s' }}></span>
        </div>
      </div>
    );
  }

  if (hasError) {
    // Show loading indicator even on error - cleaner UI
    return (
      <div ref={imgRef} className={containerClasses}>
        <div className="flex gap-1">
          <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}></span>
          <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1s' }}></span>
          <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1s' }}></span>
        </div>
      </div>
    );
  }

  // Fallback (shouldn't reach here) - show loading indicator
  return (
    <div ref={imgRef} className={containerClasses}>
      <div className="flex gap-1">
        <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms', animationDuration: '1s' }}></span>
        <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '200ms', animationDuration: '1s' }}></span>
        <span className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '400ms', animationDuration: '1s' }}></span>
      </div>
    </div>
  );
}
