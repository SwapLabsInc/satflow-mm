const { BaseCollectionManager } = require('../../core/collection-manager');
const { fetchRuneOrders, calculateAveragePriceByDepth } = require('./market');
const { listOnSatflow } = require('../../listings');
const { RunesBiddingService } = require('./bidding');
const { parseBidLadder } = require('../../core/environment');

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

    // Calculate listing price based on market depth
    const listAbovePercent = Number(process.env[`${envTicker}_LIST_ABOVE_PERCENT`]) || 1.2;
    const listingPriceSats = avgPrice * listAbovePercent;
    
    // Get max bid to list ratio
    const maxBidToListRatio = Number(process.env.MAX_BID_TO_LIST_RATIO || process.env.MIN_BID_TO_LIST_RATIO);
    
    // Find lowest list price from market data
    const lowestListPrice = Math.min(...orders.map(o => o.price));
    const maxAllowedBidPrice = Math.floor(lowestListPrice * maxBidToListRatio);
    
    // Get max bid total for this rune
    const maxBidTotal = Number(process.env[`${envTicker}_MAX_BID_TOTAL`]) || 0;
    
    // Check for bid ladder configuration
    const bidLadderConfig = parseBidLadder(process.env[`${envTicker}_BID_LADDER`]);
    
    // Initialize runeInfo here before using it
    let runeInfo = {
      symbol: '',
      divisibility: 1
    };
    
    // Calculate wallet balance for this rune and get rune info
    let totalBalance = 0;
    
    walletItems.forEach(item => {
      // Match rune ID regardless of formatting (dots vs no dots)
      if (item.collection?.id.replace(/[•]/g, '') === envTicker.replace(/[•]/g, '') && item.token?.rune_amount) {
        totalBalance += Number(item.token.rune_amount);
        if (item.collection.rune_divisibility !== undefined) {
          runeInfo = {
            symbol: item.collection.rune_symbol || '',
            divisibility: item.collection.rune_divisibility
          };
        }
      }
    });
    
    // Format balance for display
    let formattedBalance = '0';
    if (totalBalance > 0) {
      formattedBalance = (totalBalance / Math.pow(10, runeInfo.divisibility)).toLocaleString();
    }
    
    console.log('\nMarket Analysis:');
    console.log(`- Market depth: ${depthSats.toLocaleString()} sats`);
    console.log(`- Average price: ${avgPrice.toFixed(6)} sats per token`);
    console.log(`- Listing price (${(listAbovePercent * 100).toFixed(1)}%): ${listingPriceSats.toFixed(6)} sats per token`);
    console.log(`- Max bid total: ${maxBidTotal.toLocaleString()} sats`);
    
    console.log('\nWallet Analysis:');
    console.log(`${runeInfo.symbol} Balance: ${formattedBalance} tokens`);
    
    // Determine bidding strategy (ladder or single price)
    let bidStrategy;
    
    if (bidLadderConfig) {
      // Ladder pricing strategy - calculate steps with budget constraints
      
      // First pass: calculate prices
      const stepsWithPrices = bidLadderConfig.map(step => {
        // Calculate price for this step
        let price = avgPrice * step.pricePercent;
        
        // Ensure price is at least 0.000001 sats to avoid division issues
        price = Math.max(price, 0.000001);
        
        // Ensure price doesn't exceed max allowed
        if (price > maxAllowedBidPrice) {
          price = maxAllowedBidPrice;
        }
        
        return {
          pricePercent: step.pricePercent,
          allocation: step.allocation,
          price,
          // Quantity will be calculated later
          quantity: 0
        };
      });
      
      // Calculate total allocation (should be 1.0 but might have rounding errors)
      const totalAllocation = stepsWithPrices.reduce((sum, step) => sum + step.allocation, 0);
      
      // Calculate how many tokens we can afford at each price point
      const maxTokensByPrice = stepsWithPrices.map(step => {
        // Calculate max tokens we could buy at this price with entire budget
        return Math.floor(maxBidTotal / step.price);
      });
      
      // Calculate total tokens we could buy if we distributed evenly by allocation
      const totalPossibleTokens = maxTokensByPrice.reduce((sum, maxTokens, index) => {
        // How many tokens this step would get based on its allocation percentage
        const tokensForStep = Math.floor(maxTokens * (stepsWithPrices[index].allocation / totalAllocation));
        return sum + tokensForStep;
      }, 0);
      
      // Now distribute the tokens according to allocation percentages
      let remainingBudget = maxBidTotal;
      const finalSteps = stepsWithPrices.map((step, index) => {
        // Calculate target quantity based on allocation
        const targetQuantity = Math.floor(maxTokensByPrice[index] * (step.allocation / totalAllocation));
        
        // Ensure we don't exceed remaining budget
        const maxQuantityWithBudget = Math.floor(remainingBudget / step.price);
        const finalQuantity = Math.min(targetQuantity, maxQuantityWithBudget);
        
        // Update remaining budget
        const totalCost = finalQuantity * step.price;
        remainingBudget -= totalCost;
        
        return {
          ...step,
          quantity: isFinite(finalQuantity) ? finalQuantity : 0,
          totalCost
        };
      });
      
      bidStrategy = {
        type: 'ladder',
        steps: finalSteps
      };
      
      console.log('- Using ladder pricing strategy:');
      bidStrategy.steps.forEach((step, index) => {
        console.log(`  Step ${index + 1}: ${step.price.toFixed(6)} sats (${(step.pricePercent * 100).toFixed(1)}% of avg) - ${step.quantity.toLocaleString()} tokens (${(step.allocation * 100).toFixed(1)}% allocation)`);
      });
      
      // Calculate total tokens across all steps
      const totalTokens = bidStrategy.steps.reduce((sum, step) => sum + step.quantity, 0);
      console.log(`- Total tokens across ladder: ${totalTokens.toLocaleString()}`);
    } else {
      // Single price strategy (backward compatibility)
      const bidBelowPercent = Number(process.env[`${envTicker}_BID_BELOW_PERCENT`]) || 0.8;
      
      // Calculate initial bid price
      let bidPriceSats = avgPrice * bidBelowPercent;
      
      // Ensure bid price doesn't exceed maximum ratio of lowest list price
      if (bidPriceSats > maxAllowedBidPrice) {
        console.log(`\nBid price ${bidPriceSats.toFixed(6)} sats would exceed maximum ratio of ${maxBidToListRatio * 100}% of lowest list price ${lowestListPrice.toFixed(6)} sats`);
        console.log(`Adjusting bid price down to maximum allowed: ${maxAllowedBidPrice.toFixed(6)} sats`);
        bidPriceSats = maxAllowedBidPrice;
      }
      
      // Calculate how many tokens we can bid on with our max total
      const biddingCapacity = Math.floor(maxBidTotal / bidPriceSats);
      
      bidStrategy = {
        type: 'single',
        price: bidPriceSats,
        percent: bidBelowPercent,
        quantity: biddingCapacity,
        totalAmount: Math.floor(biddingCapacity * bidPriceSats)
      };
      
      console.log(`- Using single price strategy: ${bidPriceSats.toFixed(6)} sats (${(bidBelowPercent * 100).toFixed(1)}% of avg)`);
      console.log(`- Can bid on: ${biddingCapacity.toLocaleString()} tokens at ${bidPriceSats.toFixed(6)} sats each`);
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
        const totalBidAmount = existingBids.reduce((sum, bid) => sum + bid.price, 0);
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

    // Get update threshold from environment
    const updateThreshold = Number(process.env.UPDATE_THRESHOLD) || 0.01;
    
    // Always cancel existing bids when using ladder pricing or when price change exceeds threshold
    let shouldCancelBids = false;
    
    if (existingBids.length > 0) {
      console.log('\nChecking bids for repricing and limit compliance:');
      
      // Calculate total of all bids
      const totalBidAmount = existingBids.reduce((sum, bid) => sum + bid.price, 0);
      
      if (totalBidAmount > maxBidTotal) {
        console.log(`\nTotal bid amount ${totalBidAmount.toLocaleString()} exceeds max total ${maxBidTotal.toLocaleString()}`);
        console.log(`Need to cancel bids to get under limit`);
        shouldCancelBids = true;
      } else if (bidStrategy.type === 'ladder') {
        // Check if we need to update ladder bids
        // First, determine if existing bids match our current ladder strategy
        
        // Group existing bids by total price
        const existingBidsByPrice = {};
        let totalExistingBidAmount = 0;
        
        existingBids.forEach(bid => {
          const price = bid.price;
          existingBidsByPrice[price] = (existingBidsByPrice[price] || 0) + 1;
          totalExistingBidAmount += price;
        });
        
        // Group new ladder bids by total price
        const newBidsByPrice = {};
        let totalNewBidAmount = 0;
        
        bidStrategy.steps.forEach(step => {
          if (step.quantity > 0) {
            const totalPrice = Math.floor(step.price * step.quantity);
            newBidsByPrice[totalPrice] = (newBidsByPrice[totalPrice] || 0) + 1;
            totalNewBidAmount += totalPrice;
          }
        });
        
      // Check if the ladder structure has changed
      let ladderChanged = false;
      
      // Get the current market average price from the bidStrategy steps
      const currentAvgPrice = bidStrategy.steps[0].price / bidStrategy.steps[0].pricePercent;
      
      // Extract existing bid prices and quantities
      const existingBidDetails = [];
      existingBids.forEach(bid => {
        const runeMetadata = bid.runes_metadata?.runes[0];
        if (runeMetadata) {
          const divisibility = runeMetadata?.divisibility || 0;
          const quantity = Number(runeMetadata.amount) / Math.pow(10, divisibility);
          const pricePerToken = bid.price / quantity;
          existingBidDetails.push({
            price: pricePerToken,
            quantity,
            totalPrice: bid.price
          });
        }
      });
      
      // Sort existing bids by price (descending)
      existingBidDetails.sort((a, b) => b.price - a.price);
      
      // Compare existing bids with new ladder steps
      if (existingBidDetails.length !== bidStrategy.steps.length) {
        console.log(`Ladder structure changed: different number of price points (existing: ${existingBidDetails.length}, new: ${bidStrategy.steps.length})`);
        ladderChanged = true;
      } else {
        // Check if the price points have changed beyond threshold
        console.log('\nComparing existing bids with new ladder:');
        
        for (let i = 0; i < existingBidDetails.length; i++) {
          const existingPrice = existingBidDetails[i].price;
          const newPrice = bidStrategy.steps[i].price;
          
          const priceDiff = Math.abs(existingPrice - newPrice);
          const priceChangePercent = priceDiff / existingPrice;
          
          console.log(`- Step ${i+1}: Current price ${existingPrice.toFixed(6)} sats/token, New price ${newPrice.toFixed(6)} sats/token`);
          console.log(`  Change: ${(priceChangePercent * 100).toFixed(2)}% (threshold: ${updateThreshold * 100}%)`);
          
          if (priceChangePercent > updateThreshold) {
            console.log(`  Exceeds threshold - needs update`);
            ladderChanged = true;
            break;
          }
          
          // Also check quantity differences
          const existingQuantity = existingBidDetails[i].quantity;
          const newQuantity = bidStrategy.steps[i].quantity;
          const quantityDiff = Math.abs(existingQuantity - newQuantity);
          const quantityChangePercent = existingQuantity > 0 ? quantityDiff / existingQuantity : 1;
          
          console.log(`  Quantity: Current ${existingQuantity.toLocaleString()}, New ${newQuantity.toLocaleString()}`);
          console.log(`  Change: ${(quantityChangePercent * 100).toFixed(2)}%`);
          
          // If quantity changed by more than 10%, update bids
          if (quantityChangePercent > 0.1) {
            console.log(`  Quantity change exceeds 10% - needs update`);
            ladderChanged = true;
            break;
          }
        }
      }
      
      // Also check if total bid amount has changed significantly
      const totalAmountDiff = Math.abs(totalExistingBidAmount - totalNewBidAmount);
      const totalAmountChangePercent = totalAmountDiff / totalExistingBidAmount;
      
      if (totalAmountChangePercent > updateThreshold) {
        console.log(`\nTotal bid amount changed by ${(totalAmountChangePercent * 100).toFixed(2)}%, exceeding ${updateThreshold * 100}% threshold`);
        console.log(`- Current total: ${totalExistingBidAmount.toLocaleString()} sats`);
        console.log(`- New total: ${totalNewBidAmount.toLocaleString()} sats`);
        ladderChanged = true;
      }
        
      if (ladderChanged) {
        console.log('\nLadder pricing structure or distribution has changed - need to cancel existing bids');
        shouldCancelBids = true;
      } else {
        console.log('\nLadder pricing structure and distribution unchanged - keeping existing bids');
        console.log('Note: If this seems incorrect, check if the market average price has changed significantly.');
        console.log('Current market average price: ' + avgPrice.toFixed(6) + ' sats/token');
      }
      } else {
        // For single price strategy, check if price change exceeds threshold
        // Calculate current price per token using runes metadata
        const currentBid = existingBids[0];
        const runeMetadata = currentBid.runes_metadata?.runes[0];
        const divisibility = runeMetadata?.divisibility || 0;
        const currentQuantity = runeMetadata ? Number(runeMetadata.amount) / Math.pow(10, divisibility) : 0;
        const currentPricePerToken = currentBid.price / currentQuantity;
        
        const priceDiff = Math.abs(currentPricePerToken - bidStrategy.price);
        const priceChangePercent = priceDiff / currentPricePerToken;
        
        if (priceChangePercent > updateThreshold) {
          console.log(`Price change of ${(priceChangePercent * 100).toFixed(2)}% exceeds ${updateThreshold * 100}% threshold:`);
          console.log(`- Current price: ${currentPricePerToken.toFixed(6)} sats/token (${currentBid.price.toLocaleString()} sats total)`);
          console.log(`- New price: ${bidStrategy.price.toFixed(6)} sats/token`);
          console.log(`- Affected bids: ${existingBids.length}`);
          shouldCancelBids = true;
        } else {
          console.log(`ℹ Current price ${currentPricePerToken.toFixed(6)} sats/token is within ${updateThreshold * 100}% threshold`);
        }
      }
    }

    // Cancel bids if needed
    if (existingBids.length > 0 && shouldCancelBids) {
      try {
        const bidIds = existingBids.map(bid => bid.bid_id);
        await this.biddingService.cancelBids(bidIds);
        console.log(`Cancelled ${bidIds.length} existing bids`);
        existingBids = []; // Clear existing bids after cancellation
      } catch (error) {
        console.error('Failed to cancel bids:', error.message);
      }
    }

    // Create new bids if we have no existing bids
    if (existingBids.length === 0) {
      try {
        if (bidStrategy.type === 'ladder') {
          // Create ladder bids
          console.log('\nCreating ladder bids:');
          for (const step of bidStrategy.steps) {
            if (step.quantity > 0) {
              const bidAmount = Math.floor(step.price * step.quantity);
              console.log(`- Creating bid at ${bidAmount.toLocaleString()} sats for ${step.quantity.toLocaleString()} tokens (${step.price.toFixed(6)} sats/token)...`);
              await this.biddingService.createBid(envTicker, bidAmount, step.quantity);
            }
          }
        } else {
          // Create single price bid
          if (bidStrategy.quantity > 0) {
            console.log(`\nCreating new bid at ${bidStrategy.totalAmount.toLocaleString()} sats for ${bidStrategy.quantity.toLocaleString()} tokens (${bidStrategy.price.toFixed(6)} sats/token)...`);
            await this.biddingService.createBid(envTicker, bidStrategy.totalAmount, bidStrategy.quantity);
          } else {
            console.log('\nCannot create new bid: would exceed max bid total or insufficient balance');
          }
        }
      } catch (error) {
        console.error('Failed to create bid:', error.message);
      }
    }
  }
}

module.exports = {
  RunesCollectionManager
};
