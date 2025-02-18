const { BaseCollectionManager } = require('../../core/collection-manager');
const { OrdinalsBiddingService } = require('./bidding');
const { fetchMarketPrice, calculateAveragePrice } = require('./market');
const { listOnSatflow } = require('../../listings');

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
      console.error('Missing required Ordinals environment variables:', missing.join(', '));
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
      console.error(`Failed to fetch existing bids: ${error.message}`);
    }

    // Fetch market data and calculate prices
    const tokens = await fetchMarketPrice(collectionId);
    const averagePrice = calculateAveragePrice(tokens, collectionId);
    if (averagePrice <= 0) {
      console.log(`No valid market data for ${collectionId}`);
      return;
    }

    // Calculate listing price
    const listAbovePercent = Number(process.env[`${collectionId.toUpperCase()}_LIST_ABOVE_PERCENT`]) || 1.2;
    const listingPriceSats = Math.floor(averagePrice * listAbovePercent);
    
    // Calculate bidding price and capacity
    const bidBelowPercent = Number(process.env[`${collectionId.toUpperCase()}_BID_BELOW_PERCENT`]) || 0.8;
    const maxBidToListRatio = Number(process.env.MAX_BID_TO_LIST_RATIO || process.env.MIN_BID_TO_LIST_RATIO);
    
    // Find lowest list price from market data
    const lowestListPrice = Math.min(...tokens.map(t => t.price));
    const maxAllowedBidPrice = Math.floor(lowestListPrice * maxBidToListRatio);
    
    // Calculate bid price and ensure it's not too high compared to listings
    let bidPriceSats = Math.round(averagePrice * bidBelowPercent / 1000) * 1000;
    if (bidPriceSats > maxAllowedBidPrice) {
      console.log(`\nBid price ${bidPriceSats} sats would exceed maximum ratio of ${maxBidToListRatio * 100}% of lowest list price ${lowestListPrice} sats`);
      console.log(`Adjusting bid price down to maximum allowed: ${maxAllowedBidPrice} sats`);
      bidPriceSats = maxAllowedBidPrice;
    }
    
    const biddingCapacity = this.calculateBiddingCapacity(biddingBalance, bidPriceSats);
    
    console.log('\nMarket Analysis:');
    console.log(`- Average price: ${averagePrice} sats`);
    console.log(`- Listing price (${listAbovePercent}x): ${listingPriceSats} sats`);
    console.log(`- Bid price (${bidBelowPercent}x): ${bidPriceSats} sats`);
    console.log(`- Can bid on: ${biddingCapacity} items at ${bidPriceSats} sats each`);

    // Get update threshold from environment
    const updateThreshold = Number(process.env.UPDATE_THRESHOLD) || 0.01;

    // Check if existing bids need to be repriced or exceed limit
    if (existingBids.length > 0) {
      console.log('\nChecking bids for repricing and limit compliance:');
      const bidsToCancel = [];
      const collectionLimit = this.getCollectionBidLimit(collectionId);
      
      // Calculate total of all bids
      const totalBidAmount = existingBids[0].price * existingBids.length;
      
      if (totalBidAmount > collectionLimit) {
        console.log(`\nTotal bid amount ${totalBidAmount} exceeds collection limit ${collectionLimit}`);
        bidsToCancel.push(...existingBids.map(bid => bid.bid_id));
      } else {
        const priceDiff = Math.abs(existingBids[0].price - bidPriceSats);
        const priceChangePercent = (priceDiff / existingBids[0].price);
        
        if (priceChangePercent > updateThreshold) {
          console.log(`Price change of ${(priceChangePercent * 100).toFixed(2)}% exceeds ${updateThreshold * 100}% threshold:`);
          console.log(`- Current price: ${existingBids[0].price} sats`);
          console.log(`- New price: ${bidPriceSats} sats`);
          console.log(`- Affected bids: ${existingBids.length}`);
          bidsToCancel.push(...existingBids.map(bid => bid.bid_id));
        }
      }

      if (bidsToCancel.length > 0) {
        try {
          await this.biddingService.cancelBids(bidsToCancel);
          
          // Create new bid at updated price, respecting collection bid limit
          const remainingBids = existingBids.filter(bid => !bidsToCancel.includes(bid.bid_id));
          const remainingBidsTotal = remainingBids[0]?.price * remainingBids.length || 0;
          const availableForBidding = collectionLimit - remainingBidsTotal;
          const maxQuantityByLimit = Math.floor(availableForBidding / bidPriceSats);
          const finalBidQuantity = Math.min(biddingCapacity, maxQuantityByLimit);

          if (finalBidQuantity > 0) {
            console.log(`Creating new bid at ${bidPriceSats} sats for ${finalBidQuantity} items...`);
            await this.biddingService.createBid(collectionId, bidPriceSats, finalBidQuantity);
          } else {
            console.log('Cannot create new bid: would exceed collection bid limit');
          }
        } catch (error) {
          console.error('Failed to update bids:', error.message);
        }
      } else {
        // Check if we can create additional bids within the new collection limit
        const currentBidsTotal = existingBids[0]?.price * existingBids.length || 0;
        const availableForBidding = collectionLimit - currentBidsTotal;
        
        // Calculate potential new bid quantity using full collection limit
        const maxNewQuantityByLimit = Math.floor(collectionLimit / bidPriceSats);
        const potentialNewQuantity = Math.min(biddingCapacity, maxNewQuantityByLimit);
        
        // Only proceed if we can create more bids than we currently have
        if (potentialNewQuantity > existingBids.length) {
          console.log(`\nCollection limit allows for ${potentialNewQuantity} bids (currently have ${existingBids.length})`);
          try {
            // Cancel all existing bids first
            await this.biddingService.cancelBids(existingBids.map(bid => bid.bid_id));
            
            console.log(`Creating new bid at ${bidPriceSats} sats for ${potentialNewQuantity} items...`);
            await this.biddingService.createBid(collectionId, bidPriceSats, potentialNewQuantity);
          } catch (error) {
            console.error('Failed to update bids:', error.message);
          }
        }
      }
    }

    // If no existing bids and we have bidding capacity, create a new bid
    if (existingBids.length === 0 && biddingCapacity > 0) {
      try {
        const collectionLimit = this.getCollectionBidLimit(collectionId);
        const maxQuantityByLimit = Math.floor(collectionLimit / bidPriceSats);
        const finalBidQuantity = Math.min(biddingCapacity, maxQuantityByLimit);

        if (finalBidQuantity > 0) {
          console.log(`\nCreating new bid at ${bidPriceSats} sats for ${finalBidQuantity} items...`);
          await this.biddingService.createBid(collectionId, bidPriceSats, finalBidQuantity);
        } else {
          console.log('\nCannot create new bid: would exceed collection bid limit');
        }
      } catch (error) {
        console.error('Failed to create bid:', error.message);
      }
    }

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
          finalListingPrice = Math.floor(averagePrice * premiumMultiplier);
          console.log(`ℹ Premium price for ${inscriptionId}: ${finalListingPrice} sats (${premiumMultiplier}x average)`);
        }

        // Check if the item is already listed and within threshold
        const existingListing = item.listing;
        let shouldList = true;

        if (existingListing) {
          const priceDiff = Math.abs(existingListing.price - finalListingPrice);
          const priceChangePercent = priceDiff / existingListing.price;
          
          if (priceChangePercent <= updateThreshold) {
            console.log(`ℹ Skipping ${inscriptionId}: Current price ${existingListing.price} sats is within ${updateThreshold * 100}% threshold`);
            shouldList = false;
          } else {
            console.log(`ℹ Updating ${inscriptionId}: Price change ${(priceChangePercent * 100).toFixed(2)}% exceeds ${updateThreshold * 100}% threshold`);
            console.log(`  Current: ${existingListing.price} sats → New: ${finalListingPrice} sats`);
          }
        }

        if (shouldList) {
          await listOnSatflow(item, finalListingPrice);
          console.log(`✓ Listed ${inscriptionId} at ${finalListingPrice} sats`);
        }
      } catch (error) {
        console.error(`✗ Failed ${item.token.inscription_id}: ${error.message}`);
      }
    }
  }
}

module.exports = {
  OrdinalsCollectionManager
};
