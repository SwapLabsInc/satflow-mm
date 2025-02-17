const { BaseCollectionManager } = require('../../core/collection-manager');
const { fetchRuneOrders, calculateAveragePriceByDepth } = require('./market');

class RunesCollectionManager extends BaseCollectionManager {
  constructor() {
    super();
  }

  validateProtocolEnvironment() {
    const required = [
      'LOCAL_WALLET_SEED',
      'SATFLOW_API_KEY'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      console.error('Missing required Runes environment variables:', missing.join(', '));
      process.exit(1);
    }
  }

  validateRuneEnvironment(runeTicker) {
    // Remove any 'rune:' prefix if present
    const envTicker = runeTicker.replace(/^rune:/i, '');
    
    // Convert to proper case for API (e.g., DOGGOTOTHEMOON -> doggoToTheMoon)
    const apiTicker = 'doggoToTheMoon';
    
    // Use uppercase for env var names
    const depthKey = `${envTicker}_MARKET_DEPTH_SATS`;
    const depthSats = Number(process.env[depthKey]);
    
    if (!process.env[depthKey]) {
      console.error(`Missing required environment variable: ${depthKey}`);
      process.exit(1);
    }

    if (isNaN(depthSats) || depthSats <= 0) {
      console.error(`${depthKey} must be a positive number`);
      process.exit(1);
    }

    return { envTicker, apiTicker, depthSats };
  }

  async processCollection(runeTicker, walletItems) {
    // Get ticker and depth while handling case conversion
    const { envTicker, apiTicker, depthSats } = this.validateRuneEnvironment(runeTicker);
    
    console.log(`\n=== Processing Rune ${envTicker} ===`);
    
    // Fetch market data and calculate prices
    const orders = await fetchRuneOrders(apiTicker);
    if (!orders || orders.length === 0) {
      console.log(`No orders found for ${envTicker}`);
      return;
    }

    console.log(`\nFound ${orders.length} sell orders`);

    const floorPrice = calculateAveragePriceByDepth(orders, depthSats);
    if (floorPrice <= 0) {
      console.log(`No valid market data for ${envTicker}`);
      return;
    }

    // Calculate listing price
    const listAbovePercent = Number(process.env[`${envTicker}_LIST_ABOVE_PERCENT`]) || 1.2;
    const listingPriceSats = floorPrice * listAbovePercent;
    
    // Calculate bidding price
    const bidBelowPercent = Number(process.env[`${envTicker}_BID_BELOW_PERCENT`]) || 0.8;
    const bidPriceSats = floorPrice * bidBelowPercent;

    console.log('\nMarket Analysis:');
    console.log(`- Floor price: ${floorPrice.toFixed(6)} sats per token`);
    console.log(`- Listing price (${(listAbovePercent * 100).toFixed(1)}%): ${listingPriceSats.toFixed(6)} sats per token`);
    console.log(`- Bid price (${(bidBelowPercent * 100).toFixed(1)}%): ${bidPriceSats.toFixed(6)} sats per token`);

    // TODO: Implement runes wallet balance checking
    console.log('\nWallet Analysis:');
    console.log('Runes wallet balance checking not yet implemented');

    // TODO: Implement runes listing
    console.log('\nListing Analysis:');
    console.log('Runes listing not yet implemented');

    // TODO: Implement runes bidding
    console.log('\nBidding Analysis:');
    console.log('Runes bidding not yet implemented');
  }
}

module.exports = {
  RunesCollectionManager
};
