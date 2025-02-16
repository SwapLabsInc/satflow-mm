require('dotenv').config();
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
bitcoin.initEccLib(ecc);

const { fetchWalletContents } = require('./services/wallet');
const { processCollection, validateEnvironment, getConfiguredCollections } = require('./services/collections');

async function mainLoop() {
  try {
    console.log('\n=== Starting New Cycle ===');
    
    // Fetch wallet contents once for all collections
    const walletItems = await fetchWalletContents();
    if (!walletItems || !Array.isArray(walletItems)) {
      throw new Error('Invalid wallet items response');
    }

    const collections = getConfiguredCollections();
    for (const collectionId of collections) {
      try {
        await processCollection(collectionId, walletItems);
      } catch (error) {
        console.error(`Error processing collection ${collectionId}:`, error.message);
        // Continue with next collection
      }
    }

    console.log(`\n=== Cycle Complete (Next run in ${process.env.LOOP_SECONDS}s) ===\n`);
  } catch (error) {
    console.error('Main loop error:', error.message);
  }
}

// Validate environment before starting
validateEnvironment();

// Run the loop on an interval
const intervalSeconds = Number(process.env.LOOP_SECONDS) || 15;
setInterval(mainLoop, intervalSeconds * 1000);

// Run immediately on startup
mainLoop();
