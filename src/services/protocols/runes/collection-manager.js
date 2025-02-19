const { BaseCollectionManager } = require('../../core/collection-manager');
const { fetchRuneOrders, calculateAveragePriceByDepth } = require('./market');
const { listOnSatflow } = require('../../listings');
const { RunesBiddingService } = require('./bidding');

class RunesCollectionManager extends BaseCollectionManager {
  constructor() {
    super();
    this.biddingService = new RunesBiddingService();
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
    const maxBidToListRatio = Number(process.env.MAX_BID_TO_LIST_RATIO || process.env.MIN_BID_TO_LIST_RATIO);
    
    // Calculate initial bid price
    let bidPriceSats = avgPrice * bidBelowPercent;
    
    // Find lowest list price from market data
    const lowestListPrice = Math.min(...orders.map(o => o.price));
    const maxAllowedBidPrice = Math.floor(lowestListPrice * maxBidToListRatio);
    
    // Ensure bid price doesn't exceed maximum ratio of lowest list price
    if (bidPriceSats > maxAllowedBidPrice) {
      console.log(`\nBid price ${bidPriceSats.toFixed(6)} sats would exceed maximum ratio of ${maxBidToListRatio * 100}% of lowest list price ${lowestListPrice.toFixed(6)} sats`);
      console.log(`Adjusting bid price down to maximum allowed: ${maxAllowedBidPrice.toFixed(6)} sats`);
      bidPriceSats = maxAllowedBidPrice;
    }

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

    // Process items for listing
    console.log('\nListing Analysis:');
    // Note: For runes, the token.inscription_id field actually contains the UTXO ID needed for runes_output
    // This is different from ordinals where inscription_id is used directly
    const runeItems = walletItems.filter(item => 
      item.collection?.id.replace(/[•]/g, '') === envTicker.replace(/[•]/g, '') && 
      item.token?.rune_amount && 
      item.token?.inscription_id
    );

    // Process listings if we have items
    if (runeItems.length === 0) {
      console.log('No items to list');
    } else {
      console.log(`Processing ${runeItems.length} items for listing:`);
      const updateThreshold = Number(process.env.UPDATE_THRESHOLD) || 0.01;

      for (const item of runeItems) {
        try {
        // IMPORTANT: For runes, we must use inscription_number (not rune_amount) to determine 
        // the number of tokens in this UTXO. This is counter-intuitive because:
        // - rune_amount shows the raw amount (e.g. 9201700000)
        // - inscription_number shows the actual token count (e.g. 92017)
        // This discrepancy exists because rune_amount includes decimal places
        const runeAmount = Number(item.token.inscription_number);
        // Use inscription_id as runes_output (it's actually the UTXO ID for runes)
        const inscriptionId = item.token.inscription_id;
        const totalListingPrice = Math.floor(listingPriceSats * runeAmount);

        // Check if the item is already listed and within threshold
        const existingListing = item.listing;
        let shouldList = true;

        if (existingListing) {
          const priceDiff = Math.abs(existingListing.price - totalListingPrice);
          const priceChangePercent = priceDiff / existingListing.price;
          
          if (priceChangePercent <= updateThreshold) {
            console.log(`ℹ Skipping ${inscriptionId}: Current price ${existingListing.price} sats is within ${updateThreshold * 100}% threshold`);
            shouldList = false;
          } else {
            console.log(`ℹ Updating ${inscriptionId}: Price change ${(priceChangePercent * 100).toFixed(2)}% exceeds ${updateThreshold * 100}% threshold`);
            console.log(`  Current: ${existingListing.price} sats → New: ${totalListingPrice} sats`);
          }
        }

        if (shouldList) {
          await listOnSatflow(item, totalListingPrice);
          console.log(`✓ Listed ${inscriptionId} (${runeAmount.toLocaleString()} tokens) at ${totalListingPrice.toLocaleString()} sats`);
        }
        } catch (error) {
          console.error(`✗ Failed ${item.token.runes_output}: ${error.message}`);
        }
      }
    }

    // Always process bids, even if we don't hold any runes
    console.log('\nBidding Analysis:');
    
    // Get existing bids for this rune
    let existingBids = [];
    try {
      const allBids = await this.biddingService.getExistingBids();
      existingBids = this.biddingService.getCollectionBids(allBids, envTicker);
      if (existingBids.length > 0) {
        const totalBidAmount = existingBids[0].price * existingBids.length;
        const maxBidTotal = Number(process.env[`${envTicker}_MAX_BID_TOTAL`]) || 0;
        console.log(`\nExisting Rune Bids: ${existingBids.length} bids at ${existingBids[0].price} sats`);
        console.log(`Total Bid Amount: ${totalBidAmount.toLocaleString()} sats`);
        console.log(`Max Bid Total: ${maxBidTotal.toLocaleString()} sats`);
        if (totalBidAmount > maxBidTotal) {
          console.log(`⚠️ Current bids exceed max total by ${(totalBidAmount - maxBidTotal).toLocaleString()} sats`);
          console.log(`Will need to cancel approximately ${Math.ceil((totalBidAmount - maxBidTotal) / existingBids[0].price)} bids to get under limit`);
        }
      } else {
        console.log('\nNo existing bids for this rune');
      }
    } catch (error) {
      console.error(`Failed to fetch existing bids: ${error.message}`);
    }

    // Get update threshold and max bid total
    const updateThreshold = Number(process.env.UPDATE_THRESHOLD) || 0.01;
    const maxBidTotal = Number(process.env[`${envTicker}_MAX_BID_TOTAL`]) || 0;

    // Use base divisibility of 1 if we don't have rune info
    if (!runeInfo) {
      runeInfo = {
        symbol: '',
        divisibility: 1
      };
    }
    // Calculate how many tokens we can bid on with our max total
    const biddingCapacity = Math.floor(maxBidTotal / bidPriceSats);
    // Calculate total bid amount in sats (this is what we send to the API)
    const totalBidAmount = Math.floor(maxBidTotal);
    
    // Check if existing bids need to be repriced or exceed limit
    if (existingBids.length > 0) {
      console.log('\nChecking bids for repricing and limit compliance:');
      const bidsToCancel = [];
      
      // Calculate total of all bids
      const totalBidAmount = existingBids[0].price * existingBids.length;
      
      if (totalBidAmount > maxBidTotal) {
        console.log(`\nTotal bid amount ${totalBidAmount.toLocaleString()} exceeds max total ${maxBidTotal.toLocaleString()}`);
        bidsToCancel.push(...existingBids.map(bid => bid.bid_id));
      } else {
        // Calculate current price per token using runes metadata
        const currentBid = existingBids[0];
        const runeMetadata = currentBid.runes_metadata?.runes[0];
        const divisibility = runeMetadata?.divisibility || 0;
        const currentQuantity = runeMetadata ? Number(runeMetadata.amount) / Math.pow(10, divisibility) : 0;
        const currentPricePerToken = currentBid.price / currentQuantity;
        const priceDiff = Math.abs(currentPricePerToken - bidPriceSats);
        const priceChangePercent = priceDiff / currentPricePerToken;
        
        if (priceChangePercent > updateThreshold) {
          console.log(`Price change of ${(priceChangePercent * 100).toFixed(2)}% exceeds ${updateThreshold * 100}% threshold:`);
          console.log(`- Current price: ${currentPricePerToken.toFixed(6)} sats/token (${currentBid.price.toLocaleString()} sats total)`);
          console.log(`- New price: ${bidPriceSats.toFixed(6)} sats/token`);
          console.log(`- Affected bids: ${existingBids.length}`);
          bidsToCancel.push(...existingBids.map(bid => bid.bid_id));
        } else {
          console.log(`ℹ Current price ${currentPricePerToken.toFixed(6)} sats/token is within ${updateThreshold * 100}% threshold`);
        }
      }

      if (bidsToCancel.length > 0) {
        try {
          await this.biddingService.cancelBids(bidsToCancel);
          
          // IMPORTANT: We must cancel existing bids before creating new ones because:
          // 1. Price changes require removing old bids to maintain correct market pricing
          // 2. The API requires bids to be cancelled before new ones can be placed
          // 3. This ensures we don't temporarily exceed our max bid total during the update
          
          // Calculate remaining capacity after cancellations
          const remainingBids = existingBids.filter(bid => !bidsToCancel.includes(bid.bid_id));
          const remainingBidsTotal = remainingBids.reduce((total, bid) => total + bid.price, 0);
          const availableForBidding = maxBidTotal - remainingBidsTotal;
          
          // Calculate new bid quantity based on available capacity
          const maxQuantityByTotal = Math.floor(availableForBidding / bidPriceSats);
          const finalBidQuantity = Math.min(biddingCapacity, maxQuantityByTotal);

          if (finalBidQuantity > 0) {
            const finalBidAmount = Math.floor(finalBidQuantity * bidPriceSats);
            console.log(`Creating new bid at ${finalBidAmount.toLocaleString()} sats for ${finalBidQuantity.toLocaleString()} tokens (${bidPriceSats.toFixed(6)} sats/token)...`);
            await this.biddingService.createBid(envTicker, finalBidAmount, finalBidQuantity);
          } else {
            console.log('Cannot create new bid: would exceed max bid total');
          }
        } catch (error) {
          console.error('Failed to update bids:', error.message);
        }
      }
    }

    // If no existing bids and we have bidding capacity, create a new bid
    if (existingBids.length === 0 && biddingCapacity > 0) {
      try {
        const totalBidAmount = Math.floor(biddingCapacity * bidPriceSats);
        console.log(`\nCreating new bid at ${totalBidAmount.toLocaleString()} sats for ${biddingCapacity.toLocaleString()} tokens (${bidPriceSats.toFixed(6)} sats/token)...`);
        await this.biddingService.createBid(envTicker, totalBidAmount, biddingCapacity);
      } catch (error) {
        console.error('Failed to create bid:', error.message);
      }
    }
  }
}

module.exports = {
  RunesCollectionManager
};
