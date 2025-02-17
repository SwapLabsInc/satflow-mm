const { fetchMarketPrice, calculateAveragePrice } = require('./marketPrice');
const { listOnSatflow } = require('./listings');
const { 
  getBiddingWalletAddress, 
  getBiddingWalletBalance,
  calculateBiddingCapacity,
  getExistingBids,
  getCollectionBids,
  cancelBids,
  createBid
} = require('./bidding');

function getConfiguredCollections() {
  const collections = process.env.COLLECTIONS;
  if (!collections) {
    console.error('COLLECTIONS environment variable is not set');
    process.exit(1);
  }
  
  return collections.split(',').map(c => c.trim()).filter(c => c.length > 0);
}

function getPremiumMultiplier(inscriptionId) {
  const premiumKey = `PREMIUM_INSCRIPTION_${inscriptionId}`;
  const premiumMultiplier = Number(process.env[premiumKey]);
  return premiumMultiplier || null;
}

async function processCollection(collectionId, walletItems) {
  console.log(`\n=== Processing ${collectionId} ===`);
  
  // Get bidding wallet info
  let biddingBalance = 0;
  let biddingAddress = '';
  try {
    biddingAddress = await getBiddingWalletAddress();
    biddingBalance = await getBiddingWalletBalance(biddingAddress);
    console.log(`Bidding wallet balance: ${biddingBalance} sats`);
  } catch (error) {
    console.error(`Bidding wallet error: ${error.message}`);
    return;
  }

  // Get existing bids for this collection
  let existingBids = [];
  try {
    const allBids = await getExistingBids();
    existingBids = getCollectionBids(allBids, collectionId);
    if (existingBids.length > 0) {
      const totalBidAmount = existingBids[0].price * existingBids.length;
      const collectionLimit = Number(process.env[`${collectionId.toUpperCase()}_MAX_BID_TOTAL`]) || Infinity;
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
  const numCheapestItems = Number(process.env[`${collectionId.toUpperCase()}_NUM_CHEAPEST_ITEMS`]) || 10;
  
  // Calculate bidding price and capacity
  const bidBelowPercent = Number(process.env[`${collectionId.toUpperCase()}_BID_BELOW_PERCENT`]) || 0.8;
  // Support both old and new env var names for backward compatibility
  const maxBidToListRatio = Number(process.env.MAX_BID_TO_LIST_RATIO || process.env.MIN_BID_TO_LIST_RATIO);
  if (!maxBidToListRatio) {
    console.error('MAX_BID_TO_LIST_RATIO environment variable is required');
    process.exit(1);
  }
  
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
  
  const biddingCapacity = calculateBiddingCapacity(biddingBalance, bidPriceSats);
  
  console.log('\nMarket Analysis:');
  console.log(`- Average price (${numCheapestItems} cheapest): ${averagePrice} sats`);
  console.log(`- Listing price (${listAbovePercent}x): ${listingPriceSats} sats`);
  console.log(`- Bid price (${bidBelowPercent}x): ${bidPriceSats} sats`);
  console.log(`- Can bid on: ${biddingCapacity} items at ${bidPriceSats} sats each`);

  // Get update threshold from environment
  const updateThreshold = Number(process.env.UPDATE_THRESHOLD) || 0.01; // Default to 1%

  // Check if existing bids need to be repriced or exceed limit
  if (existingBids.length > 0) {
    console.log('\nChecking bids for repricing and limit compliance:');
    const bidsToCancel = [];
    const collectionLimit = Number(process.env[`${collectionId.toUpperCase()}_MAX_BID_TOTAL`]) || Infinity;
    
    // Calculate total of all bids
    const totalBidAmount = existingBids[0].price * existingBids.length;
    
    // If total exceeds limit, we need to cancel bids to get under limit
    if (totalBidAmount > collectionLimit) {
      console.log(`\nTotal bid amount ${totalBidAmount} exceeds collection limit ${collectionLimit}`);
      console.log(`Need to cancel bids to get under limit...`);
      
      // Cancel all bids - we'll create a new right-sized bid after
      bidsToCancel.push(...existingBids.map(bid => bid.bid_id));
    } else {
      // If under limit, check for repricing
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
        console.log(`\nCancelling ${bidsToCancel.length} bids for repricing...`);
        await cancelBids(bidsToCancel);
        console.log('Successfully cancelled bids');
        
        // Create new bid at updated price, respecting collection bid limit
        const remainingBids = existingBids.filter(bid => !bidsToCancel.includes(bid.bid_id));
        const remainingBidsTotal = remainingBids[0]?.price * remainingBids.length || 0;
        const collectionLimit = Number(process.env[`${collectionId.toUpperCase()}_MAX_BID_TOTAL`]) || Infinity;
        const availableForBidding = collectionLimit - remainingBidsTotal;
        const maxQuantityByLimit = Math.floor(availableForBidding / bidPriceSats);
        const finalBidQuantity = Math.min(biddingCapacity, maxQuantityByLimit);

        if (finalBidQuantity > 0) {
          console.log(`Creating new bid at ${bidPriceSats} sats for ${finalBidQuantity} items...`);
          await createBid(collectionId, bidPriceSats, finalBidQuantity);
          console.log('Successfully created new bid');
        } else {
          console.log('Cannot create new bid: would exceed collection bid limit');
        }
      } catch (error) {
        console.error('Failed to update bids:', error.message);
      }
    }
  }

  // If no existing bids and we have bidding capacity, create a new bid
  if (existingBids.length === 0 && biddingCapacity > 0) {
    try {
      const collectionLimit = Number(process.env[`${collectionId.toUpperCase()}_MAX_BID_TOTAL`]) || Infinity;
      const maxQuantityByLimit = Math.floor(collectionLimit / bidPriceSats);
      const finalBidQuantity = Math.min(biddingCapacity, maxQuantityByLimit);

      if (finalBidQuantity > 0) {
        console.log(`\nCreating new bid at ${bidPriceSats} sats for ${finalBidQuantity} items...`);
        await createBid(collectionId, bidPriceSats, finalBidQuantity);
        console.log('Successfully created new bid');
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
      const premiumMultiplier = getPremiumMultiplier(inscriptionId);
      let finalListingPrice = listingPriceSats;
      
      if (premiumMultiplier) {
        // Apply premium directly to the average price
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

function validateEnvironment() {
  const collections = getConfiguredCollections();
  const baseRequired = [
    'LOCAL_WALLET_SEED',
    'SATFLOW_API_KEY',
    'COLLECTIONS',
    'UPDATE_THRESHOLD',
    'MAX_BID_TO_LIST_RATIO'
  ];
  
  const missing = baseRequired.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  // Validate UPDATE_THRESHOLD is a valid number between 0 and 1
  const updateThreshold = Number(process.env.UPDATE_THRESHOLD);
  if (isNaN(updateThreshold) || updateThreshold < 0 || updateThreshold > 1) {
    console.error('UPDATE_THRESHOLD must be a number between 0 and 1');
    process.exit(1);
  }

  // Validate MAX_BID_TO_LIST_RATIO is a valid number between 0 and 1
  const maxBidToListRatio = Number(process.env.MAX_BID_TO_LIST_RATIO || process.env.MIN_BID_TO_LIST_RATIO);
  if (isNaN(maxBidToListRatio) || maxBidToListRatio <= 0 || maxBidToListRatio >= 1) {
    console.error('MAX_BID_TO_LIST_RATIO must be a number between 0 and 1');
    process.exit(1);
  }

  console.log('\n=== Configuration ===');
  console.log(`Processing collections: ${collections.join(', ')}`);
  console.log(`Update threshold: ${updateThreshold * 100}%`);
  console.log(`Max bid/list ratio: ${maxBidToListRatio * 100}%`);
}

module.exports = {
  getConfiguredCollections,
  processCollection,
  validateEnvironment
};
