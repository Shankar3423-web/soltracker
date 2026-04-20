'use strict';

const Redis = require('ioredis');

/**
 * Mask the password in a Redis URL for safe logging.
 */
function maskUrl(url) {
    if (!url) return 'undefined';
    try {
        const parsed = new URL(url);
        if (parsed.password) {
            parsed.password = '****';
        }
        return parsed.toString();
    } catch (e) {
        return 'invalid-url';
    }
}

/**
 * Resolve the best Redis URL based on the environment.
 */
function getRedisUrl() {
    const isRender = process.env.RENDER === 'true' || !!process.env.RENDER_EXTERNAL_URL;
    
    // Priority lists as requested
    const candidates = isRender
        ? [ process.env.REDIS_INTERNAL_URL, process.env.REDIS_URL, process.env.REDIS_TLS_URL, process.env.REDIS_EXTERNAL_URL ]
        : [ process.env.REDIS_URL, process.env.REDIS_EXTERNAL_URL, process.env.REDIS_TLS_URL, process.env.REDIS_INTERNAL_URL ];

    for (const value of candidates) {
        if (value) return value;
    }

    return 'redis://localhost:6379';
}

/**
 * Resolve the prefix for Redis keys.
 */
function getPrefix() {
    if (process.env.REDIS_PREFIX) return process.env.REDIS_PREFIX;
    
    const isRender = process.env.RENDER === 'true' || !!process.env.RENDER_EXTERNAL_URL;
    return isRender ? 'soltracker:prod' : 'soltracker:dev';
}

const REDIS_URL = getRedisUrl();
const REDIS_PREFIX = getPrefix();

console.log(`[Redis] Initializing connection to: ${maskUrl(REDIS_URL)} (Prefix: ${REDIS_PREFIX})`);

const redisConfig = {
    // BullMQ requirements
    maxRetriesPerRequest: null,
    // Exponential backoff strategy
    retryStrategy(times) {
        const delay = Math.min(times * 100, 3000);
        return delay;
    }
};

// Handle Secure TLS if needed (mostly handled by 'rediss://' in the URL)
const connection = new Redis(REDIS_URL, redisConfig);

connection.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
});

connection.on('connect', () => {
    console.log('[Redis] Connected successfully');
});

/**
 * Execute a Redis operation safely with fallback.
 */
async function safeRedisOperation(operation, fallback = null) {
    try {
        return await operation();
    } catch (err) {
        console.error('[Redis] Safe operation failed:', err.message);
        return fallback;
    }
}

module.exports = {
    connection,
    REDIS_PREFIX,
    safeRedisOperation
};
