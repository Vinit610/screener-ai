/**
 * Indian Stock API Data Source
 * Provides 5-year historical trend data with Upstash Redis caching.
 * 
 * Philosophy: Detachable module for easy adjustment/replacement.
 * - Fetches once per month (30-day Redis TTL)
 * - Caches in Upstash Redis (persistent across GitHub Actions runs)
 * - Compacts data before passing to LLM (no raw time series bloat)
 * - All data transformations isolated in this module
 * - Falls back gracefully if Redis unavailable
 */

import { createClient } from 'redis';

const CACHE_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days
const CACHE_KEY_PREFIX = 'trends:';

let redisClient = null;
let redisReady = false;

/**
 * Initialize Redis client from Upstash credentials
 */
async function initRedis() {
  if (redisReady) return redisClient !== null;
  
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!redisUrl || !redisToken) {
    console.warn('[IndianAPI] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set; caching disabled');
    redisReady = true;
    return false;
  }
  
  try {
    // Upstash format: https://[subdomain].upstash.io
    // Convert to rediss:// (TLS) for node-redis client
    const redisProtocolUrl = redisUrl
      .replace('https://', 'rediss://')
      .replace('http://', 'redis://')
      + ':6379?password=' + redisToken;
    
    redisClient = createClient({
      url: redisProtocolUrl,
      socket: { reconnectStrategy: (retries) => Math.min(retries * 50, 500) }
    });
    
    redisClient.on('error', (err) => console.warn('[IndianAPI] Redis error:', err.message));
    
    await redisClient.connect();
    console.log('[IndianAPI] Connected to Upstash Redis');
    redisReady = true;
    return true;
  } catch (err) {
    console.warn('[IndianAPI] Redis connection failed — caching disabled:', err.message);
    redisReady = true;
    redisClient = null;
    return false;
  }
}

/**
 * Get cached trends from Redis
 */
async function readCache(symbol) {
  if (!redisClient) return null;
  
  try {
    const cacheKey = CACHE_KEY_PREFIX + symbol.replace(/\./g, '_').toUpperCase();
    const cached = await redisClient.get(cacheKey);
    
    if (cached) {
      console.log(`[IndianAPI] Using cached data for ${symbol}`);
      return JSON.parse(cached);
    }
    return null;
  } catch (err) {
    console.warn(`[IndianAPI] Cache read error for ${symbol}:`, err.message);
    return null;
  }
}

/**
 * Write trends to Redis with 30-day TTL
 */
async function writeCache(symbol, data) {
  if (!redisClient) return;
  
  try {
    const cacheKey = CACHE_KEY_PREFIX + symbol.replace(/\./g, '_').toUpperCase();
    const cacheEntry = {
      symbol,
      fetchedAt: new Date().toISOString().split('T')[0],
      expiresAt: new Date(Date.now() + CACHE_EXPIRY_SECONDS * 1000).toISOString().split('T')[0],
      data,
    };
    
    await redisClient.setEx(cacheKey, CACHE_EXPIRY_SECONDS, JSON.stringify(cacheEntry));
    console.log(`[IndianAPI] Cached trends for ${symbol} in Redis (30-day TTL)`);
  } catch (err) {
    console.error(`[IndianAPI] Cache write error for ${symbol}:`, err.message);
  }
}

/**
 * Calculate basic statistics from a data array
 */
function calculateStats(values) {
  const valid = values.filter(v => v != null && Number.isFinite(v));
  if (valid.length === 0) return null;

  valid.sort((a, b) => a - b);
  const min = valid[0];
  const max = valid[valid.length - 1];
  const median = valid.length % 2 === 0
    ? (valid[valid.length / 2 - 1] + valid[valid.length / 2]) / 2
    : valid[Math.floor(valid.length / 2)];
  const mean = valid.reduce((a, b) => a + b) / valid.length;

  return { min, max, median, mean };
}

/**
 * Calculate CAGR (Compound Annual Growth Rate)
 */
function calculateCAGR(startValue, endValue, years) {
  if (startValue <= 0 || endValue <= 0 || years <= 0) return null;
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b) / values.length;
  const variance = values.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Calculate trend acceleration
 */
function calculateAcceleration(dataPoints) {
  if (dataPoints.length < 4) return null;
  
  const mid = Math.floor(dataPoints.length / 2);
  const earlierPeriod = dataPoints.slice(0, mid);
  const recentPeriod = dataPoints.slice(mid);
  
  const calculateSlope = (points) => {
    const n = points.length;
    const xSum = (n * (n - 1)) / 2;
    const ySum = points.reduce((a, b) => a + b, 0);
    const xySum = points.reduce((sum, y, i) => sum + i * y, 0);
    const x2Sum = (n * (n - 1) * (2 * n - 1)) / 6;
    
    const slope = (n * xySum - xSum * ySum) / (n * x2Sum - xSum * xSum);
    return slope;
  };
  
  const earlierSlope = calculateSlope(earlierPeriod);
  const recentSlope = calculateSlope(recentPeriod);
  
  if (Math.abs(recentSlope) > Math.abs(earlierSlope) * 1.2) return 'accelerating';
  if (Math.abs(recentSlope) < Math.abs(earlierSlope) * 0.8) return 'decelerating';
  return null;
}

