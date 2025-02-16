const axios = require('axios');

async function fetchMarketPrice(collectionSymbol) {
  try {
    const url = 'https://api-mainnet.magiceden.us/v2/ord/btc/tokens?' +
      `offset=0&limit=100&collectionSymbol[]=${collectionSymbol}&sortBy=priceAsc` +
      '&disablePendingTransactions=false&showAll=true&rbfPreventionListingOnly=false';

    const { data } = await axios.get(url, {
      headers: {
        // If needed: Authorization or special headers for ZenRows
        // 'Authorization': `Bearer ${process.env.ZENROWS_API_KEY}`
      }
    });

    const tokens = data?.tokens || [];
    const numCheapestItems = Number(process.env[`${collectionSymbol.toUpperCase()}_NUM_CHEAPEST_ITEMS`]) || 10;
    
    console.log(`\n${collectionSymbol} Magic Eden API Response:`);
    console.log('Total tokens found:', tokens.length);
    if (tokens.length > 0) {
      console.log(`First ${numCheapestItems} tokens (sorted by price):`);
      tokens.sort((a, b) => a.listedPrice - b.listedPrice);
      tokens.slice(0, numCheapestItems).forEach(token => {
        console.log(`- Token #${token.id}: ${token.listedPrice} sats`);
      });
    }
    return tokens;
  } catch (error) {
    console.error(`Error fetching market prices for ${collectionSymbol}:`, error.message);
    return [];
  }
}

function calculateAveragePrice(tokens, collectionSymbol) {
  const numCheapest = Number(process.env[`${collectionSymbol.toUpperCase()}_NUM_CHEAPEST_ITEMS`]) || 10;
  const sorted = tokens.sort((a, b) => a.listedPrice - b.listedPrice);
  const slice = sorted.slice(0, numCheapest);
  if (slice.length === 0) return 0;

  const total = slice.reduce((sum, item) => sum + item.listedPrice, 0);
  return total / slice.length;
}

module.exports = {
  fetchMarketPrice,
  calculateAveragePrice
};
