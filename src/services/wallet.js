const axios = require('axios');
const { deriveWalletDetails } = require('./wallet-utils');

async function fetchWalletContents() {
  try {
    const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
    console.log(`Fetching wallet contents for ${walletDetails.address}`);

    const walletUrl = `https://native.satflow.com/walletContents?address=${walletDetails.address}&connectedAddress=${walletDetails.address}&page=1&page_size=100&itemType=inscription`;
    
    const response = await axios.get(walletUrl, {
      headers: {
        'x-api-key': process.env.SATFLOW_API_KEY
      }
    });

    const { data } = response;
    if (!data || !data.results || !data.results.items) {
      console.error('Invalid wallet contents response');
      return [];
    }

    // Log summary of wallet contents
    const collections = data.results.summary || [];
    const items = data.results.items || [];
    
    // Build accurate listing counts from items data
    const listingCounts = {};
    items.forEach(item => {
      if (item.collection?.id) {
        listingCounts[item.collection.id] = listingCounts[item.collection.id] || { total: 0, listed: 0 };
        listingCounts[item.collection.id].total++;
        if (item.listing) {
          listingCounts[item.collection.id].listed++;
        }
      }
    });

    collections.forEach(collection => {
      if (collection.collection?.id) {
        const counts = listingCounts[collection.collection.id] || { total: 0, listed: 0 };
        console.log(`${collection.collection.name}: ${counts.total} items (${counts.listed} listed)`);
      }
    });

    return data.results.items;
  } catch (error) {
    console.error(`Wallet fetch failed: ${error.message}`);
    return [];
  }
}

module.exports = {
  fetchWalletContents
};
