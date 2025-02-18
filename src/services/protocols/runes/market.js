const axios = require('axios');

/**
 * Fetches valid sell orders for a rune from Magic Eden
 * @param {string} runeTicker - The rune's ticker symbol
 * @returns {Promise<Array>} Array of valid sell orders
 */
async function fetchRuneOrders(runeTicker) {
  try {
    // Get orders sorted by price ascending for optimal market depth calculation
    const url = `https://api-mainnet.magiceden.us/v2/ord/btc/runes/orders/${runeTicker}` +
      '?offset=0&sort=unitPriceAsc&includePending=false&side=sell';

    const { data } = await axios.get(url);
    
    // Filter for valid sell orders with proper numeric values
    return (data?.orders || []).filter(order => {
      if (!order || order.side !== 'sell' || order.status !== 'valid' || order.isPending) {
        return false;
      }

      try {
        const amount = parseFloat(order.formattedAmount);
        const unitPrice = parseFloat(order.formattedUnitPrice);
        return !isNaN(amount) && !isNaN(unitPrice) && amount > 0 && unitPrice > 0;
      } catch {
        return false;
      }
    });
  } catch (error) {
    console.error(`Rune market price fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * Calculates volume-weighted average price for a given market depth
 * @param {Array} orders - Array of valid sell orders
 * @param {number} depthSats - Market depth in satoshis to consider
 * @returns {number} Volume-weighted average price in sats/token
 */
function calculateAveragePriceByDepth(orders, depthSats) {
  if (!orders || orders.length === 0) return 0;

  // Ensure orders are sorted by price ascending
  const sortedOrders = [...orders].sort((a, b) => {
    const priceA = parseFloat(a.formattedUnitPrice);
    const priceB = parseFloat(b.formattedUnitPrice);
    if (isNaN(priceA)) return 1;
    if (isNaN(priceB)) return -1;
    return priceA - priceB;
  });

  let totalTokens = 0;
  let weightedPriceSum = 0;
  let depthRemaining = depthSats;

  // Calculate weighted average price up to the specified depth
  for (const order of sortedOrders) {
    if (depthRemaining <= 0) break;

    const tokens = parseFloat(order.formattedAmount);
    const unitPrice = parseFloat(order.formattedUnitPrice);
    const orderValue = tokens * unitPrice;

    // Determine how much of the order to include
    let tokensToConsider;
    let satsToSpend;

    if (orderValue <= depthRemaining) {
      // Include entire order
      tokensToConsider = tokens;
      satsToSpend = orderValue;
    } else {
      // Partially fill order to reach depth
      tokensToConsider = depthRemaining / unitPrice;
      satsToSpend = depthRemaining;
    }

    totalTokens += tokensToConsider;
    weightedPriceSum += unitPrice * tokensToConsider;
    depthRemaining -= satsToSpend;
  }

  return totalTokens > 0 ? weightedPriceSum / totalTokens : 0;
}

module.exports = {
  fetchRuneOrders,
  calculateAveragePriceByDepth
};
