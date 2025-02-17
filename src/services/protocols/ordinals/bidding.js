const axios = require('axios');
const { deriveWalletDetails } = require('../../wallet-utils');
const { getSatflowChallenge, verifySatflowChallenge, signChallenge } = require('../../bip322');

class OrdinalsBiddingService {
  constructor() {
    if (!process.env.SATFLOW_API_KEY) {
      throw new Error('SATFLOW_API_KEY environment variable is required');
    }
  }

  async getBiddingWalletAddress() {
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

  async getBiddingWalletBalance(biddingAddress) {
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

  async getExistingBids() {
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

  async cancelBids(bidIds) {
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

      const payload = {
        address: walletDetails.address,
        signature,
        bidIds
      };
      
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

  getCollectionBids(bids, collectionId) {
    return bids.filter(bid => 
      bid.type === 'collection' && 
      bid.inscription_metadata?.collection?.id === collectionId
    );
  }

  async createBid(collectionSlug, price, quantity) {
    try {
      const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
      
      // Get challenge and sign it for bid verification
      const challenge = await getSatflowChallenge(walletDetails.address);
      
      // Calculate bid expiry (7 days from now)
      const bidExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000);
      
      // Create the unsigned bidding message
      const timestamp = Date.now();
      const unsignedMessage = `${walletDetails.address}:${walletDetails.tapKey}:${walletDetails.address}:${price}:${quantity}:${bidExpiry}:${collectionSlug}:${timestamp}`;
      
      // Sign the bidding message using BIP322
      const signedBiddingMessage = signChallenge(unsignedMessage, process.env.LOCAL_WALLET_SEED);
      
      const payload = {
        bid_expiry: bidExpiry,
        bidder_payment_address: walletDetails.address,
        bidder_payment_address_pubkey: walletDetails.tapKey,
        bidder_token_receive_address: walletDetails.address,
        meta_type: 'ordinals',
        collection_slug: collectionSlug,
        price,
        quantity,
        signed_bidding_message: signedBiddingMessage,
        timestamp: timestamp
      };

      const response = await axios.post(
        'https://native.satflow.com/bid',
        payload,
        {
          headers: {
            'x-api-key': process.env.SATFLOW_API_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`Successfully created bid for ${collectionSlug}`);
      return response.data;
    } catch (error) {
      console.error(`Failed to create bid: ${error.message}`);
      if (error.response) {
        console.error('Response data:', error.response.data);
        console.error('Response status:', error.response.status);
      }
      throw error;
    }
  }
}

module.exports = {
  OrdinalsBiddingService
};