/**
 * Determine trend direction
 */
function determineTrend(current, median, recent3YearAvg, stdDev) {
  const highThreshold = median * 1.10;
  const lowThreshold = median * 0.90;
  const improveThreshold = median * 1.05;
  const declineThreshold = median * 0.95;
  
  if (current > highThreshold) return 'elevated';
  if (current < lowThreshold) return 'depressed';
  
  if (recent3YearAvg) {
    if (recent3YearAvg > improveThreshold && current >= recent3YearAvg * 0.98) return 'improving';
    if (recent3YearAvg < declineThreshold && current <= recent3YearAvg * 1.02) return 'declining';
  }
  
  if (stdDev && median && stdDev / median > 0.25) return 'volatile';
  
  return 'stable';
}

/**
 * Compact raw API response into summary metrics
 */
function compactTrendMetrics(rawResponse, symbol) {
  if (!rawResponse || !rawResponse.datasets) {
    console.warn(`[IndianAPI] No datasets in response for ${symbol}`);
    return null;
  }

  const result = { symbol, trends: {} };

  for (const dataset of rawResponse.datasets) {
    const { metric, values } = dataset;
    if (!values || values.length < 2) continue;

    const dataPoints = values
      .map(([, val]) => val)
      .filter(v => v != null && Number.isFinite(v));

    if (dataPoints.length === 0) continue;

    const stats = calculateStats(dataPoints);
    if (!stats) continue;

    const current = dataPoints[dataPoints.length - 1];
    const recentMonthsCount = Math.min(12, Math.ceil(dataPoints.length / 5));
    const recentData = dataPoints.slice(-recentMonthsCount);
    const recentAvg = recentData.reduce((a, b) => a + b) / recentData.length;
    const recentStats = calculateStats(recentData);
    
    const years = dataPoints.length > 252 ? dataPoints.length / 252 : Math.max(1, dataPoints.length / 52);
    const cagr = calculateCAGR(dataPoints[0], current, Math.max(1, years));
    
    const stdDev = calculateStdDev(dataPoints);
    const volatility = stats.mean !== 0 ? (stdDev / stats.mean) * 100 : 0;
    
    const acceleration = calculateAcceleration(dataPoints);
    
    const rangePosition = stats.max !== stats.min 
      ? ((current - stats.min) / (stats.max - stats.min)) * 100
      : 50;

    result.trends[metric] = {
      current: Math.round(current * 100) / 100,
      median: Math.round(stats.median * 100) / 100,
      mean: Math.round(stats.mean * 100) / 100,
      min: Math.round(stats.min * 100) / 100,
      max: Math.round(stats.max * 100) / 100,
      recentAvg: Math.round(recentAvg * 100) / 100,
      recentHigh: Math.round(recentStats.max * 100) / 100,
      recentLow: Math.round(recentStats.min * 100) / 100,
      cagr: cagr ? Math.round(cagr * 100) / 100 : null,
      recentTrendCagr: recentData.length > 1 
        ? Math.round(calculateCAGR(recentData[0], recentData[recentData.length - 1], recentMonthsCount / 12) * 100) / 100
        : null,
      volatility: Math.round(volatility * 100) / 100,
      rangePosition: Math.round(rangePosition),
      direction: determineTrend(current, stats.median, recentAvg, stdDev),
      acceleration: acceleration,
      dataPoints: dataPoints.length,
    };
  }

  return result.trends;
}

/**
 * Fetch historical trends from Indian Stock API
 */
