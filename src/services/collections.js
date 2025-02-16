const { fetchMarketPrice, calculateAveragePrice } = require('./marketPrice');
const { listOnSatflow } = require('./listings');
const { 
  getBiddingWalletAddress, 
  getBiddingWalletBalance,
  calculateBiddingCapacity,
  getExistingBids,
  getCollectionBids,
  cancelBids
} = require('./bidding');

function getConfiguredCollections() {
  const collections = process.env.COLLECTIONS;
  if (!collections) {
    console.error('COLLECTIONS environment variable is not set');
    process.exit(1);
  }
  
  return collections.split(',').map(c => c.trim()).filter(c => c.length > 0);
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
      console.log('\nExisting Collection Bids:');
      existingBids.forEach(bid => {
        const expirationDate = new Date(bid.expiration).toLocaleString();
        console.log(`- ${bid.bid_id}: ${bid.price} sats (expires: ${expirationDate})`);
      });
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
  const bidPriceSats = Math.floor(averagePrice * bidBelowPercent);
  const biddingCapacity = calculateBiddingCapacity(biddingBalance, bidPriceSats);
  
  console.log('\nMarket Analysis:');
  console.log(`- Average price (${numCheapestItems} cheapest): ${averagePrice} sats`);
  console.log(`- Listing price (${listAbovePercent}x): ${listingPriceSats} sats`);
  console.log(`- Bid price (${bidBelowPercent}x): ${bidPriceSats} sats`);
  console.log(`- Can bid on: ${biddingCapacity} items at ${bidPriceSats} sats each`);

  // Check if existing bids need to be repriced
  if (existingBids.length > 0) {
    console.log('\nChecking bids for repricing:');
    const bidsToCancel = [];
    
    for (const bid of existingBids) {
      const priceDiff = Math.abs(bid.price - bidPriceSats);
      const priceChangePercent = (priceDiff / bid.price) * 100;
      
      if (priceChangePercent > 5) { // If price changed by more than 5%
        console.log(`Bid ${bid.bid_id} needs repricing:`);
        console.log(`- Current price: ${bid.price} sats`);
        console.log(`- New price: ${bidPriceSats} sats`);
        console.log(`- Price change: ${priceChangePercent.toFixed(2)}%`);
        bidsToCancel.push(bid.bid_id);
      }
    }

    if (bidsToCancel.length > 0) {
      try {
        console.log(`\nCancelling ${bidsToCancel.length} bids for repricing...`);
        await cancelBids(bidsToCancel);
        console.log('Successfully cancelled bids');
        // TODO: Place new bids at updated price once bid creation is implemented
      } catch (error) {
        console.error('Failed to cancel bids:', error.message);
      }
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
      await listOnSatflow(item, listingPriceSats);
      console.log(`✓ Listed ${item.token.inscription_id} at ${listingPriceSats} sats`);
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
    'COLLECTIONS'
  ];
  
  const missing = baseRequired.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  console.log('\n=== Configuration ===');
  console.log(`Processing collections: ${collections.join(', ')}`);
}

module.exports = {
  getConfiguredCollections,
  processCollection,
  validateEnvironment
};
