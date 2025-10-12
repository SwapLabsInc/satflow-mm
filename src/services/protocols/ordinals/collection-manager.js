const { BaseCollectionManager } = require('../../core/collection-manager');
const { OrdinalsBiddingService } = require('./bidding');
const { fetchMarketPrice, calculateAveragePrice, fetchMyListings } = require('./market');
const { listOnSatflow } = require('../../listings');
const { parseBidLadder } = require('../../core/environment');
const { logError } = require('../../../utils/logger');
const { deriveWalletDetails } = require('../../wallet-utils');

class OrdinalsCollectionManager extends BaseCollectionManager {
  constructor() {
    super();
    this.biddingService = new OrdinalsBiddingService();
  }

  validateProtocolEnvironment() {
    const required = [
      'LOCAL_WALLET_SEED',
      'SATFLOW_API_KEY'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      logError('Missing required Ordinals environment variables:', missing.join(', '));
      process.exit(1);
    }
  }

  async processCollection(collectionId, walletItems, biddingAddress, biddingBalance) {
    console.log(`\n=== Processing ${collectionId} ===`);
    console.log(`Using bidding wallet: ${biddingAddress} (${biddingBalance} sats)`);

    // Get existing bids for this collection
    let existingBids = [];
    try {
      const allBids = await this.biddingService.getExistingBids();
      existingBids = this.biddingService.getCollectionBids(allBids, collectionId);
      if (existingBids.length > 0) {
        const totalBidAmount = existingBids[0].price * existingBids.length;
        const collectionLimit = this.getCollectionBidLimit(collectionId);
        console.log(`\nExisting Collection Bids: ${existingBids.length} bids at ${existingBids[0].price} sats`);
        console.log(`Total Bid Amount: ${totalBidAmount} sats`);
        console.log(`Collection Limit: ${collectionLimit} sats`);
        if (totalBidAmount > collectionLimit) {
          console.log(`⚠️ Current bids exceed collection limit by ${totalBidAmount - collectionLimit} sats`);
          console.log(`Will need to cancel approximately ${Math.ceil((totalBidAmount - collectionLimit) / existingBids[0].price)} bids to get under limit`);
        }
      } else {
        console.log('\nNo existing bids for this collection');
      }
    } catch (error) {
      logError(`Failed to fetch existing bids: ${error.message}`);
    }

    // Fetch market data and calculate prices
    const tokens = await fetchMarketPrice(collectionId);
    const averagePrice = calculateAveragePrice(tokens, collectionId);
    if (averagePrice <= 0) {
      console.log(`No valid market data for ${collectionId}`);
      return;
    }

    // Apply price floor to average price if configured
    let flooredAveragePrice = averagePrice;
    const priceFloorBTC = Number(process.env[`${collectionId.toUpperCase()}_PRICE_FLOOR_BTC`]);
    if (priceFloorBTC && !isNaN(priceFloorBTC)) {
      const priceFloorSats = Math.floor(priceFloorBTC * 100000000);
      if (averagePrice < priceFloorSats) {
        console.log(`⚠️ Average price ${averagePrice} sats is below floor ${priceFloorBTC} BTC (${priceFloorSats} sats)`);
        console.log(`   Using floor price as base for all calculations`);
        flooredAveragePrice = priceFloorSats;
      }
    }

    // Calculate listing price using floored average price
    const listAbovePercent = Number(process.env[`${collectionId.toUpperCase()}_LIST_ABOVE_PERCENT`]) || 1.2;
    const listingPriceSats = Math.floor(flooredAveragePrice * listAbovePercent);
    
    // Get max bid to list ratio
    const maxBidToListRatio = Number(process.env.MAX_BID_TO_LIST_RATIO || process.env.MIN_BID_TO_LIST_RATIO);
    
    // Find lowest list price from market data
    const lowestListPrice = Math.min(...tokens.map(t => t.price));
    const maxAllowedBidPrice = Math.floor(lowestListPrice * maxBidToListRatio);
    
    // Check for bid ladder configuration
    const collectionUpper = collectionId.toUpperCase();
    const bidLadderConfig = parseBidLadder(process.env[`${collectionUpper}_BID_LADDER`]);
    
    // Collection limit for bidding
    const collectionLimit = this.getCollectionBidLimit(collectionId);
    
    console.log('\nMarket Analysis:');
    console.log(`- Average price: ${averagePrice} sats`);
    console.log(`- Listing price (${listAbovePercent}x): ${listingPriceSats} sats`);
    console.log(`- Collection bid limit: ${collectionLimit} sats`);
    
    // Determine bidding strategy (ladder or single price)
    let bidStrategy;
    
    if (bidLadderConfig) {
      // Ladder pricing strategy - calculate steps with budget constraints
      
      // First pass: calculate prices
      const stepsWithPrices = bidLadderConfig.map(step => {
        // Calculate price for this step
        // IMPORTANT: For Ordinals, Satflow API requires prices to be in 1000 sat increments
        let price = Math.round(averagePrice * step.pricePercent / 1000) * 1000;
        
        // Ensure price is at least 1000 sats to avoid division issues
        // This is also required by Satflow API for Ordinals
        price = Math.max(price, 1000);
        
        // Ensure price doesn't exceed max allowed
        if (price > maxAllowedBidPrice) {
          // Round down to nearest 1000 sats to comply with Satflow API requirements
          price = Math.floor(maxAllowedBidPrice / 1000) * 1000;
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
      
      // Calculate how many items we can afford at each price point
      const maxItemsByPrice = stepsWithPrices.map(step => {
        // Calculate max items we could buy at this price with entire balance
        return Math.floor(biddingBalance / step.price);
      });
      
      // Calculate total items we could buy if we distributed evenly by allocation
      const totalPossibleItems = maxItemsByPrice.reduce((sum, maxItems, index) => {
        // How many items this step would get based on its allocation percentage
        const itemsForStep = Math.floor(maxItems * (stepsWithPrices[index].allocation / totalAllocation));
        return sum + itemsForStep;
      }, 0);
      
      // Now distribute the items according to allocation percentages
      let remainingBalance = biddingBalance;
      const finalSteps = stepsWithPrices.map((step, index) => {
        // Calculate target quantity based on allocation
        const targetQuantity = Math.floor(maxItemsByPrice[index] * (step.allocation / totalAllocation));
        
        // Ensure we don't exceed remaining balance
        const maxQuantityWithBalance = Math.floor(remainingBalance / step.price);
        const finalQuantity = Math.min(targetQuantity, maxQuantityWithBalance);
        
        // Update remaining balance
        const totalCost = finalQuantity * step.price;
        remainingBalance -= totalCost;
        
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
        console.log(`  Step ${index + 1}: ${step.price} sats (${(step.pricePercent * 100).toFixed(1)}% of avg) - ${step.quantity} items (${(step.allocation * 100).toFixed(1)}% allocation)`);
      });
      
      // Calculate total items across all steps
      const totalItems = bidStrategy.steps.reduce((sum, step) => sum + step.quantity, 0);
      console.log(`- Total items across ladder: ${totalItems}`);
    } else {
      // Single price strategy (backward compatibility)
      const bidBelowPercent = Number(process.env[`${collectionUpper}_BID_BELOW_PERCENT`]) || 0.8;
      
      // Calculate bid price and ensure it's not too high compared to listings
      // IMPORTANT: For Ordinals, Satflow API requires prices to be in 1000 sat increments
      let bidPriceSats = Math.round(averagePrice * bidBelowPercent / 1000) * 1000;
      if (bidPriceSats > maxAllowedBidPrice) {
        console.log(`\nBid price ${bidPriceSats} sats would exceed maximum ratio of ${maxBidToListRatio * 100}% of lowest list price ${lowestListPrice} sats`);
        console.log(`Adjusting bid price down to maximum allowed: ${maxAllowedBidPrice} sats`);
        // Round down to nearest 1000 sats to comply with Satflow API requirements
        bidPriceSats = Math.floor(maxAllowedBidPrice / 1000) * 1000;
      }
      
      const biddingCapacity = this.calculateBiddingCapacity(biddingBalance, bidPriceSats);
      const maxQuantityByLimit = Math.floor(collectionLimit / bidPriceSats);
      const finalBidQuantity = Math.min(biddingCapacity, maxQuantityByLimit);
      
      bidStrategy = {
        type: 'single',
        price: bidPriceSats,
        percent: bidBelowPercent,
        quantity: finalBidQuantity
      };
      
      console.log(`- Using single price strategy: ${bidPriceSats} sats (${bidBelowPercent * 100}% of avg)`);
      console.log(`- Can bid on: ${finalBidQuantity} items at ${bidPriceSats} sats each`);
    }

    // Get update threshold from environment
    const updateThreshold = Number(process.env.UPDATE_THRESHOLD) || 0.01;

    // Always cancel existing bids when using ladder pricing or when price change exceeds threshold
    let shouldCancelBids = false;
    
    if (existingBids.length > 0) {
      console.log('\nChecking bids for repricing and limit compliance:');
      
      // Calculate total of all bids
      const totalBidAmount = existingBids.reduce((sum, bid) => sum + bid.price, 0);
      
      if (totalBidAmount > collectionLimit) {
        console.log(`\nTotal bid amount ${totalBidAmount} exceeds collection limit ${collectionLimit}`);
        shouldCancelBids = true;
      } else if (bidStrategy.type === 'ladder') {
        // Check if we need to update ladder bids
        // First, determine if existing bids match our current ladder strategy
        const existingBidPrices = existingBids.map(bid => bid.price);
        const currentLadderPrices = bidStrategy.steps
          .filter(step => step.quantity > 0)
          .map(step => Math.round(step.price / 1000) * 1000); // Ensure rounding to 1000 sats
        
        // Count bids at each price point
        const existingBidCounts = {};
        existingBidPrices.forEach(price => {
          existingBidCounts[price] = (existingBidCounts[price] || 0) + 1;
        });
        
        // Check if the ladder structure has changed
        let ladderChanged = false;
        
        // Check if we have the same price points
        const existingPricePoints = Object.keys(existingBidCounts).map(Number).sort((a, b) => b - a);
        const newPricePoints = [...new Set(currentLadderPrices)].sort((a, b) => b - a);
        
        if (existingPricePoints.length !== newPricePoints.length) {
          console.log('Ladder structure changed: different number of price points');
          ladderChanged = true;
        } else {
          // Check if price points have changed beyond threshold
          for (let i = 0; i < existingPricePoints.length; i++) {
            const priceDiff = Math.abs(existingPricePoints[i] - newPricePoints[i]);
            const priceChangePercent = priceDiff / existingPricePoints[i];
            
            if (priceChangePercent > updateThreshold) {
              console.log(`Ladder price point ${i+1} changed by ${(priceChangePercent * 100).toFixed(2)}%, exceeding ${updateThreshold * 100}% threshold`);
              ladderChanged = true;
              break;
            }
          }
          
          // Check if distribution has changed
          if (!ladderChanged) {
            for (const price of newPricePoints) {
              const closestExistingPrice = existingPricePoints.reduce((closest, existingPrice) => {
                return Math.abs(existingPrice - price) < Math.abs(closest - price) ? existingPrice : closest;
              });
              
              const existingCount = existingBidCounts[closestExistingPrice] || 0;
              const newCount = bidStrategy.steps.filter(step => 
                Math.round(step.price / 1000) * 1000 === price
              ).reduce((sum, step) => sum + step.quantity, 0);
              
              const countDiff = Math.abs(existingCount - newCount);
              if (countDiff > 1) { // Allow for small differences
                console.log(`Bid distribution changed at price ${price}: was ${existingCount}, now ${newCount}`);
                ladderChanged = true;
                break;
              }
            }
          }
        }
        
        if (ladderChanged) {
          console.log('Ladder pricing structure or distribution has changed - need to cancel existing bids');
          shouldCancelBids = true;
        } else {
          console.log('Ladder pricing structure and distribution unchanged - keeping existing bids');
        }
      } else {
        // For single price strategy, check if price change exceeds threshold
        const priceDiff = Math.abs(existingBids[0].price - bidStrategy.price);
        const priceChangePercent = (priceDiff / existingBids[0].price);
        
        if (priceChangePercent > updateThreshold) {
          console.log(`Price change of ${(priceChangePercent * 100).toFixed(2)}% exceeds ${updateThreshold * 100}% threshold:`);
          console.log(`- Current price: ${existingBids[0].price} sats`);
          console.log(`- New price: ${bidStrategy.price} sats`);
          console.log(`- Affected bids: ${existingBids.length}`);
          shouldCancelBids = true;
        }
      }
    }

    // Cancel bids if needed
    if (existingBids.length > 0 && shouldCancelBids) {
      try {
        const bidIds = existingBids.map(bid => bid.bid_id?.$oid || bid.bid_id);
        await this.biddingService.cancelBids(bidIds);
        console.log(`Cancelled ${bidIds.length} existing bids`);
        existingBids = []; // Clear existing bids after cancellation
      } catch (error) {
        logError('Failed to cancel bids:', error.message);
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
              // Ensure price is rounded to 1000 sat increments for Satflow API
              const roundedPrice = Math.round(step.price / 1000) * 1000;
              console.log(`- Creating bid at ${roundedPrice} sats for ${step.quantity} items (${(step.pricePercent * 100).toFixed(1)}% of avg)...`);
              await this.biddingService.createBid(collectionId, roundedPrice, step.quantity);
            }
          }
        } else {
          // Create single price bid
          if (bidStrategy.quantity > 0) {
            // Ensure price is rounded to 1000 sat increments for Satflow API
            const roundedPrice = Math.round(bidStrategy.price / 1000) * 1000;
            console.log(`\nCreating new bid at ${roundedPrice} sats for ${bidStrategy.quantity} items...`);
            await this.biddingService.createBid(collectionId, roundedPrice, bidStrategy.quantity);
          } else {
            console.log('\nCannot create new bid: would exceed collection bid limit or insufficient balance');
          }
        }
      } catch (error) {
        logError('Failed to create bid:', error.message);
      }
    }

    // Fetch my active listings from both Magic Eden and Satflow
    const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
    const myListings = await fetchMyListings(walletDetails.address, collectionId);
    
    // Create a lookup map for quick access by inscription ID
    const listingsMap = new Map();
    myListings.forEach(listing => {
      listingsMap.set(listing.inscriptionId, listing);
    });

    // Process items for this collection
    const collectionItems = walletItems.filter(item => item.collection?.id === collectionId);
    
    console.log(`\nProcessing ${collectionItems.length} items for listing:`);
    if (collectionItems.length === 0) {
      console.log('No items to list');
      return;
    }

    for (const item of collectionItems) {
      try {
        const inscriptionId = item.token.inscription_id;
        const premiumMultiplier = this.getPremiumMultiplier(inscriptionId);
        let finalListingPrice = listingPriceSats;
        
        if (premiumMultiplier) {
          // Use floored average price for premium inscriptions to respect price floor
          finalListingPrice = Math.floor(flooredAveragePrice * premiumMultiplier);
          console.log(`ℹ Premium price for ${inscriptionId}: ${finalListingPrice} sats (${premiumMultiplier}x average)`);
        }

        // Check if the item is already listed on either platform and within threshold
        const existingListing = listingsMap.get(inscriptionId);
        let shouldList = true;

        if (existingListing) {
          const priceDiff = Math.abs(existingListing.price - finalListingPrice);
          const priceChangePercent = priceDiff / existingListing.price;
          
          if (priceChangePercent <= updateThreshold) {
            console.log(`ℹ Skipping ${inscriptionId}: Listed on ${existingListing.source} at ${existingListing.price} sats (within ${updateThreshold * 100}% threshold)`);
            shouldList = false;
          } else {
            console.log(`ℹ Updating ${inscriptionId}: Price change ${(priceChangePercent * 100).toFixed(2)}% exceeds ${updateThreshold * 100}% threshold`);
            console.log(`  Current (${existingListing.source}): ${existingListing.price} sats → New: ${finalListingPrice} sats`);
          }
        }

        if (shouldList) {
          await listOnSatflow(item, finalListingPrice);
          console.log(`✓ Listed ${inscriptionId} at ${finalListingPrice} sats`);
        }
      } catch (error) {
        logError(`✗ Failed ${item.token.inscription_id}: ${error.message}`);
      }
    }
  }
}

module.exports = {
  OrdinalsCollectionManager
};
