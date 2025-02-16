const { fetchMarketPrice, calculateAveragePrice } = require('./marketPrice');
const { listOnSatflow } = require('./listings');

function getConfiguredCollections() {
  const collections = process.env.COLLECTIONS;
  if (!collections) {
    console.error('COLLECTIONS environment variable is not set');
    process.exit(1);
  }
  
  // Parse comma-separated list and trim whitespace
  return collections.split(',').map(c => c.trim()).filter(c => c.length > 0);
}

async function processCollection(collectionId, walletItems) {
  console.log(`\nProcessing collection: ${collectionId}`);
  
  // 1. Fetch market data
  const tokens = await fetchMarketPrice(collectionId);
  const averagePrice = calculateAveragePrice(tokens, collectionId);
  if (averagePrice <= 0) {
    console.log(`No tokens found or average price is invalid for ${collectionId}.`);
    return;
  }

  // Calculate listing price
  const listAbovePercent = Number(process.env[`${collectionId.toUpperCase()}_LIST_ABOVE_PERCENT`]) || 1.2;
  const listingPriceSats = Math.floor(averagePrice * listAbovePercent);
  const numCheapestItems = process.env[`${collectionId.toUpperCase()}_NUM_CHEAPEST_ITEMS`];
  
  console.log('\nPrice Calculation:');
  console.log(`Average price from ${numCheapestItems} cheapest items: ${averagePrice} sats`);
  console.log(`Listing multiplier: ${listAbovePercent}`);
  console.log(`Final listing price: ${listingPriceSats} sats`);

  // Process items for this collection
  for (const item of walletItems) {
    if (item.collection?.id === collectionId) {
      try {
        await listOnSatflow(item, listingPriceSats);
        console.log(`Successfully listed ${item.token.inscription_id} at ${listingPriceSats} sats`);
      } catch (error) {
        console.log(`Failed to list ${item.token.inscription_id}, but continuing with other items:`, error.message);
      }
    }
  }
}

// Validate required environment variables
function validateEnvironment() {
  // Validate COLLECTIONS is set
  const collections = getConfiguredCollections();
  
  const baseRequired = [
    'LOCAL_WALLET_SEED',
    'SATFLOW_API_KEY'
  ];

  const collectionVars = ['NUM_CHEAPEST_ITEMS', 'LIST_ABOVE_PERCENT', 'BID_BELOW_PERCENT'];
  const required = [
    ...baseRequired,
    ...collections.flatMap(collection => 
      collectionVars.map(varName => `${collection.toUpperCase()}_${varName}`)
    )
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  console.log('Configured to process collections:', collections.join(', '));
}

module.exports = {
  getConfiguredCollections,
  processCollection,
  validateEnvironment
};
