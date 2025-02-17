function validateBaseEnvironment() {
  const baseRequired = [
    'COLLECTIONS',
    'UPDATE_THRESHOLD',
    'MAX_BID_TO_LIST_RATIO'
  ];
  
  const missing = baseRequired.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
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
    const bidBelowKey = `${collection.toUpperCase()}_BID_BELOW_PERCENT`;
    const listAboveKey = `${collection.toUpperCase()}_LIST_ABOVE_PERCENT`;
    
    const bidBelowPercent = Number(process.env[bidBelowKey]);
    if (process.env[bidBelowKey] && (isNaN(bidBelowPercent) || bidBelowPercent >= 1)) {
      console.error(`${bidBelowKey} must be a number less than 1`);
      process.exit(1);
    }

    const listAbovePercent = Number(process.env[listAboveKey]);
    if (process.env[listAboveKey] && (isNaN(listAbovePercent) || listAbovePercent < 1)) {
      console.error(`${listAboveKey} must be a number greater than or equal to 1`);
      process.exit(1);
    }
  });

  // Validate rune-specific bid/list percentages
  runeCollections.forEach(ticker => {
    const bidBelowKey = `${ticker}_BID_BELOW_PERCENT`;
    const listAboveKey = `${ticker}_LIST_ABOVE_PERCENT`;
    
    const bidBelowPercent = Number(process.env[bidBelowKey]);
    if (process.env[bidBelowKey] && (isNaN(bidBelowPercent) || bidBelowPercent >= 1)) {
      console.error(`${bidBelowKey} must be a number less than 1`);
      process.exit(1);
    }

    const listAbovePercent = Number(process.env[listAboveKey]);
    if (process.env[listAboveKey] && (isNaN(listAbovePercent) || listAbovePercent < 1)) {
      console.error(`${listAboveKey} must be a number greater than or equal to 1`);
      process.exit(1);
    }
  });

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
}

module.exports = {
  validateBaseEnvironment
};
