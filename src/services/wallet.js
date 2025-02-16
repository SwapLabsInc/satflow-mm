const axios = require('axios');
const { deriveWalletDetails } = require('./wallet-utils');

async function fetchWalletContents() {
  try {
    const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
    console.log('Using derived wallet details:', {
      address: walletDetails.address,
      tapKeyLength: walletDetails.tapKey.length
    });

    const walletUrl = `https://native.satflow.com/walletContents?address=${walletDetails.address}&connectedAddress=${walletDetails.address}&page=1&page_size=100&itemType=inscription`;
    console.log('Fetching wallet contents from:', walletUrl);
    console.log('Making request with headers:', {
      'x-api-key': process.env.SATFLOW_API_KEY
    });

    const response = await axios.get(walletUrl, {
      headers: {
        'x-api-key': process.env.SATFLOW_API_KEY
      }
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);
    console.log('Wallet contents response:', JSON.stringify(response.data, null, 2));

    const { data } = response;

    if (!data || !data.results || !data.results.items) {
      console.error('Invalid wallet contents response structure:', data);
      return [];
    }

    return data.results.items;
  } catch (error) {
    console.error('Error fetching wallet contents:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      headers: error.response?.headers
    });
    return [];
  }
}

module.exports = {
  fetchWalletContents
};
