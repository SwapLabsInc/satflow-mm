const { validateBaseEnvironment } = require('./environment');

class BaseCollectionManager {
  constructor() {
    this.validateEnvironment();
  }

  // Core methods that should be implemented by protocol-specific managers
  async processCollection(collectionId, walletItems) {
    throw new Error('processCollection must be implemented by protocol-specific manager');
  }

  async getMarketPrice(collectionId) {
    throw new Error('getMarketPrice must be implemented by protocol-specific manager');
  }

  async createBid(collectionId, price, quantity) {
    throw new Error('createBid must be implemented by protocol-specific manager');
  }

  async cancelBids(bidIds) {
    throw new Error('cancelBids must be implemented by protocol-specific manager');
  }

  async listItem(item, price) {
    throw new Error('listItem must be implemented by protocol-specific manager');
  }

  // Shared utility methods
  getConfiguredCollections() {
    const collections = process.env.COLLECTIONS;
    if (!collections) {
      console.error('COLLECTIONS environment variable is not set');
      process.exit(1);
    }
    
    return collections.split(',').map(c => c.trim()).filter(c => c.length > 0);
  }

  getPremiumMultiplier(itemId) {
    const premiumKey = `PREMIUM_INSCRIPTION_${itemId}`;
    const premiumMultiplier = Number(process.env[premiumKey]);
    return premiumMultiplier || null;
  }

  calculateBiddingCapacity(balance, bidPrice) {
    if (balance <= 0 || bidPrice <= 0) return 0;
    return Math.floor(balance / bidPrice);
  }

  getCollectionBidLimit(collectionId) {
    const envVar = `${collectionId.toUpperCase()}_MAX_BID_TOTAL`;
    const limit = process.env[envVar];
    return limit ? parseInt(limit) : Infinity;
  }

  validateEnvironment() {
    validateBaseEnvironment();
    this.validateProtocolEnvironment();
  }

  // Should be implemented by protocol-specific managers
  validateProtocolEnvironment() {
    throw new Error('validateProtocolEnvironment must be implemented by protocol-specific manager');
  }
}

module.exports = {
  BaseCollectionManager
};
