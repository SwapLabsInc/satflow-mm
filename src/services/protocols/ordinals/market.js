const axios = require('axios');
const { logError } = require('../../../utils/logger');
const { deriveWalletDetails } = require('../../wallet-utils');
const { SATFLOW_API_BASE_URL, isMagicEdenEnabled } = require('../../core/environment');

function shouldUseMagicEden(options = {}) {
  if (typeof options.includeMagicEden === 'boolean') {
    return options.includeMagicEden;
  }
  return isMagicEdenEnabled();
}

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

async function fetchMagicEdenWalletListings(walletAddress) {
  const url = `https://api-mainnet.magiceden.us/v2/ord/btc/wallets/tokens?` +
    `limit=100&offset=0&ownerAddress=${walletAddress}&showAll=true`;
  try {
    const { data } = await axios.get(url);
    return data?.tokens || [];
  } catch (error) {
    logError(`Failed to fetch Magic Eden wallet listings: ${error.message}`);
    return [];
  }
}

async function fetchMagicEdenCollectionListings(collectionSymbol) {
  const url = 'https://api-mainnet.magiceden.us/v2/ord/btc/tokens?' +
    `offset=0&limit=100&collectionSymbol[]=${collectionSymbol}&sortBy=priceAsc` +
    '&disablePendingTransactions=true&showAll=true&rbfPreventionListingOnly=false';
  try {
    const { data } = await axios.get(url);
    return data?.tokens || [];
  } catch (error) {
    logError(`Failed to fetch Magic Eden market listings: ${error.message}`);
    return [];
  }
}

async function fetchMyListings(walletAddress, collectionSymbol, options = {}) {
  try {
    const includeMagicEden = shouldUseMagicEden(options);

    // Fetch Satflow always; Magic Eden only when explicitly enabled.
    const [meData, satflowData] = await Promise.all([
      includeMagicEden ? fetchMagicEdenWalletListings(walletAddress) : Promise.resolve([]),
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
    if (includeMagicEden) {
      console.log(`🔮 Magic Eden: ${meListings.length} listings`);
    } else {
      console.log('🔮 Magic Eden: disabled');
    }
    console.log(`⚡ Satflow: ${satflowListings.length} listings`);
    console.log(`📊 Total: ${allListings.length} listings`);

    return allListings;
  } catch (error) {
    logError(`Failed to fetch my listings: ${error.message}`);
    return [];
  }
}

async function fetchCollectionBids(collectionSymbol) {
  if (!isMagicEdenEnabled()) {
    return [];
  }

  // Get addresses to filter out from listings
  const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
  const myAddress = walletDetails.address;
  const ignoredAddresses = new Set([
    myAddress,
    ...(process.env.IGNORED_MARKET_ADDRESSES || '').split(',').map(addr => addr.trim()).filter(addr => addr)
  ]);

  try {
    // 1. Fetch Magic Eden Bids via ZenRows
    if (!process.env.ZENROWS_API_KEY) {
      console.log('ZENROWS_API_KEY is not set. Skipping Magic Eden bid feed.');
      return [];
    }
    const meBidsUrl = `https://api-mainnet.magiceden.io/v2/ord/btc/collection-offers/collection/${collectionSymbol}?sort=priceDesc&status[]=valid&offset=0`;
    const zenrowsUrl = `https://api.zenrows.com/v1/?apikey=${process.env.ZENROWS_API_KEY}&url=${encodeURIComponent(meBidsUrl)}`;
    
    const { data: meData } = await axios.get(zenrowsUrl);
    
    const meBids = (meData.offers || [])
      // Filter out our own bids
      .filter(offer => !ignoredAddresses.has(offer.maker))
      .map(offer => {
        // Adjust for ME's 2% taker fee to get the effective price to beat
        const adjustedPrice = Math.ceil(offer.price.amount * 0.98);
        return {
          source: 'magiceden',
          price: adjustedPrice,
          maker: offer.maker,
        };
      });

    // 2. Fetch Satflow Bids (Placeholder for future implementation)
    // const satflowBids = []; 

    // Combine and sort all bids
    const allBids = [...meBids /*, ...satflowBids*/]
      .sort((a, b) => b.price - a.price); // Sort descending

    console.log(`\n📊 Collection Bid Analysis for ${collectionSymbol}:`);
    console.log(`🔮 Magic Eden: ${meBids.length} active bids`);
    if (meBids.length > 0) {
      console.log(`   └─ Highest ME bid (effective price): ${meBids[0].price.toLocaleString()} sats`);
    }
    // console.log(`⚡ Satflow: ${satflowBids.length} active bids`);

    return allBids;

  } catch (error) {
    logError(`Collection bid fetch failed for ${collectionSymbol}: ${error.message}`);
    if (error.response) {
      logError(`   -> Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
    }
    return [];
  }
}

async function fetchMarketPrice(collectionSymbol, options = {}) {
  // Get addresses to filter out from listings
  const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
  const currentAddress = walletDetails.address;
  const ignoredAddresses = new Set([
    currentAddress,
    ...(process.env.IGNORED_MARKET_ADDRESSES || '').split(',').map(addr => addr.trim()).filter(addr => addr)
  ]);

  try {
    const includeMagicEden = shouldUseMagicEden(options);

    // Fetch Satflow always; Magic Eden only when explicitly enabled.
    const [meData, satflowData] = await Promise.all([
      includeMagicEden ? fetchMagicEdenCollectionListings(collectionSymbol) : Promise.resolve([]),
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
    if (includeMagicEden) {
      console.log(`🔮 Magic Eden: ${meListings.length} listings`);
    } else {
      console.log('🔮 Magic Eden: disabled');
    }
    if (includeMagicEden && meListings.length > 0) {
      const mePrices = meListings.map(l => l.price).sort((a, b) => a - b);
      console.log(`   └─ Price range: ${mePrices[0].toLocaleString()} - ${mePrices[mePrices.length - 1].toLocaleString()} sats`);
    }
    
    console.log(`⚡ Satflow: ${satflowListings.length} listings`);
    if (satflowListings.length > 0) {
      const satflowPrices = satflowListings.map(l => l.price).sort((a, b) => a - b);
      console.log(`   └─ Price range: ${satflowPrices[0].toLocaleString()} - ${satflowPrices[satflowPrices.length - 1].toLocaleString()} sats`);
    }

    // Sort each list by price independently
    meListings.sort((a, b) => a.price - b.price);
    satflowListings.sort((a, b) => a.price - b.price);

    return { meListings, satflowListings };
  } catch (error) {
    logError(`Market price fetch failed: ${error.message}`);
    return { meListings: [], satflowListings: [] };
  }
}

module.exports = {
  fetchCollectionBids,
  fetchMarketPrice,
  fetchMyListings,
};
