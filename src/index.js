require('dotenv').config();
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
bitcoin.initEccLib(ecc);

const { fetchWalletContents } = require('./services/wallet');
const { deriveWalletDetails } = require('./services/wallet-utils');
const { getSatflowChallenge, verifySatflowChallenge, signChallenge } = require('./services/bip322');
const { OrdinalsCollectionManager } = require('./services/protocols/ordinals/collection-manager');
const { RunesCollectionManager } = require('./services/protocols/runes/collection-manager');
const { validateBaseEnvironment, validateWalletEnvironment, checkBelowFloorListings } = require('./services/core/environment');
const { FeeService } = require('./services/fee-service');

async function mainLoop() {
  try {
    console.log('\n=== Starting New Cycle ===');
    
    // Fetch recommended fees once per cycle
    const feeRate = await FeeService.getFastestFee();
    console.log(`Using fee rate: ${feeRate} sat/vB`);
    
    // Initialize collection managers for each protocol
    const ordinalsManager = new OrdinalsCollectionManager();
    const runesManager = new RunesCollectionManager();
    
    // Get bidding wallet info and signature once for all collections
    let biddingAddress = '';
    let biddingBalance = 0;
    try {
      // Get wallet details and challenge signature
      const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
      const challenge = await getSatflowChallenge(walletDetails.address);
      const signature = signChallenge(challenge, process.env.LOCAL_WALLET_SEED);
      
      // Verify locally with the same challenge
      const verificationResult = await verifySatflowChallenge(walletDetails.address, signature, challenge);
      if (!verificationResult.verified) {
        throw new Error('Local signature verification failed');
      }

      // Store signature and fee rate in bidding services for this cycle
      ordinalsManager.biddingService.setSignature(signature);
      runesManager.biddingService.setSignature(signature);
      ordinalsManager.biddingService.setFeeRate(feeRate);
      runesManager.biddingService.setFeeRate(feeRate);

      // Get bidding wallet info (can use either service since they share the same wallet)
      biddingAddress = await runesManager.biddingService.getBiddingWalletAddress();
      biddingBalance = await runesManager.biddingService.getBiddingWalletBalance(biddingAddress);
      console.log(`Satflow Bidding wallet balance: ${biddingBalance} sats`);
    } catch (error) {
      console.error(`Satflow Bidding wallet error: ${error.message}`);
      return;
    }
    
    // Fetch wallet contents once for all collections
    const { ordinals, runes } = await fetchWalletContents();
    if (!ordinals || !Array.isArray(ordinals)) {
      throw new Error('Invalid ordinals response from Satflow');
    }
    if (!runes || !Array.isArray(runes)) {
      throw new Error('Invalid runes response from Satflow');
    }

    // Get all configured collections
    const collections = process.env.COLLECTIONS.split(',')
      .map(c => c.trim())
      .filter(c => c.length > 0);
    
    // Process collections based on type
    for (const collection of collections) {
      try {
        if (collection.toLowerCase().startsWith('rune:')) {
          // Process rune collection
          const runeTicker = collection.substring(5); // Remove 'rune:' prefix
          await runesManager.processCollection(runeTicker, runes);
        } else {
          // Process ordinals collection
          await ordinalsManager.processCollection(collection, ordinals, biddingAddress, biddingBalance);
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

// Get password if using encrypted seed
async function getWalletPassword() {
  if (process.env.LOCAL_WALLET_SEED_ENCRYPTED) {
    const prompts = require('prompts');
    const { password } = await prompts({
      type: 'password',
      name: 'password',
      message: 'Enter your wallet seed decryption password:',
    });

    if (!password) {
      console.error('Password is required to decrypt the wallet seed');
      process.exit(1);
    }
    return password;
  }
  return null;
}

// Initialize and start the application
async function init() {
  try {
    // Validate base environment first
    validateBaseEnvironment();
    
    // Check for below-floor listings and ask for confirmation if needed
    await checkBelowFloorListings();
    
    // Get password if needed (only once at startup)
    const password = await getWalletPassword();
    
    // Validate wallet environment with password
    validateWalletEnvironment(password);
    
    // Run the loop on an interval
    const intervalSeconds = Number(process.env.LOOP_SECONDS) || 15;
    setInterval(() => mainLoop(), intervalSeconds * 1000);
    
    // Run immediately on startup
    mainLoop();
  } catch (error) {
    console.error('Initialization error:', error.message);
    process.exit(1);
  }
}

// Start the application
init();
