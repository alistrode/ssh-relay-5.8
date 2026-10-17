// Diagnostics stay on stderr; command history is bounded and private.
const history = [];
export const logger = {
  info(message) {
    if (process.env.RELAY_MCP_VERBOSE) console.error(message);
  },
  debug() {},
  warn(message) {
    console.error(message);
  },
  error(message) {
    console.error(message);
  },
  record(entry) {
    history.push({ ...entry, timestamp: new Date().toISOString() });
    if (history.length > 1000) history.shift();
  },
  getHistory(limit = 20) {
    return history.slice(-limit);
  },
};
