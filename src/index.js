require('dotenv').config();
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
bitcoin.initEccLib(ecc);

const { fetchWalletContents } = require('./services/wallet');
const { processCollection, validateEnvironment, getConfiguredCollections } = require('./services/collections');

async function mainLoop() {
  try {
    // Fetch wallet contents once for all collections
    const walletItems = await fetchWalletContents();

    const collections = getConfiguredCollections();
    console.log('Processing collections:', collections.join(', '));

    // Process each configured collection
    for (const collectionId of collections) {
      await processCollection(collectionId, walletItems);
    }

    console.log(`\nCycle complete. Next run in ${process.env.LOOP_SECONDS} seconds.\n`);
  } catch (error) {
    console.error('Error in main loop:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      headers: error.response?.headers
    });
  }
}

// Validate environment before starting
validateEnvironment();

// Run the loop on an interval
const intervalSeconds = Number(process.env.LOOP_SECONDS) || 15;
setInterval(mainLoop, intervalSeconds * 1000);

// Run immediately on startup
mainLoop();
