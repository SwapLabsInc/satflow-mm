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

    const collections = getConfiguredCollections();
    for (const collectionId of collections) {
      await processCollection(collectionId, walletItems);
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
