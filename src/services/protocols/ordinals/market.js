const axios = require('axios');
const { logError } = require('../../../utils/logger');
const { deriveWalletDetails } = require('../../wallet-utils');
const { SATFLOW_API_BASE_URL, getSatflowConfig } = require('../../core/environment');

const loggedSatflowBidFeedErrors = new Set();

function getActivityItems(data, ...legacyKeys) {
  const activityData = data?.data;

  if (Array.isArray(activityData?.items)) {
    return activityData.items;
  }

  for (const key of legacyKeys) {
    if (Array.isArray(activityData?.[key])) {
      return activityData[key];
    }
  }

  return [];
}

function normalizeSatflowListing(item) {
  const ask = item?.ask;
  const listing = item?.listing;
  const price = Number(ask?.price ?? item?.price ?? listing?.price);
  const inscriptionId = ask?.inscriptionId || item?.inscriptionId || item?.token?.inscription_id || item?.token?.id;
  const seller = ask?.sellerOrdAddress ||
    item?.sellerOrdAddress ||
    listing?.sellerAddress ||
    item?.sellerAddress ||
    item?.seller ||
    item?.owner;

  if (!inscriptionId || !Number.isFinite(price) || price <= 0) {
    return null;
  }

  return {
    source: 'satflow',
    inscriptionId,
    price,
    seller
  };
}

function normalizeSatflowBid(item) {
  const bid = item?.bid;
  const price = Number(
    item?.price ??
    bid?.price ??
    item?.bidPrice ??
    item?.amount
  );
  const bidderAddresses = [
    bid?.bidderAddress,
    bid?.bidderTokenReceiveAddress,
    item?.bidderAddress,
    item?.bidderTokenReceiveAddress,
    item?.maker,
    item?.bidder?.address
  ]
    .filter(address => typeof address === 'string' && address.trim())
    .map(address => address.trim());
  const uniqueBidderAddresses = [...new Set(bidderAddresses)];
  const attribute = bid?.attribute ?? item?.attribute;

  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  return {
    source: 'satflow',
    price,
    maker: uniqueBidderAddresses[0],
    bidderAddresses: uniqueBidderAddresses,
    attribute
  };
}

async function fetchSatflowListings(collectionId) {
  const params = {
    collectionSlug: collectionId,
    sortBy: 'price',
    sortDirection: 'asc',
    active: true
  };

  try {
    const { data } = await axios.get(
      `${SATFLOW_API_BASE_URL}/activity/listings`,
      getSatflowConfig(params)
    );

    return getActivityItems(data, 'listings');
  } catch (error) {
    logError(`❌ Satflow API Error for collection '${collectionId}':`);
    logError(`   📍 Params: ${JSON.stringify(params)}`);
    logError(`   📊 Status: ${error.response?.status || 'No status'}`);
    logError(`   📄 Response Data:`, JSON.stringify(error.response?.data, null, 2));
    logError(`   🔑 API Key Present: ${process.env.SATFLOW_API_KEY ? 'Yes' : 'No'}`);
    logError(`   🔑 Request Headers:`, JSON.stringify(error.config?.headers, null, 2));
    logError(`   💬 Full Error Message: ${error.message}`);

    if (error.response?.status === 404) {
      logError(`   ❓ 404 Troubleshooting:`);
      logError(`      • Check if collection_id '${collectionId}' exists in Satflow`);
      logError(`      • Verify endpoint URL is correct`);
      logError(`      • Confirm API version (v1) is supported`);
    }

    return [];
  }
}

async function fetchSatflowBids(collectionId) {
  try {
    const { data } = await axios.get(
      `${SATFLOW_API_BASE_URL}/activity/bids`,
      getSatflowConfig({
        collectionSlug: collectionId,
        sortBy: 'price',
        sortDirection: 'desc',
        active: true
      })
    );

    return getActivityItems(data, 'bids', 'results');
  } catch (error) {
    if (!loggedSatflowBidFeedErrors.has(collectionId)) {
      loggedSatflowBidFeedErrors.add(collectionId);
      logError(`Satflow bid feed unavailable for '${collectionId}': ${error.message}`);
    }
    return [];
  }
}

async function fetchMyListings(walletAddress, collectionSymbol) {
  try {
    const allListings = (await fetchSatflowListings(collectionSymbol))
      .map(normalizeSatflowListing)
      .filter(listing => listing && listing.seller === walletAddress);

    console.log(`\n📋 My Active Listings for ${collectionSymbol}:`);
    console.log(`⚡ Satflow: ${allListings.length} listings`);

    return allListings;
  } catch (error) {
    logError(`Failed to fetch my listings: ${error.message}`);
    return [];
  }
}

async function fetchCollectionBids(collectionSymbol) {
  const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
  const myAddress = walletDetails.address;
  const ignoredAddresses = new Set([
    myAddress,
    ...(process.env.IGNORED_MARKET_ADDRESSES || '').split(',').map(addr => addr.trim()).filter(addr => addr)
  ]);

  try {
    const satflowBids = (await fetchSatflowBids(collectionSymbol))
      .map(normalizeSatflowBid)
      .filter(bid => {
        if (!bid) {
          return false;
        }

        return !bid.attribute && !bid.bidderAddresses.some(address => ignoredAddresses.has(address));
      })
      .sort((a, b) => b.price - a.price);

    console.log(`\n📊 Collection Bid Analysis for ${collectionSymbol}:`);
    console.log(`⚡ Satflow: ${satflowBids.length} active bids`);
    if (satflowBids.length > 0) {
      console.log(`   └─ Highest Satflow bid: ${satflowBids[0].price.toLocaleString()} sats`);
    }

    return satflowBids;
  } catch (error) {
    logError(`Collection bid fetch failed for ${collectionSymbol}: ${error.message}`);
    if (error.response) {
      logError(`   -> Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`);
    }
    return [];
  }
}

async function fetchMarketPrice(collectionSymbol) {
  const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
  const currentAddress = walletDetails.address;
  const ignoredAddresses = new Set([
    currentAddress,
    ...(process.env.IGNORED_MARKET_ADDRESSES || '').split(',').map(addr => addr.trim()).filter(addr => addr)
  ]);

  try {
    const listings = (await fetchSatflowListings(collectionSymbol))
      .map(normalizeSatflowListing)
      .filter(listing => listing && (!listing.seller || !ignoredAddresses.has(listing.seller)));

    console.log(`\n📊 Market Analysis for ${collectionSymbol}:`);
    console.log(`⚡ Satflow: ${listings.length} listings`);
    if (listings.length > 0) {
      const prices = listings.map(listing => listing.price).sort((a, b) => a - b);
      console.log(`   └─ Price range: ${prices[0].toLocaleString()} - ${prices[prices.length - 1].toLocaleString()} sats`);
    }

    listings.sort((a, b) => a.price - b.price);

    return { listings };
  } catch (error) {
    logError(`Market price fetch failed: ${error.message}`);
    return { listings: [] };
  }
}

module.exports = {
  fetchCollectionBids,
  fetchMarketPrice,
  fetchMyListings,
};
