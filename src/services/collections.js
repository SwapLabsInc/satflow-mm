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
      console.log(`\nExisting Collection Bids: ${existingBids.length} bids at ${existingBids[0].price} sats`);
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
  // Round bid price to nearest 1000 sats
  const bidPriceSats = Math.round(averagePrice * bidBelowPercent / 1000) * 1000;
  const biddingCapacity = calculateBiddingCapacity(biddingBalance, bidPriceSats);
  
  console.log('\nMarket Analysis:');
  console.log(`- Average price (${numCheapestItems} cheapest): ${averagePrice} sats`);
  console.log(`- Listing price (${listAbovePercent}x): ${listingPriceSats} sats`);
  console.log(`- Bid price (${bidBelowPercent}x): ${bidPriceSats} sats`);
  console.log(`- Can bid on: ${biddingCapacity} items at ${bidPriceSats} sats each`);

  // Get update threshold from environment
  const updateThreshold = Number(process.env.UPDATE_THRESHOLD) || 0.01; // Default to 1%

  // Check if existing bids need to be repriced
  if (existingBids.length > 0) {
    console.log('\nChecking bids for repricing:');
    const bidsToCancel = [];
    
    for (const bid of existingBids) {
      const priceDiff = Math.abs(bid.price - bidPriceSats);
      const priceChangePercent = (priceDiff / bid.price);
      
      if (priceChangePercent > updateThreshold) {
        console.log(`Bid ${bid.bid_id} needs repricing:`);
        console.log(`- Current price: ${bid.price} sats`);
        console.log(`- New price: ${bidPriceSats} sats`);
        console.log(`- Price change: ${(priceChangePercent * 100).toFixed(2)}%`);
        bidsToCancel.push(bid.bid_id);
      }
    }

    if (bidsToCancel.length > 0) {
      try {
        console.log(`\nCancelling ${bidsToCancel.length} bids for repricing...`);
        await cancelBids(bidsToCancel);
        console.log('Successfully cancelled bids');
        
        // Create new bid at updated price
        console.log(`Creating new bid at ${bidPriceSats} sats for ${biddingCapacity} items...`);
        await createBid(collectionId, bidPriceSats, biddingCapacity);
        console.log('Successfully created new bid');
      } catch (error) {
        console.error('Failed to update bids:', error.message);
      }
    }
  }

  // If no existing bids and we have bidding capacity, create a new bid
  if (existingBids.length === 0 && biddingCapacity > 0) {
    try {
      console.log(`\nCreating new bid at ${bidPriceSats} sats for ${biddingCapacity} items...`);
      await createBid(collectionId, bidPriceSats, biddingCapacity);
      console.log('Successfully created new bid');
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
    'UPDATE_THRESHOLD'
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

  console.log('\n=== Configuration ===');
  console.log(`Processing collections: ${collections.join(', ')}`);
  console.log(`Update threshold: ${updateThreshold * 100}%`);
}

module.exports = {
  getConfiguredCollections,
  processCollection,
  validateEnvironment
};
