/**
 * Structured Logger Utility
 */
const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const LEVEL_NAMES = { 0: 'DEBUG', 1: 'INFO', 2: 'WARN', 3: 'ERROR' };
const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';
const MIN_LEVEL = LEVELS[LOG_LEVEL] || LEVELS.INFO;

function getTimestamp() { return new Date().toISOString(); }
function shouldLog(level) { return level >= MIN_LEVEL; }
function format(level, context, message, data) {
  const msg = data ? `${message} ${JSON.stringify(data)}` : message;
  return `[${getTimestamp()}] [${LEVEL_NAMES[level]}] [${context}] ${msg}`;
}

const logger = {
  debug(context, message, data) { if (shouldLog(LEVELS.DEBUG)) console.log(format(LEVELS.DEBUG, context, message, data)); },
  info(context, message, data) { if (shouldLog(LEVELS.INFO)) console.log(format(LEVELS.INFO, context, message, data)); },
  warn(context, message, data) { if (shouldLog(LEVELS.WARN)) console.warn(format(LEVELS.WARN, context, message, data)); },
  error(context, message, error) {
    if (shouldLog(LEVELS.ERROR)) {
      const errorData = error instanceof Error ? { message: error.message, stack: error.stack } : error;
      console.error(format(LEVELS.ERROR, context, message, errorData));
    }
  },
  performance(context, label, startTime, data) {
    const duration = Date.now() - startTime;
    if (shouldLog(LEVELS.INFO)) console.log(format(LEVELS.INFO, context, `${label} completed in ${duration}ms`, data));
  },
};

module.exports = logger;
