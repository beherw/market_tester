import { useState, useRef, useEffect } from 'react';
import { formatRelativeTime, formatLocalTime } from '../utils/timeFormat';

/**
 * Component to display last upload times for all servers in a DC
 * @param {Object} props
 * @param {Object} props.worldUploadTimes - Object mapping world IDs to timestamps (in seconds)
 * @param {Object} props.worlds - Object mapping world IDs to world names
 * @param {Array} props.dcWorlds - Array of world IDs in the data center
 */
export default function ServerUploadTimes({ worldUploadTimes, worlds, dcWorlds }) {
  const [tooltipState, setTooltipState] = useState({ show: false, x: 0, y: 0, content: '' });
  const [activeCell, setActiveCell] = useState(null); // For touch devices
  const tableRef = useRef(null);
  const tooltipRef = useRef(null);
  
  if (!worldUploadTimes || !worlds || !dcWorlds || dcWorlds.length === 0) {
    return null;
  }

  // Get all worlds with their upload times in the same order as server selector
  // Handle both string and number keys in worldUploadTimes
  // Keep the order from dcWorlds array to match ServerSelector
  const worldData = dcWorlds
    .map(worldId => ({
      worldId,
      worldName: worlds[worldId] || `伺服器 ${worldId}`,
      uploadTime: worldUploadTimes[worldId] || worldUploadTimes[String(worldId)] || null,
    }));

  // Helper function to get color class based on recency
  const getTimeColorClass = (uploadTime) => {
    if (!uploadTime) return 'text-gray-500';
    
    const normalizedTimestamp = uploadTime > 10000000000 ? Math.floor(uploadTime / 1000) : uploadTime;
    const now = Math.floor(Date.now() / 1000);
    const diff = now - normalizedTimestamp;
    
    // Less than 1 hour - very recent (green)
    if (diff < 3600) return 'text-emerald-400';
    // Less than 6 hours - recent (light green/yellow)
    if (diff < 21600) return 'text-yellow-400';
    // Less than 24 hours - moderate (yellow)
    if (diff < 86400) return 'text-amber-400';
    // Less than 3 days - getting old (orange)
    if (diff < 259200) return 'text-orange-400';
    // Very old (red)
    return 'text-red-400';
  };

  // Detect if device supports touch
  const isTouchDevice = () => {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  };

  // Calculate tooltip position with boundary detection
  const calculateTooltipPosition = (elementRect, tableRect) => {
    const tooltipWidth = 280; // Approximate tooltip width
    const tooltipHeight = 40; // Approximate tooltip height
    const padding = 8;
    
    // X position: center of the element, but keep within viewport
    let x = elementRect.left + elementRect.width / 2;
    const minX = tooltipWidth / 2 + padding;
    const maxX = window.innerWidth - tooltipWidth / 2 - padding;
    x = Math.max(minX, Math.min(maxX, x));
    
    // Y position: above the table
    const y = tableRect.top - padding;
    
    return { x, y };
  };

  // Handle tooltip show/hide - tooltip always shows above the table
  const showTooltip = (e, uploadTime) => {
    if (!uploadTime || !tableRef.current) return;
    const elementRect = e.currentTarget.getBoundingClientRect();
    const tableRect = tableRef.current.getBoundingClientRect();
    const tooltipContent = formatLocalTime(uploadTime);
    const position = calculateTooltipPosition(elementRect, tableRect);
    
    setTooltipState({
      show: true,
      x: position.x,
      y: position.y,
      content: tooltipContent
    });
  };

  const handleMouseEnter = (e, uploadTime) => {
    if (!isTouchDevice()) {
      showTooltip(e, uploadTime);
    }
  };

  const handleMouseLeave = () => {
    if (!isTouchDevice() && activeCell === null) {
      setTooltipState({ show: false, x: 0, y: 0, content: '' });
    }
  };

  // Handle touch/click events for mobile devices
  const handleTouchStart = (e, uploadTime, cellId) => {
    if (isTouchDevice()) {
      // Toggle tooltip on tap
      if (activeCell === cellId) {
        setActiveCell(null);
        setTooltipState({ show: false, x: 0, y: 0, content: '' });
      } else {
        setActiveCell(cellId);
        showTooltip(e, uploadTime);
      }
    }
  };

  // Close tooltip when clicking outside on touch devices
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (isTouchDevice() && activeCell !== null) {
        if (tooltipRef.current && !tooltipRef.current.contains(e.target)) {
          setActiveCell(null);
          setTooltipState({ show: false, x: 0, y: 0, content: '' });
        }
      }
    };

    if (activeCell !== null) {
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [activeCell]);

  // Update tooltip position on scroll/resize
  useEffect(() => {
    const updateTooltipPosition = () => {
      if (tooltipState.show && tableRef.current) {
        const activeElement = document.querySelector(`[data-cell-id="${activeCell}"]`);
        if (activeElement) {
          const elementRect = activeElement.getBoundingClientRect();
          const tableRect = tableRef.current.getBoundingClientRect();
          const position = calculateTooltipPosition(elementRect, tableRect);
          setTooltipState(prev => ({ ...prev, x: position.x, y: position.y }));
        }
      }
    };

    window.addEventListener('scroll', updateTooltipPosition, true);
    window.addEventListener('resize', updateTooltipPosition);

    return () => {
      window.removeEventListener('scroll', updateTooltipPosition, true);
      window.removeEventListener('resize', updateTooltipPosition);
    };
  }, [tooltipState.show, activeCell]);

  // Tooltip component - always shows above the table
  const Tooltip = () => {
    if (!tooltipState.show) return null;
    return (
      <div 
        ref={tooltipRef}
        className="fixed px-2 sm:px-3 py-1.5 sm:py-2 bg-gradient-to-br from-slate-900/98 via-purple-900/95 to-slate-900/98 backdrop-blur-md text-white text-xs sm:text-sm rounded-lg shadow-2xl pointer-events-auto sm:pointer-events-none whitespace-normal sm:whitespace-nowrap z-[999999] border border-purple-500/60 glow-blue max-w-[90vw] sm:max-w-none sm:min-w-max"
        style={{
          left: `${tooltipState.x}px`,
          bottom: `${window.innerHeight - tooltipState.y}px`,
          transform: 'translateX(-50%)',
        }}
      >
        <div className="relative z-10">
          <div className="flex items-center gap-1.5">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-ffxiv-gold flex-shrink-0" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
              strokeWidth={2}
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
              />
            </svg>
            <span className="text-ffxiv-gold font-semibold break-words">{tooltipState.content}</span>
          </div>
        </div>
        {/* Arrow pointing down */}
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-px">
          <div className="border-4 border-transparent border-t-purple-900/95"></div>
        </div>
        {/* Glow effect */}
        <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-purple-500/20 via-transparent to-purple-500/20 pointer-events-none"></div>
      </div>
    );
  };

  return (
    <>
      <Tooltip />
      <div className="bg-gradient-to-br from-slate-800/60 via-purple-900/20 to-slate-800/60 backdrop-blur-sm rounded-lg border border-purple-500/20 p-2 sm:p-4 relative z-10">
        {/* Header */}
        <div className="flex items-center gap-2 mb-2 sm:mb-3">
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            className="h-4 w-4 sm:h-5 sm:w-5 text-ffxiv-gold flex-shrink-0" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
            strokeWidth={2}
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" 
            />
          </svg>
          <h4 className="text-sm sm:text-base md:text-lg font-semibold text-ffxiv-gold truncate">
            物品資料最後上報時間
          </h4>
        </div>
        
        {/* Grid container - each server name and time paired together */}
        <div className="relative overflow-x-auto -mx-2 sm:mx-0">
          <div className="inline-block min-w-full px-2 sm:px-0">
            <div ref={tableRef} className="bg-purple-900/20 rounded border border-purple-500/20 overflow-hidden">
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 divide-x divide-purple-500/20">
                {worldData.map(({ worldId, worldName, uploadTime }) => {
                  const timeColorClass = getTimeColorClass(uploadTime);
                  const nameCellId = `name-${worldId}`;
                  const timeCellId = `time-${worldId}`;
                  const isNameActive = activeCell === nameCellId;
                  const isTimeActive = activeCell === timeCellId;
                  
                  return (
                    <div
                      key={worldId}
                      className="flex flex-col border-b border-purple-500/20 last:border-b-0"
                    >
                      {/* Server name */}
                      <div
                        data-cell-id={nameCellId}
                        className={`group relative py-1.5 sm:py-2 px-1 sm:px-2 text-xs font-medium text-gray-200 text-center truncate transition-colors hover:text-ffxiv-gold active:text-ffxiv-gold cursor-pointer select-none ${
                          isNameActive ? 'text-ffxiv-gold' : ''
                        }`}
                        style={{ touchAction: 'manipulation' }}
                        onMouseEnter={(e) => handleMouseEnter(e, uploadTime)}
                        onMouseLeave={handleMouseLeave}
                        onClick={(e) => handleTouchStart(e, uploadTime, nameCellId)}
                        title={uploadTime ? formatLocalTime(uploadTime) : '無數據'}
                      >
                        <span className="truncate block">{worldName}</span>
                      </div>
                      {/* Time */}
                      <div
                        data-cell-id={timeCellId}
                        className={`group relative py-1.5 sm:py-2 px-1 sm:px-2 text-xs text-center font-medium transition-colors cursor-pointer select-none ${
                          isTimeActive ? 'text-ffxiv-gold' : timeColorClass
                        } hover:text-ffxiv-gold active:text-ffxiv-gold`}
                        style={{ touchAction: 'manipulation' }}
                        onMouseEnter={(e) => handleMouseEnter(e, uploadTime)}
                        onMouseLeave={handleMouseLeave}
                        onClick={(e) => handleTouchStart(e, uploadTime, timeCellId)}
                        title={uploadTime ? formatLocalTime(uploadTime) : '無數據'}
                      >
                        {uploadTime ? (
                          <span className="inline-block truncate max-w-full" title={formatRelativeTime(uploadTime)}>
                            {formatRelativeTime(uploadTime)}
                          </span>
                        ) : (
                          <span className="text-gray-500 italic">無數據</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
