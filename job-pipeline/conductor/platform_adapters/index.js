/**
 * Platform Adapter Registry
 *
 * Loads all platform adapters and registers them with the application bot.
 */

const greenhouse = require('./greenhouse');
const lever = require('./lever');
const generic = require('./generic');

const adapters = { greenhouse, lever, generic };

/**
 * Register all adapters with the application bot.
 */
function registerAll(bot) {
  for (const [name, adapter] of Object.entries(adapters)) {
    bot.registerAdapter(name, adapter);
  }
}

/**
 * Get adapter by name.
 */
function getAdapter(name) {
  return adapters[name] || adapters.generic;
}

/**
 * List all available adapters.
 */
function list() {
  return Object.keys(adapters).map(name => ({
    name,
    detect: typeof adapters[name].detectPlatform === 'function',
    fill: typeof adapters[name].fillForm === 'function',
    resume: typeof adapters[name].uploadResume === 'function',
    coverLetter: typeof adapters[name].pasteCoverLetter === 'function',
    checkpoint: typeof adapters[name].checkpoint === 'function',
  }));
}

module.exports = { registerAll, getAdapter, list, adapters };
