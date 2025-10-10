const axios = require('axios');
const { deriveWalletDetails } = require('./wallet-utils');
const { logError } = require('../utils/logger');
const { SATFLOW_API_BASE_URL } = require('./core/environment');

/**
 * Fetches wallet contents from the new Satflow API v1 endpoint
 * @param {Object} walletDetails - Wallet details including address
 * @returns {Promise<Object>} Object containing ordinals and runes data
 */
async function fetchWalletContentsFromAPI(walletDetails) {
  try {
    const walletUrl = `${SATFLOW_API_BASE_URL}/address/wallet-contents?address=${walletDetails.address}`;
    
    const response = await axios.get(walletUrl, {
      headers: {
        'x-api-key': process.env.SATFLOW_API_KEY
      }
    });

    const { data } = response;
    if (!data || !data.success || !data.data || !data.data.results) {
      logError('Invalid wallet contents response');
      return { ordinals: [], runes: [] };
    }

    return {
      ordinals: data.data.results.ordinals || [],
      runes: data.data.results.runes || []
    };
  } catch (error) {
    logError(`Wallet contents fetch failed: ${error.message}`);
    return { ordinals: [], runes: [] };
  }
}

/**
 * Fetches ordinal inscriptions from the wallet
 * @returns {Promise<Array>} Array of ordinal items
 */
async function fetchOrdinalContents(walletDetails) {
  try {
    const { ordinals } = await fetchWalletContentsFromAPI(walletDetails);

    // Build accurate listing counts from ordinals data
    const listingCounts = {};
    ordinals.forEach(item => {
      if (item.collection?.id) {
        listingCounts[item.collection.id] = listingCounts[item.collection.id] || { total: 0, listed: 0 };
        listingCounts[item.collection.id].total++;
        if (item.listing) {
          listingCounts[item.collection.id].listed++;
        }
      }
    });

    // Log ordinals summary
    const collections = {};
    ordinals.forEach(item => {
      if (item.collection?.id) {
        collections[item.collection.id] = item.collection;
      }
    });

    Object.entries(collections).forEach(([collectionId, collection]) => {
      const counts = listingCounts[collectionId] || { total: 0, listed: 0 };
      console.log(`${collection.name}: ${counts.total} items (${counts.listed} listed)`);
    });

    return ordinals;
  } catch (error) {
    logError(`Ordinals fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * Fetches rune balances from the wallet
 * @returns {Promise<Array>} Array of rune items
 */
async function fetchRuneContents(walletDetails) {
  try {
    const { runes } = await fetchWalletContentsFromAPI(walletDetails);

    // Calculate total balance for each rune
    const runeBalances = {};
    runes.forEach(item => {
      if (item.collection?.id && item.token?.rune_amount) {
        const runeId = item.collection.id;
        runeBalances[runeId] = runeBalances[runeId] || {
          symbol: item.collection.rune_symbol || '',
          divisibility: item.collection.rune_divisibility || 0,
          total: 0
        };
        runeBalances[runeId].total += Number(item.token.rune_amount);
      }
    });

    // Log runes summary
    console.log('\nRune Balances:');
    Object.entries(runeBalances).forEach(([runeId, info]) => {
      const formattedAmount = (info.total / Math.pow(10, info.divisibility)).toLocaleString();
      console.log(`${info.symbol} ${runeId}: ${formattedAmount} tokens`);
    });

    return runes;
  } catch (error) {
    logError(`Runes fetch failed: ${error.message}`);
    return [];
  }
}

/**
 * Fetches both ordinals and runes from the wallet
 * @returns {Promise<Object>} Object containing ordinals and runes arrays
 */
async function fetchWalletContents() {
  try {
    const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
    console.log(`Fetching wallet contents for ${walletDetails.address}`);

    const { ordinals, runes } = await fetchWalletContentsFromAPI(walletDetails);

    return {
      ordinals,
      runes
    };
  } catch (error) {
    logError(`Wallet fetch failed: ${error.message}`);
    return {
      ordinals: [],
      runes: []
    };
  }
}

module.exports = {
  fetchWalletContents,
  fetchOrdinalContents,
  fetchRuneContents
};
