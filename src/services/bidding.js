const axios = require('axios');
const { deriveWalletDetails } = require('./wallet-utils');
const { getSatflowChallenge, verifySatflowChallenge, signChallenge } = require('./bip322');

async function getBiddingWalletAddress() {
  try {
    const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
    
    const response = await axios.get(
      'https://native.satflow.com/biddingWallet/address',
      {
        params: {
          ordinalsAddress: walletDetails.address,
          paymentAddress: walletDetails.address,
          paymentPubkey: walletDetails.tapKey
        },
        headers: {
          'x-api-key': process.env.SATFLOW_API_KEY
        }
      }
    );

    return response.data.multiSig.address;
  } catch (error) {
    console.error(`Failed to get bidding wallet address: ${error.message}`);
    throw error;
  }
}

async function getBiddingWalletBalance(biddingAddress) {
  try {
    const response = await axios.get(
      `https://memflow.satflow.com/api/address/${biddingAddress}`
    );

    const { chain_stats, mempool_stats } = response.data;
    
    // Calculate available balance (funded - spent)
    const chainBalance = chain_stats.funded_txo_sum - chain_stats.spent_txo_sum;
    const mempoolBalance = mempool_stats.funded_txo_sum - mempool_stats.spent_txo_sum;
    const totalBalance = chainBalance + mempoolBalance;

    return totalBalance;
  } catch (error) {
    console.error(`Failed to get bidding wallet balance: ${error.message}`);
    throw error;
  }
}

async function getExistingBids() {
  try {
    const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
    
    const response = await axios.get(
      'https://native.satflow.com/walletBids',
      {
        params: {
          address: walletDetails.address
        },
        headers: {
          'x-api-key': process.env.SATFLOW_API_KEY
        }
      }
    );

    return response.data.results || [];
  } catch (error) {
    console.error(`Failed to get existing bids: ${error.message}`);
    throw error;
  }
}

async function cancelBids(bidIds) {
  try {
    console.log(`Cancelling ${bidIds.length} bids for repricing...`);
    
    const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
    
    // Get challenge and sign it
    const challenge = await getSatflowChallenge(walletDetails.address);
    const signature = signChallenge(challenge, process.env.LOCAL_WALLET_SEED);
    
    // Verify locally with the same challenge
    const verificationResult = await verifySatflowChallenge(walletDetails.address, signature, challenge);
    if (!verificationResult.verified) {
      throw new Error('Local signature verification failed');
    }

    // Cancel bids - Important: Use the regular wallet address, NOT the bidding wallet address
    const payload = {
      address: walletDetails.address,
      signature,
      bidIds
    };
    
    // Debug the exact payload being sent
    console.error('Sending payload to Satflow:', JSON.stringify(payload));
    
    const response = await axios.post(
      'https://native.satflow.com/cancel',
      payload,
      {
        headers: {
          'x-api-key': process.env.SATFLOW_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Successfully cancelled bids');
    return response.data;
  } catch (error) {
    console.error(`Failed to cancel bid: ${error.message}`);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    throw error;
  }
}

function calculateBiddingCapacity(balance, bidPrice) {
  if (balance <= 0 || bidPrice <= 0) return 0;
  return Math.floor(balance / bidPrice);
}

function getCollectionBids(bids, collectionId) {
  return bids.filter(bid => 
    bid.type === 'collection' && 
    bid.inscription_metadata?.collection?.id === collectionId
  );
}

module.exports = {
  getBiddingWalletAddress,
  getBiddingWalletBalance,
  calculateBiddingCapacity,
  getExistingBids,
  cancelBids,
  getCollectionBids
};
