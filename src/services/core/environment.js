const { decrypt } = require('./encryption');
const { logError } = require('../../utils/logger');

// API Base URL - change this single line to test against different endpoints
const SATFLOW_API_BASE_URL = 'https://api.satflow.com/v1';

// Magic Eden maker fee multiplier (0.5% fee)
const MAGIC_EDEN_FEE_MULTIPLIER = 1.005;

// Global flag to track if below-floor confirmation has been given
let belowFloorConfirmationGiven = false;

// Helper function to parse and validate bid ladder configuration
function parseBidLadder(ladderString) {
  if (!ladderString) return null;
  
  try {
    const steps = ladderString.split(',').map(step => {
      const [pricePercent, allocation] = step.split(':').map(Number);
      if (isNaN(pricePercent) || isNaN(allocation)) {
        throw new Error('Invalid format - each step must be pricePercent:allocation');
      }
      if (pricePercent <= 0 || pricePercent >= 1) {
        throw new Error('Price percent must be between 0 and 1');
      }
      if (allocation <= 0 || allocation > 1) {
        throw new Error('Allocation must be between 0 and 1');
      }
      return { pricePercent, allocation };
    });
    
    // Validate total allocation doesn't exceed 100%
    const totalAllocation = steps.reduce((sum, step) => sum + step.allocation, 0);
    if (totalAllocation > 1.001) { // Allow for small floating point errors
      throw new Error(`Total allocation (${(totalAllocation * 100).toFixed(1)}%) exceeds 100%`);
    }
    
    return steps;
  } catch (error) {
    return { error: error.message };
  }
}

// Helper function to parse and validate premium inscription ranges
function parsePremiumRanges(rangesString) {
  if (!rangesString) return null;

  try {
    const ranges = rangesString.split(',').map(range => {
      const [threshold, multiplier] = range.split(':').map(Number);
      if (isNaN(threshold) || isNaN(multiplier)) {
        throw new Error('Invalid format - each range must be threshold:multiplier');
      }
      if (threshold <= 0 || multiplier <= 0) {
        throw new Error('Threshold and multiplier must be positive numbers');
      }
      return { threshold, multiplier };
    });

    // Sort ranges by threshold in ascending order
    return ranges.sort((a, b) => a.threshold - b.threshold);
  } catch (error) {
    return { error: error.message };
  }
}

function validateWalletEnvironment(password) {
  // Check for either encrypted or plaintext seed
  if (!process.env.LOCAL_WALLET_SEED && !process.env.LOCAL_WALLET_SEED_ENCRYPTED) {
    logError('Either LOCAL_WALLET_SEED or LOCAL_WALLET_SEED_ENCRYPTED must be set');
    process.exit(1);
  }

  // If both are provided, warn user
  if (process.env.LOCAL_WALLET_SEED && process.env.LOCAL_WALLET_SEED_ENCRYPTED) {
    console.warn('Both LOCAL_WALLET_SEED and LOCAL_WALLET_SEED_ENCRYPTED are set. Using encrypted seed.');
  }

  // If using encrypted seed, decrypt with provided password
  if (process.env.LOCAL_WALLET_SEED_ENCRYPTED) {
    if (!password) {
      logError('Password is required to decrypt the wallet seed');
      process.exit(1);
    }

    try {
      const decrypted = decrypt(process.env.LOCAL_WALLET_SEED_ENCRYPTED, password);
      process.env.LOCAL_WALLET_SEED = decrypted;
    } catch (error) {
      logError('Failed to decrypt seed phrase. Invalid password.');
      process.exit(1);
    }
  }
}

// Function to check for collections with LIST_ABOVE_PERCENT below 1.0
// and ask for confirmation if needed
async function checkBelowFloorListings() {
  // If confirmation has already been given, skip
  if (belowFloorConfirmationGiven) {
    return;
  }

  // Get all collections and separate them by type
  const collections = process.env.COLLECTIONS.split(',').map(c => c.trim()).filter(c => c.length > 0);
  const ordinalCollections = collections.filter(c => !c.toLowerCase().startsWith('rune:'));
  const runeCollections = collections
    .filter(c => c.toLowerCase().startsWith('rune:'))
    .map(c => c.substring(5).toUpperCase()); // Remove 'rune:' prefix

  // Track collections with LIST_ABOVE_PERCENT below 1.0
  const belowFloorCollections = [];

  // Check ordinal collections
  ordinalCollections.forEach(collection => {
    const collectionUpper = collection.toUpperCase();
    const listAboveKey = `${collectionUpper}_LIST_ABOVE_PERCENT`;
    
    const listAbovePercent = Number(process.env[listAboveKey]);
    if (process.env[listAboveKey] && !isNaN(listAbovePercent) && listAbovePercent < 1) {
      belowFloorCollections.push({
        collection,
        key: listAboveKey,
        value: listAbovePercent
      });
    }
  });

  // Check rune collections
  runeCollections.forEach(ticker => {
    const listAboveKey = `${ticker}_LIST_ABOVE_PERCENT`;
    
    const listAbovePercent = Number(process.env[listAboveKey]);
    if (process.env[listAboveKey] && !isNaN(listAbovePercent) && listAbovePercent < 1) {
      belowFloorCollections.push({
        collection: `rune:${ticker}`,
        key: listAboveKey,
        value: listAbovePercent
      });
    }
  });

  // If any collections have LIST_ABOVE_PERCENT below 1.0, ask for confirmation
  if (belowFloorCollections.length > 0) {
    const prompts = require('prompts');
    
    console.warn('\n⚠️  WARNING: The following collections are configured to list below floor price:');
    belowFloorCollections.forEach(item => {
      console.warn(`  - ${item.collection}: ${(item.value * 100).toFixed(2)}% of floor price (${item.key}=${item.value})`);
    });
    
    const { confirm } = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: 'Do you acknowledge that you are listing below floor prices and wish to continue anyway?',
      initial: false
    });
    
    if (!confirm) {
      logError('Operation cancelled by user');
      process.exit(1);
    }
    
    console.log('Continuing with below-floor listings as requested...');
    belowFloorConfirmationGiven = true;
  }
}

