const axios = require('axios');
const { deriveWalletDetails } = require('./wallet-utils');
const { logError } = require('../utils/logger');

/**
 * Fetches ordinal inscriptions from the wallet
 * @returns {Promise<Array>} Array of ordinal items
 */
async function fetchOrdinalContents(walletDetails) {
  try {
    const walletUrl = `https://native.satflow.com/walletContents?address=${walletDetails.address}&connectedAddress=${walletDetails.address}&page=1&page_size=100&itemType=inscription`;
    
    const response = await axios.get(walletUrl, {
      headers: {
        'x-api-key': process.env.SATFLOW_API_KEY
      }
    });

    const { data } = response;
    if (!data || !data.results || !data.results.items) {
      logError('Invalid ordinals response');
      return [];
    }

    // Build accurate listing counts from items data
    const listingCounts = {};
    data.results.items.forEach(item => {
      if (item.collection?.id) {
        listingCounts[item.collection.id] = listingCounts[item.collection.id] || { total: 0, listed: 0 };
        listingCounts[item.collection.id].total++;
        if (item.listing) {
          listingCounts[item.collection.id].listed++;
        }
      }
    });

    // Log ordinals summary
    (data.results.summary || []).forEach(collection => {
      if (collection.collection?.id) {
        const counts = listingCounts[collection.collection.id] || { total: 0, listed: 0 };
        console.log(`${collection.collection.name}: ${counts.total} items (${counts.listed} listed)`);
      }
    });

    return data.results.items;
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
    const walletUrl = `https://native.satflow.com/walletContents?address=${walletDetails.address}&connectedAddress=${walletDetails.address}&page=1&page_size=100&itemType=rune`;
    
    const response = await axios.get(walletUrl, {
      headers: {
        'x-api-key': process.env.SATFLOW_API_KEY
      }
    });

    const { data } = response;
    if (!data || !data.results || !data.results.items) {
      logError('Invalid runes response');
      return [];
    }

    // Calculate total balance for each rune
    const runeBalances = {};
    data.results.items.forEach(item => {
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

    return data.results.items;
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

    const [ordinals, runes] = await Promise.all([
      fetchOrdinalContents(walletDetails),
      fetchRuneContents(walletDetails)
    ]);

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
