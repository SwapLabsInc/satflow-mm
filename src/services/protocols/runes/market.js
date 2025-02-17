const axios = require('axios');

async function fetchRuneOrders(runeTicker) {
  try {
    const url = `https://api-mainnet.magiceden.us/v2/ord/btc/runes/orders/${runeTicker}` +
      '?offset=0&sort=unitPriceAsc&includePending=false';

    const { data } = await axios.get(url);
    // Filter for sell orders only and valid status
    return (data?.orders || []).filter(order => 
      order.side === 'sell' && 
      order.status === 'valid' &&
      !order.isPending
    );
  } catch (error) {
    console.error(`Rune market price fetch failed: ${error.message}`);
    return [];
  }
}

function calculateAveragePriceByDepth(orders, depthSats) {
  if (!orders || orders.length === 0) {
    console.log('No orders found');
    return 0;
  }

  // Sort orders by unit price ascending (cheapest first)
  const sortedOrders = orders.sort((a, b) => 
    parseFloat(a.formattedUnitPrice) - parseFloat(b.formattedUnitPrice)
  );
  
  console.log('\nOrder Book Analysis:');
  let totalTokens = 0;
  let totalValue = 0;
  let depthRemaining = depthSats;

  for (const order of sortedOrders) {
    // Use formattedAmount and formattedUnitPrice for calculations
    const tokens = parseFloat(order.formattedAmount);
    const unitPrice = parseFloat(order.formattedUnitPrice);
    const orderValue = order.price; // Use the actual order value in sats
    
    console.log(`- ${tokens.toLocaleString()} tokens at ${unitPrice.toFixed(6)} sats/token = ${orderValue.toLocaleString()} sats total`);
    
    if (depthRemaining > 0) {
      if (orderValue <= depthRemaining) {
        // Include entire order
        totalTokens += tokens;
        totalValue += orderValue;
        depthRemaining -= orderValue;
      } else {
        // Include partial order
        const fraction = depthRemaining / orderValue;
        const partialTokens = tokens * fraction;
        totalTokens += partialTokens;
        totalValue += depthRemaining;
        depthRemaining = 0;
      }
    }
  }

  if (totalTokens === 0) return 0;

  // Return the unit price of the cheapest order
  return parseFloat(sortedOrders[0].formattedUnitPrice);
}

module.exports = {
  fetchRuneOrders,
  calculateAveragePriceByDepth
};
