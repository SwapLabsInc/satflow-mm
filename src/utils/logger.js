/**
 * Centralized logging utility with color support
 * Provides red error logging to make errors more visible in console output
 */

// ANSI color codes
const COLORS = {
  RED: '\x1b[31m',
  RESET: '\x1b[0m'
};

/**
 * Log an error message in red text
 * @param {...any} args - Arguments to log (same as console.error)
 */
function logError(...args) {
  // Format all arguments with red color
  const coloredArgs = args.map(arg => {
    if (typeof arg === 'string') {
      return `${COLORS.RED}${arg}${COLORS.RESET}`;
    }
    return arg;
  });
  
  console.error(...coloredArgs);
}

/**
 * Log a regular message (no color change)
 * @param {...any} args - Arguments to log
 */
function logInfo(...args) {
  console.log(...args);
}

/**
 * Log a warning message (keeping existing behavior for now)
 * @param {...any} args - Arguments to log
 */
function logWarn(...args) {
  console.warn(...args);
}

module.exports = {
  logError,
  logInfo,
  logWarn
};
