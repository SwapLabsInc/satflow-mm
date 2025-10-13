function calculateTargetPrice(listings, collectionSymbol) {
  const numCheapest = Number(process.env[`${collectionSymbol.toUpperCase()}_NUM_CHEAPEST_ITEMS`]) || 10;
  const slice = listings.slice(0, numCheapest);
  if (slice.length === 0) return 0;

  const total = slice.reduce((sum, item) => sum + item.price, 0);
  return total / slice.length;
}

function calculateDynamicPrice(targetPrice, marketListings) {
    if (!marketListings || marketListings.length === 0) {
        return targetPrice;
    }

    const floorPrice = marketListings[0].price;

    // Opportunistic Undercutting: If target is within 1% of floor, undercut by 1000 sats
    if (targetPrice >= floorPrice && targetPrice <= floorPrice * 1.01) {
        return floorPrice - 1000;
    }

    // Just Below Floor: If target is already below floor, standardize to 1000 sats below
    if (targetPrice < floorPrice) {
        return floorPrice - 1000;
    }

    // Default: Return original target price
    return targetPrice;
}

function calculateDynamicBidPrice(targetBidPrice, marketBids) {
    if (!marketBids || marketBids.length === 0) {
        return targetBidPrice;
    }

    const highestBid = marketBids[0].price;

    // Opportunistic Overbidding: If target is within 1% of highest bid, overbid by 1000 sats
    if (targetBidPrice <= highestBid && targetBidPrice >= highestBid * 0.99) {
        return highestBid + 1000;
    }

    // Just Above Highest: If target is already above highest bid, standardize to 1000 sats above
    if (targetBidPrice > highestBid) {
        return highestBid + 1000;
    }

    // Default: Return original target bid price
    return targetBidPrice;
}

module.exports = {
  calculateTargetPrice,
  calculateDynamicPrice,
  calculateDynamicBidPrice,
};