export async function fetchHistoricalTrends(symbol, period = '5yr', filters = ['default', 'pe', 'sm', 'ptb', 'evebitda', 'mcs']) {
  try {
    // Initialize Redis on first call
    if (!redisReady) {
      await initRedis();
    }
    
    const cleanSymbol = symbol.replace(/\.(NS|BO)$/i, '');

    // Check cache first
    const cached = await readCache(cleanSymbol);
    if (cached) {
      return cached.data;
    }

    const apiKey = process.env.INDIAN_STOCK_API_KEY;
    if (!apiKey) {
      console.warn('[IndianAPI] INDIAN_STOCK_API_KEY not set; skipping historical trends');
      return null;
    }

    console.log(`[IndianAPI] Fetching trends for ${symbol} (period: ${period}, filters: ${filters.join(',')})`);

    // API accepts a single filter per call, so fetch each filter separately and merge
    const allDatasets = [];
    for (const filter of filters) {
      const url = `https://stock.indianapi.in/historical_data?stock_name=${cleanSymbol}&period=${period}&filter=${filter}`;

      const response = await fetch(url, {
        headers: { 'X-Api-Key': apiKey },
      });

      if (!response.ok) {
        console.warn(`[IndianAPI] API error for ${symbol} filter=${filter}: ${response.status} ${response.statusText}`);
        continue;
      }

      const data = await response.json();
      if (data?.datasets) {
        allDatasets.push(...data.datasets);
      }

      // Small delay between calls to avoid rate limiting
      if (filters.indexOf(filter) < filters.length - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    if (allDatasets.length === 0) {
      console.warn(`[IndianAPI] No valid data from any filter for ${symbol}`);
      return null;
    }

    const compactedTrends = compactTrendMetrics({ datasets: allDatasets }, cleanSymbol);
    if (!compactedTrends) {
      console.warn(`[IndianAPI] No valid trends extracted for ${symbol}`);
      return null;
    }

    // Cache in Redis
    await writeCache(cleanSymbol, compactedTrends);

    return compactedTrends;
  } catch (err) {
    console.error(`[IndianAPI] Error fetching trends for ${symbol}:`, err.message);
    return null;
  }
}

/**
 * Format trends for LLM
 */
export function formatTrendsForLLM(compactedTrends) {
  if (!compactedTrends || Object.keys(compactedTrends).length === 0) {
    return null;
  }

  let text = `── Historical Trends (5-Year) ──\n`;

  const fmt = (name, data, suffix) => {
    if (!data) return '';
    const { current, median, recentAvg, cagr, recentTrendCagr, direction, acceleration, volatility } = data;
    let line = `${name}: ${current}${suffix}`;
    if (median) {
      const pctDiff = ((Math.abs(current - median) / median) * 100).toFixed(1);
      const vs = current > median ? 'above' : 'below';
      line += ` (median ${median}${suffix} ${vs} ${pctDiff}%)`;
    }
    if (cagr !== null && cagr !== undefined) {
      line += ` [5Y: ${cagr > 0 ? '+' : ''}${cagr}%`;
      if (recentTrendCagr !== null) line += `, 1Y: ${recentTrendCagr > 0 ? '+' : ''}${recentTrendCagr}%`;
      line += `]`;
    }
    line += ` | ${direction}`;
    if (acceleration) line += ` (${acceleration})`;
    if (volatility && volatility > 25) line += ` ~${volatility}% vol`;
    return line + `\n`;
  };

  if (compactedTrends.pe) text += fmt('P/E', compactedTrends.pe, 'x');
  
  const npmData = compactedTrends.sm?.npm || compactedTrends.sm?.NPM;
  if (npmData) text += fmt('Net Margin', npmData, '%');
  
  const opmData = compactedTrends.sm?.opm || compactedTrends.sm?.OPM;
  if (opmData) text += fmt('Operating Margin', opmData, '%');
  
  const gpmData = compactedTrends.sm?.gpm || compactedTrends.sm?.GPM;
  if (gpmData) text += fmt('Gross Margin', gpmData, '%');
  
  if (compactedTrends.ptb) text += fmt('P/B', compactedTrends.ptb, 'x');
  if (compactedTrends.evebitda) text += fmt('EV/EBITDA', compactedTrends.evebitda, 'x');
  if (compactedTrends.mcs) text += fmt('Market Cap/Sales', compactedTrends.mcs, 'x');
  
  if (compactedTrends.default) {
    const { current, recentHigh, recentLow, recentAvg, direction } = compactedTrends.default;
    if (current) {
      let priceLine = `Price: ₹${current} |`;
      if (recentHigh && recentLow) priceLine += ` 1Y: ₹${recentLow}-${recentHigh} |`;
      if (recentAvg) {
        const move = ((current - recentAvg) / recentAvg * 100).toFixed(1);
        priceLine += ` vs avg: ${move > 0 ? '+' : ''}${move}% |`;
      }
      priceLine += ` Momentum: ${direction}\n`;
      text += priceLine;
    }
  }

  text += `\n`;
  return text;
}

/**
 * Clear cache from Redis
 */
export async function clearCache(symbol = 'all') {
  if (!redisClient) return;
  
  try {
    if (symbol === 'all') {
      const keys = await redisClient.keys(CACHE_KEY_PREFIX + '*');
      if (keys.length > 0) {
        await redisClient.del(keys);
        console.log(`[IndianAPI] Cleared ${keys.length} cached entries from Redis`);
      }
    } else {
      const cacheKey = CACHE_KEY_PREFIX + symbol.replace(/\./g, '_').toUpperCase();
      const deleted = await redisClient.del(cacheKey);
      if (deleted) console.log(`[IndianAPI] Cleared cache for ${symbol}`);
    }
  } catch (err) {
    console.error('[IndianAPI] Error clearing cache:', err.message);
  }
}

/**
 * Close Redis connection
 */
export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    console.log('[IndianAPI] Redis connection closed');
    redisClient = null;
    redisReady = false;
  }
}
