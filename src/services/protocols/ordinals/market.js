const axios = require('axios');
const { deriveWalletDetails } = require('../../wallet-utils');

async function fetchSatflowListings(collectionId) {
  try {
    const url = `https://native.satflow.com/listings?collection_id=${collectionId}&sortBy=price&sortDirection=asc`;
    const { data } = await axios.get(url, {
      headers: {
        'x-api-key': process.env.SATFLOW_API_KEY
      }
    });

    return data?.listings || [];
  } catch (error) {
    console.error(`Satflow listings fetch failed: ${error.message}`);
    return [];
  }
}

async function fetchMarketPrice(collectionSymbol) {
  // Get addresses to filter out from listings
  const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
  const currentAddress = walletDetails.address;
  const ignoredAddresses = new Set([
    currentAddress,
    ...(process.env.IGNORED_MARKET_ADDRESSES || '').split(',').map(addr => addr.trim()).filter(addr => addr)
  ]);

  try {
    // Fetch both ME and Satflow listings
    const [meData, satflowData] = await Promise.all([
      (async () => {
        const url = 'https://api-mainnet.magiceden.us/v2/ord/btc/tokens?' +
          `offset=0&limit=100&collectionSymbol[]=${collectionSymbol}&sortBy=priceAsc` +
          '&disablePendingTransactions=true&showAll=true&rbfPreventionListingOnly=false';
        const { data } = await axios.get(url);
        return data?.tokens || [];
      })(),
      fetchSatflowListings(collectionSymbol)
    ]);

    // Filter out ignored listings and normalize data structure
    const meListings = meData
      .filter(item => !ignoredAddresses.has(item.owner))
      .map(item => ({
        source: 'magiceden',
        inscriptionId: item.id,
        price: item.listedPrice,
        seller: item.owner
      }));

    const satflowListings = satflowData
      .filter(item => !ignoredAddresses.has(item.seller))
      .map(item => ({
        source: 'satflow',
        inscriptionId: item.inscriptionId,
        price: item.price,
        seller: item.seller
      }));

    // Deduplicate listings by inscription ID, keeping the lower price
    const listingsByInscription = new Map();
    
    [...meListings, ...satflowListings].forEach(listing => {
      const existingListing = listingsByInscription.get(listing.inscriptionId);
      if (!existingListing || listing.price < existingListing.price) {
        listingsByInscription.set(listing.inscriptionId, listing);
      }
    });

    // Convert back to array and sort by price
    const allListings = Array.from(listingsByInscription.values())
      .sort((a, b) => a.price - b.price);

    if (allListings.length === 0) {
      console.log('No listings found');
    }

    return allListings;
  } catch (error) {
    console.error(`Market price fetch failed: ${error.message}`);
    return [];
  }
}

function calculateAveragePrice(listings, collectionSymbol) {
  const numCheapest = Number(process.env[`${collectionSymbol.toUpperCase()}_NUM_CHEAPEST_ITEMS`]) || 10;
  const slice = listings.slice(0, numCheapest);
  if (slice.length === 0) return 0;

  const total = slice.reduce((sum, item) => sum + item.price, 0);
  return total / slice.length;
}

module.exports = {
  fetchMarketPrice,
  calculateAveragePrice
};
