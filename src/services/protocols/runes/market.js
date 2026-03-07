const axios = require('axios');
const { logError } = require('../../../utils/logger');
const { SATFLOW_API_BASE_URL, isMagicEdenEnabled } = require('../../core/environment');

function normalizeRuneTicker(value) {
  return String(value || '')
    .replace(/[•.\s_-]/g, '')
    .toUpperCase();
}

function getNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function extractTokenAmount(listing, runeMeta) {
  const divisibility = getNumber(
    runeMeta?.divisibility ??
    runeMeta?.decimals ??
    listing?.collection?.rune_divisibility ??
    0
  );

  const formattedMetaAmount = getNumber(runeMeta?.formattedAmount);
  if (formattedMetaAmount > 0) {
    return formattedMetaAmount;
  }

  const rawMetaAmount = getNumber(runeMeta?.amount ?? runeMeta?.rune_amount);
  if (rawMetaAmount > 0) {
    if (divisibility > 0 && rawMetaAmount >= Math.pow(10, divisibility)) {
      return rawMetaAmount / Math.pow(10, divisibility);
    }
    return rawMetaAmount;
  }

  const fallbackAmount = getNumber(
    listing?.token?.inscription_number ??
    listing?.ask?.inscriptionNumber ??
    listing?.inscription_number ??
    listing?.inscriptionNumber
  );
  return fallbackAmount > 0 ? fallbackAmount : NaN;
}

function toSatflowOrder(listing, targetRuneTicker) {
  const price = getNumber(listing?.ask?.price ?? listing?.price ?? listing?.listedPrice);
  if (!(price > 0)) {
    return null;
  }

  const target = normalizeRuneTicker(targetRuneTicker);
  const runeLists = [
    listing?.ask?.runes_metadata?.runes,
    listing?.runes_metadata?.runes,
    listing?.inscription_metadata?.runes,
    listing?.ask?.inscription_metadata?.runes,
    listing?.token?.runes
  ].filter(Array.isArray);

  for (const runes of runeLists) {
    for (const runeMeta of runes) {
      const runeName = runeMeta?.name || runeMeta?.ticker || runeMeta?.symbol || runeMeta?.id;
      if (target && runeName && normalizeRuneTicker(runeName) !== target) {
        continue;
      }

      const amount = extractTokenAmount(listing, runeMeta);
      if (!(amount > 0)) {
        continue;
      }

      return {
        side: 'sell',
        status: 'valid',
        isPending: false,
        formattedAmount: amount.toString(),
        formattedUnitPrice: (price / amount).toString(),
        source: 'satflow'
      };
    }
  }

  const fallbackAmount = extractTokenAmount(listing, null);
  if (fallbackAmount > 0) {
    return {
      side: 'sell',
      status: 'valid',
      isPending: false,
      formattedAmount: fallbackAmount.toString(),
      formattedUnitPrice: (price / fallbackAmount).toString(),
      source: 'satflow'
    };
  }

  return null;
}

async function fetchSatflowRuneOrders(runeTicker) {
  if (!process.env.SATFLOW_API_KEY) {
    logError('SATFLOW_API_KEY is required to fetch rune market data from Satflow');
    return [];
  }

  const slugCandidates = [
    runeTicker,
    process.env[`${runeTicker}_FULL_TICKER`]
  ].filter(Boolean);

  const listings = [];
  for (const collectionSlug of [...new Set(slugCandidates)]) {
    const url = `${SATFLOW_API_BASE_URL}/activity/listings?collectionSlug=${encodeURIComponent(collectionSlug)}&sortBy=price&sortDirection=asc&active=true`;
    try {
      const { data } = await axios.get(url, {
        headers: {
          Accept: 'application/json',
          'x-api-key': process.env.SATFLOW_API_KEY
        }
      });
      listings.push(...(data?.data?.listings || []));
    } catch (error) {
      logError(`Satflow rune listing fetch failed for '${collectionSlug}': ${error.message}`);
    }
  }

  const targetTicker = process.env[`${runeTicker}_FULL_TICKER`] || runeTicker;
  const orders = listings
    .map(listing => toSatflowOrder(listing, targetTicker))
    .filter(Boolean)
    .sort((a, b) => Number(a.formattedUnitPrice) - Number(b.formattedUnitPrice));

  return orders;
}

async function fetchMagicEdenRuneOrders(runeTicker) {
  try {
    const url = `https://api-mainnet.magiceden.us/v2/ord/btc/runes/orders/${runeTicker}` +
      '?offset=0&sort=unitPriceAsc&includePending=false&side=sell';
    const { data } = await axios.get(url);

    return (data?.orders || []).filter(order => {
      if (!order || order.side !== 'sell' || order.status !== 'valid' || order.isPending) {
        return false;
      }
      const amount = parseFloat(order.formattedAmount);
      const unitPrice = parseFloat(order.formattedUnitPrice);
      return !isNaN(amount) && !isNaN(unitPrice) && amount > 0 && unitPrice > 0;
    });
  } catch (error) {
    logError(`Magic Eden rune market fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * Fetches valid sell orders for a rune from Satflow.
 * If Satflow returns no usable orders and ENABLE_MAGIC_EDEN=true, falls back to Magic Eden.
 * @param {string} runeTicker - The rune's ticker symbol
 * @returns {Promise<Array>} Array of valid sell orders
 */
async function fetchRuneOrders(runeTicker) {
  const satflowOrders = await fetchSatflowRuneOrders(runeTicker);
  if (satflowOrders.length > 0) {
    return satflowOrders;
  }

  if (!isMagicEdenEnabled()) {
    return [];
  }

  return fetchMagicEdenRuneOrders(runeTicker);
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
