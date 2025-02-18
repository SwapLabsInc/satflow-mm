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
    
    // Keep ticker in original case for API
    const apiTicker = envTicker;
    
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

    // Calculate market depth average price
    const avgPrice = calculateAveragePriceByDepth(orders, depthSats);
    if (avgPrice <= 0) {
      console.log(`No valid market data for ${envTicker}`);
      return;
    }

    // Calculate listing and bidding prices based on market depth
    const listAbovePercent = Number(process.env[`${envTicker}_LIST_ABOVE_PERCENT`]) || 1.2;
    const listingPriceSats = avgPrice * listAbovePercent;
    
    const bidBelowPercent = Number(process.env[`${envTicker}_BID_BELOW_PERCENT`]) || 0.8;
    const bidPriceSats = avgPrice * bidBelowPercent;

    console.log('\nMarket Analysis:');
    console.log(`- Market depth: ${depthSats.toLocaleString()} sats`);
    console.log(`- Average price: ${avgPrice.toFixed(6)} sats per token`);
    console.log(`- Listing price (${(listAbovePercent * 100).toFixed(1)}%): ${listingPriceSats.toFixed(6)} sats per token`);
    console.log(`- Bid price (${(bidBelowPercent * 100).toFixed(1)}%): ${bidPriceSats.toFixed(6)} sats per token`);

    // Calculate wallet balance for this rune
    console.log('\nWallet Analysis:');
    let totalBalance = 0;
    let runeInfo = null;

    walletItems.forEach(item => {
      // Match rune ID regardless of formatting (dots vs no dots)
      if (item.collection?.id.replace(/[•]/g, '') === envTicker.replace(/[•]/g, '') && item.token?.rune_amount) {
        totalBalance += Number(item.token.rune_amount);
        if (!runeInfo && item.collection.rune_divisibility !== undefined) {
          runeInfo = {
            symbol: item.collection.rune_symbol || '',
            divisibility: item.collection.rune_divisibility
          };
        }
      }
    });

    if (totalBalance > 0 && runeInfo) {
      const formattedBalance = (totalBalance / Math.pow(10, runeInfo.divisibility)).toLocaleString();
      console.log(`${runeInfo.symbol} Balance: ${formattedBalance} tokens`);
    } else {
      console.log('No balance found for this rune');
    }

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
