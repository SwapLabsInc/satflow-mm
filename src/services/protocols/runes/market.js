const axios = require('axios');
const { SATFLOW_API_BASE_URL, getSatflowConfig } = require('../../core/environment');
const { logError } = require('../../../utils/logger');

/**
 * Fetches valid sell orders for a rune from Satflow.
 * @param {string} runeTicker - The rune collection slug used by Satflow
 * @returns {Promise<Array>} Array of normalized sell orders
 */
function toBigInt(value) {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }

  return null;
}

function bigIntToDecimal(value, divisibility) {
  const divisor = BigInt(10) ** BigInt(divisibility);
  const whole = value / divisor;
  const fraction = value % divisor;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole.toString()}.${fraction.toString().padStart(divisibility, '0').replace(/0+$/, '')}`;
}

function getRuneDivisibility(listing) {
  const divisibility = Number(
    listing?.rune?.divisibility ??
    listing?.runes?.[0]?.divisibility ??
    listing?.ask?.runes?.[0]?.divisibility ??
    listing?.collection?.rune_divisibility ??
    listing?.token?.rune_divisibility ??
    0
  );

  return Number.isFinite(divisibility) && divisibility >= 0 ? divisibility : 0;
}

function normalizeRuneOrder(listing) {
  const totalPrice = Number(listing?.ask?.price ?? listing?.price);
  const explicitUnitPrice = Number(
    listing?.unitPrice ??
    listing?.ask?.unitPrice ??
    listing?.pricePerUnit ??
    listing?.ask?.pricePerUnit
  );
  const divisibility = getRuneDivisibility(listing);
  const rawAmount = toBigInt(
    listing?.rune?.amount ??
    listing?.runes?.[0]?.amount ??
    listing?.ask?.runes?.[0]?.amount ??
    listing?.token?.rune_amount ??
    listing?.token?.runeAmount
  );

  let amountString;
  if (rawAmount !== null) {
    amountString = bigIntToDecimal(rawAmount, divisibility);
  } else {
    const displayAmount = Number(
      listing?.token?.amount ??
      listing?.quantity
    );

    if (!Number.isFinite(displayAmount) || displayAmount <= 0) {
      return null;
    }

    amountString = displayAmount.toString();
  }

  const amount = Number(amountString);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unitPrice = Number.isFinite(explicitUnitPrice) && explicitUnitPrice > 0
    ? explicitUnitPrice
    : totalPrice / amount;

  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return null;
  }

  return {
    side: 'sell',
    status: 'valid',
    isPending: false,
    price: unitPrice,
    formattedAmount: amountString,
    formattedUnitPrice: unitPrice.toString()
  };
}

async function fetchRuneOrders(runeTicker) {
  try {
    const { data } = await axios.get(
      `${SATFLOW_API_BASE_URL}/activity/listings`,
      getSatflowConfig({
        collectionSlug: runeTicker,
        sortBy: 'price',
        sortDirection: 'asc',
        active: true
      })
    );

    return (data?.data?.listings || [])
      .map(normalizeRuneOrder)
      .filter(order => order !== null);
  } catch (error) {
    logError(`Rune market price fetch failed: ${error.message}`);
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
