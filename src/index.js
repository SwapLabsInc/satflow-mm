require('dotenv').config();
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
bitcoin.initEccLib(ecc);

const { fetchWalletContents } = require('./services/wallet');
const { OrdinalsCollectionManager } = require('./services/protocols/ordinals/collection-manager');
const { RunesCollectionManager } = require('./services/protocols/runes/collection-manager');

async function mainLoop() {
  try {
    console.log('\n=== Starting New Cycle ===');
    
    // Initialize collection managers for each protocol
    const ordinalsManager = new OrdinalsCollectionManager();
    const runesManager = new RunesCollectionManager();
    
    // Get bidding wallet info once for all collections
    let biddingAddress = '';
    let biddingBalance = 0;
    try {
      biddingAddress = await ordinalsManager.biddingService.getBiddingWalletAddress();
      biddingBalance = await ordinalsManager.biddingService.getBiddingWalletBalance(biddingAddress);
      console.log(`Bidding wallet balance: ${biddingBalance} sats`);
    } catch (error) {
      console.error(`Bidding wallet error: ${error.message}`);
      return;
    }
    
    // Fetch wallet contents once for all collections
    const walletItems = await fetchWalletContents();
    if (!walletItems || !Array.isArray(walletItems)) {
      throw new Error('Invalid wallet items response');
    }

    // Get all configured collections
    const collections = process.env.COLLECTIONS.split(',')
      .map(c => c.trim())
      .filter(c => c.length > 0);
    
    for (const collection of collections) {
      try {
        if (collection.toLowerCase().startsWith('rune:')) {
          // Process rune collection
          const runeTicker = collection.substring(5); // Remove 'rune:' prefix
          await runesManager.processCollection(runeTicker, walletItems);
        } else {
          // Process ordinals collection
          await ordinalsManager.processCollection(collection, walletItems, biddingAddress, biddingBalance);
        }
      } catch (error) {
        console.error(`Error processing ${collection}:`, error.message);
        // Continue with next collection
      }
    }

    console.log(`\n=== Cycle Complete (Next run in ${process.env.LOOP_SECONDS}s) ===\n`);
  } catch (error) {
    console.error('Main loop error:', error.message);
  }
}

// Run the loop on an interval
const intervalSeconds = Number(process.env.LOOP_SECONDS) || 15;
setInterval(mainLoop, intervalSeconds * 1000);

// Run immediately on startup
mainLoop();