function validateBaseEnvironment() {
  const baseRequired = [
    'COLLECTIONS',
    'UPDATE_THRESHOLD',
    'MAX_BID_TO_LIST_RATIO'
  ];
  
  const missing = baseRequired.filter(key => !process.env[key]);
  if (missing.length > 0) {
    logError('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }

  // Get all collections and separate them by type
  const collections = process.env.COLLECTIONS.split(',').map(c => c.trim()).filter(c => c.length > 0);
  const ordinalCollections = collections.filter(c => !c.toLowerCase().startsWith('rune:'));
  const runeCollections = collections
    .filter(c => c.toLowerCase().startsWith('rune:'))
    .map(c => c.substring(5).toUpperCase()); // Remove 'rune:' prefix

  // Validate collection-specific bid/list percentages for Ordinals
  ordinalCollections.forEach(collection => {
    const collectionUpper = collection.toUpperCase();
    const bidBelowKey = `${collectionUpper}_BID_BELOW_PERCENT`;
    const listAboveKey = `${collectionUpper}_LIST_ABOVE_PERCENT`;
    const bidLadderKey = `${collectionUpper}_BID_LADDER`;
    const priceFloorKey = `${collectionUpper}_PRICE_FLOOR_BTC`;
    const updateThresholdKey = `${collectionUpper}_UPDATE_THRESHOLD`;
    
    // Validate bid below percent if present
    const bidBelowPercent = Number(process.env[bidBelowKey]);
    if (process.env[bidBelowKey] && (isNaN(bidBelowPercent) || bidBelowPercent >= 1)) {
      logError(`${bidBelowKey} must be a number less than 1`);
      process.exit(1);
    }

    // Check list above percent if present
    const listAbovePercent = Number(process.env[listAboveKey]);
    if (process.env[listAboveKey] && isNaN(listAbovePercent)) {
      logError(`${listAboveKey} must be a number`);
      process.exit(1);
    }
    
    // Validate price floor if present
    const priceFloorBTC = Number(process.env[priceFloorKey]);
    if (process.env[priceFloorKey] && (isNaN(priceFloorBTC) || priceFloorBTC <= 0)) {
      logError(`${priceFloorKey} must be a positive number`);
      process.exit(1);
    }

    // Validate update threshold if present
    const updateThreshold = Number(process.env[updateThresholdKey]);
    if (process.env[updateThresholdKey] && (isNaN(updateThreshold) || updateThreshold < 0 || updateThreshold > 1)) {
      logError(`${updateThresholdKey} must be a number between 0 and 1`);
      process.exit(1);
    }
    
    // Validate bid ladder if present
    if (process.env[bidLadderKey]) {
      const ladderResult = parseBidLadder(process.env[bidLadderKey]);
      if (ladderResult && ladderResult.error) {
        logError(`${bidLadderKey}: ${ladderResult.error}`);
        process.exit(1);
      }
    }
  });

  // Validate rune-specific bid/list percentages
  runeCollections.forEach(ticker => {
    const bidBelowKey = `${ticker}_BID_BELOW_PERCENT`;
    const listAboveKey = `${ticker}_LIST_ABOVE_PERCENT`;
    const bidLadderKey = `${ticker}_BID_LADDER`;
    
    const bidBelowPercent = Number(process.env[bidBelowKey]);
    if (process.env[bidBelowKey] && (isNaN(bidBelowPercent) || bidBelowPercent >= 1)) {
      logError(`${bidBelowKey} must be a number less than 1`);
      process.exit(1);
    }

    const listAbovePercent = Number(process.env[listAboveKey]);
    if (process.env[listAboveKey] && isNaN(listAbovePercent)) {
      logError(`${listAboveKey} must be a number`);
      process.exit(1);
    }
    
    // Validate bid ladder if present
    if (process.env[bidLadderKey]) {
      const ladderResult = parseBidLadder(process.env[bidLadderKey]);
      if (ladderResult && ladderResult.error) {
        logError(`${bidLadderKey}: ${ladderResult.error}`);
        process.exit(1);
      }
    }
  });

  // Validate UPDATE_THRESHOLD is a valid number between 0 and 1
  const updateThreshold = Number(process.env.UPDATE_THRESHOLD);
  if (isNaN(updateThreshold) || updateThreshold < 0 || updateThreshold > 1) {
    logError('UPDATE_THRESHOLD must be a number between 0 and 1');
    process.exit(1);
  }

  // Validate MAX_BID_TO_LIST_RATIO is a valid number between 0 and 1
  const maxBidToListRatio = Number(process.env.MAX_BID_TO_LIST_RATIO || process.env.MIN_BID_TO_LIST_RATIO);
  if (isNaN(maxBidToListRatio) || maxBidToListRatio <= 0 || maxBidToListRatio >= 1) {
    logError('MAX_BID_TO_LIST_RATIO must be a number between 0 and 1');
    process.exit(1);
  }
}

module.exports = {
  SATFLOW_API_BASE_URL,
  MAGIC_EDEN_FEE_MULTIPLIER,
  validateBaseEnvironment,
  validateWalletEnvironment,
  parseBidLadder,
  parsePremiumRanges,
  checkBelowFloorListings
};
