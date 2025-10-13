const axios = require('axios');
const { logError } = require('../../../utils/logger');
const { deriveWalletDetails } = require('../../wallet-utils');
const { SATFLOW_API_BASE_URL } = require('../../core/environment');

async function fetchSatflowListings(collectionId) {
  const url = `${SATFLOW_API_BASE_URL}/activity/listings?collectionSlug=${collectionId}&sortBy=price&sortDirection=asc&active=true`;
  try {
    const { data } = await axios.get(url, {
      headers: {
        'Accept': 'application/json',
        'x-api-key': process.env.SATFLOW_API_KEY
      }
    });

    return data.data?.listings || [];
  } catch (error) {
    logError(`❌ Satflow API Error for collection '${collectionId}':`);
    logError(`   📍 URL: ${url}`);
    logError(`   📊 Status: ${error.response?.status || 'No status'}`);
    logError(`   📄 Response Data:`, JSON.stringify(error.response?.data, null, 2));
    logError(`   🔑 API Key Present: ${process.env.SATFLOW_API_KEY ? 'Yes' : 'No'}`);
    logError(`   🔑 Request Headers:`, JSON.stringify(error.config?.headers, null, 2));
    logError(`   💬 Full Error Message: ${error.message}`);
    
    // Additional context for debugging
    if (error.response?.status === 404) {
      logError(`   ❓ 404 Troubleshooting:`);
      logError(`      • Check if collection_id '${collectionId}' exists in Satflow`);
      logError(`      • Verify endpoint URL is correct`);
      logError(`      • Confirm API version (v1) is supported`);
    }
    
    return [];
  }
}

async function fetchMyListings(walletAddress, collectionSymbol) {
  try {
    // Fetch from both Magic Eden and Satflow in parallel
    const [meData, satflowData] = await Promise.all([
      (async () => {
        const url = `https://api-mainnet.magiceden.us/v2/ord/btc/wallets/tokens?` +
          `limit=100&offset=0&ownerAddress=${walletAddress}&showAll=true`;
        try {
          const { data } = await axios.get(url);
          return data?.tokens || [];
        } catch (error) {
          logError(`Failed to fetch Magic Eden listings: ${error.message}`);
          return [];
        }
      })(),
      fetchSatflowListings(collectionSymbol)
    ]);

    // Filter Magic Eden results for the specific collection and listed items
    const meListings = meData
      .filter(item => item.collectionSymbol === collectionSymbol && item.listed)
      .map(item => ({
        source: 'magiceden',
        inscriptionId: item.id,
        price: item.listedPrice,
        seller: item.owner
      }));

    // Filter Satflow results for the wallet address
    const satflowListings = satflowData
      .filter(item => item.ask && item.ask.sellerOrdAddress === walletAddress)
      .map(item => ({
        source: 'satflow',
        inscriptionId: item.ask.inscriptionId,
        price: item.ask.price,
        seller: item.ask.sellerOrdAddress
      }));

    // Merge both sources
    const allListings = [...meListings, ...satflowListings];

    console.log(`\n📋 My Active Listings for ${collectionSymbol}:`);
    console.log(`🔮 Magic Eden: ${meListings.length} listings`);
    console.log(`⚡ Satflow: ${satflowListings.length} listings`);
    console.log(`📊 Total: ${allListings.length} listings`);

    return allListings;
  } catch (error) {
    logError(`Failed to fetch my listings: ${error.message}`);
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
      .filter(item => item.ask && !ignoredAddresses.has(item.ask.sellerOrdAddress))
      .map(item => ({
        source: 'satflow',
        inscriptionId: item.ask.inscriptionId,
        price: item.ask.price,
        seller: item.ask.sellerOrdAddress
      }));

    // Debug: Show market data from each source
    console.log(`\n📊 Market Analysis for ${collectionSymbol}:`);
    console.log(`🔮 Magic Eden: ${meListings.length} listings`);
    if (meListings.length > 0) {
      const mePrices = meListings.map(l => l.price).sort((a, b) => a - b);
      console.log(`   └─ Price range: ${mePrices[0].toLocaleString()} - ${mePrices[mePrices.length - 1].toLocaleString()} sats`);
    }
    
    console.log(`⚡ Satflow: ${satflowListings.length} listings`);
    if (satflowListings.length > 0) {
      const satflowPrices = satflowListings.map(l => l.price).sort((a, b) => a - b);
      console.log(`   └─ Price range: ${satflowPrices[0].toLocaleString()} - ${satflowPrices[satflowPrices.length - 1].toLocaleString()} sats`);
    }

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

    console.log(`🔄 After deduplication: ${allListings.length} unique listings`);
    if (allListings.length > 0) {
      const finalPrices = allListings.map(l => l.price);
      console.log(`   └─ Final price range: ${finalPrices[0].toLocaleString()} - ${finalPrices[finalPrices.length - 1].toLocaleString()} sats`);
      
      // Show source breakdown in final listings
      const sourceBreakdown = allListings.reduce((acc, listing) => {
        acc[listing.source] = (acc[listing.source] || 0) + 1;
        return acc;
      }, {});
      console.log(`   └─ Source breakdown:`, sourceBreakdown);
    } else {
      console.log('❌ No listings found after filtering');
    }

    return allListings;
  } catch (error) {
    logError(`Market price fetch failed: ${error.message}`);
    return [];
  }
}

module.exports = {
  fetchMarketPrice,
  fetchMyListings
};
