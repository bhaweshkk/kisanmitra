/**
 * lib/validator.js — Startup validation checks
 */
const logger = require('./logger');

async function validate(config) {
  logger.info('Running startup validation...');

  if (!config.GROQ_API_KEY) {
    logger.warn('⚠️  GROQ_API_KEY not set — AI chat will return errors. Get a free key at https://console.groq.com');
  } else {
    logger.info('✅ GROQ_API_KEY configured');
  }

  if (!config.PORT || isNaN(config.PORT)) {
    logger.warn('PORT is invalid, defaulting to 3000');
  }

  const authSecret = process.env.AUTH_SECRET || '';
  if (authSecret.length < 16) {
    logger.warn('⚠️  AUTH_SECRET is too short — set a long random string in .env for production');
  }

  logger.info('Validation complete');
}

module.exports = { validate };
