#!/usr/bin/env node
/**
 * Test script to validate Indian Stock API integration
 * 
 * Usage:
 *   node test_indian_api_integration.mjs
 *   node test_indian_api_integration.mjs --clear-cache
 */

import { fetchHistoricalTrends, clearCache } from './pipeline/data_sources/indian_stock_api.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ Indian Stock API Integration Test');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Check environment
  const apiKey = process.env.INDIAN_STOCK_API_KEY;
  console.log(`✓ Environment Check`);
  if (!apiKey) {
    console.log('  ⚠ INDIAN_STOCK_API_KEY not set');
    console.log('    Action: Set INDIAN_STOCK_API_KEY in .env.local or environment\n');
  } else {
    console.log('  ✓ INDIAN_STOCK_API_KEY present (length: ' + apiKey.length + ' chars)\n');
  }

  // Check cache directory
  const cacheDir = path.join(__dirname, 'pipeline', '.cache');
  console.log(`✓ Cache Directory Check`);
  if (fs.existsSync(cacheDir)) {
    console.log(`  ✓ Cache directory exists: ${cacheDir}`);
    const files = fs.readdirSync(cacheDir);
    console.log(`  ✓ Cached files: ${files.length}\n`);
  } else {
    console.log(`  ℹ Cache directory will be created on first fetch\n`);
  }

  // Handle --clear-cache flag
  if (process.argv.includes('--clear-cache')) {
    console.log(`✓ Clearing Cache`);
    clearCache('all');
    console.log('  ✓ Cache cleared\n');
    return;
  }

  // Test function signature
  console.log(`✓ Module Verification`);
  console.log(`  ✓ fetchHistoricalTrends function loaded`);
  console.log(`  ✓ Function is ${typeof fetchHistoricalTrends}: ${fetchHistoricalTrends.toString().substring(0, 60)}...\n`);

  // Test with a sample stock (if API key is set)
  if (apiKey) {
    console.log(`✓ Testing API Call (Sample Stock: INFY)`);
    console.log('  ℹ Fetching trends...\n');
    
    try {
      const trends = await fetchHistoricalTrends('INFY', '5yr');
      
      if (trends) {
        console.log(`  ✓ API call successful`);
        console.log(`  ✓ Trends data returned`);
        console.log(`  ✓ Metrics available: ${Object.keys(trends).join(', ')}\n`);

        // Show sample compact data
        if (trends.pe) {
          console.log(`  Sample Compact Data (P/E):`);
          console.log(`    Current: ${trends.pe.current}x`);
          console.log(`    Median:  ${trends.pe.median}x`);
          console.log(`    CAGR:    ${trends.pe.cagr}%`);
          console.log(`    Direction: ${trends.pe.direction}\n`);
        }

        // Check cache
        const cacheFile = path.join(cacheDir, 'trends_INFY.json');
        if (fs.existsSync(cacheFile)) {
          const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
          console.log(`  ✓ Cache file created: trends_INFY.json`);
          console.log(`  ✓ Expires: ${cached.expiresAt}\n`);
        }
      } else {
        console.log(`  ⚠ No trends data returned (API key may be invalid)\n`);
      }
    } catch (err) {
      console.log(`  ✗ Error: ${err.message}\n`);
    }
  } else {
    console.log(`\n⚠ API Key Required for Full Test`);
    console.log('  Set INDIAN_STOCK_API_KEY to test API connectivity\n');
  }

  // Next steps
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║ Next Steps`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);
  console.log(`\n1. Set INDIAN_STOCK_API_KEY in .env.local:`);
  console.log(`   export INDIAN_STOCK_API_KEY="your_api_key_here"\n`);
  console.log(`2. Run analysis pipeline with trends:`);
  console.log(`   node pipeline/analysis/generate_analyses.mjs --symbol INFY\n`);
  console.log(`3. Verify trends in output (look for "── Historical Trends (5-Year) ──")\n`);
  console.log(`4. Clear cache if needed:`);
  console.log(`   node test_indian_api_integration.mjs --clear-cache\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
