const axios = require('axios');
const { deriveWalletDetails } = require('../../wallet-utils');
const { signChallenge } = require('../../bip322');

class RunesBiddingService {
  constructor() {
    if (!process.env.SATFLOW_API_KEY) {
      throw new Error('SATFLOW_API_KEY environment variable is required');
    }
    this.signature = null;
  }

  setSignature(signature) {
    this.signature = signature;
  }

  async getBiddingWalletAddress() {
    try {
      const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
      
      const response = await axios.get(
        'https://api.satflow.com/v1/address/bidding-wallet',
        {
          params: {
            ordinalsAddress: walletDetails.address,
            paymentAddress: walletDetails.address,
            paymentPubkey: walletDetails.tapKey
          },
          headers: {
            'Accept': 'application/json',
            'x-api-key': process.env.SATFLOW_API_KEY
          }
        }
      );

      return response.data.data?.multiSig?.address || response.data.multiSig.address;
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
      
      if (!this.signature) {
        throw new Error('Signature not set - must be initialized at start of cycle');
      }

      const payload = {
        address: walletDetails.address,
        signature: this.signature,
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

  getCollectionBids(bids, runeTicker) {
    // Get the full rune ticker from environment mapping
    const fullRuneTicker = process.env[`${runeTicker}_FULL_TICKER`];
    if (!fullRuneTicker) {
      throw new Error(`Missing ${runeTicker}_FULL_TICKER environment variable for rune ticker mapping`);
    }

    return bids.filter(bid => 
      bid.type === 'rune' && 
      bid.runes_metadata?.runes?.some(rune => rune.name === fullRuneTicker)
    );
  }

  async createBid(runeTicker, totalBidAmount, quantity) {
    try {
      const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
      
      if (!this.signature) {
        throw new Error('Signature not set - must be initialized at start of cycle');
      }

      // Get the full rune ticker from environment mapping
      const fullRuneTicker = process.env[`${runeTicker}_FULL_TICKER`];
      if (!fullRuneTicker) {
        throw new Error(`Missing ${runeTicker}_FULL_TICKER environment variable for rune ticker mapping`);
      }
      
      // Calculate bid expiry (7 days from now)
      const bidExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000);
      
      // Create the unsigned bidding message
      const timestamp = Date.now();
      const unsignedMessage = `${walletDetails.address}:${walletDetails.tapKey}:${walletDetails.address}:${totalBidAmount}:${quantity}:${bidExpiry}:${fullRuneTicker}:${timestamp}`;
      
      // Sign the bidding message using BIP322
      const signedBiddingMessage = signChallenge(unsignedMessage, process.env.LOCAL_WALLET_SEED);
      
      const payload = {
        bid_expiry: bidExpiry,
        bidder_payment_address: walletDetails.address,
        bidder_payment_address_pubkey: walletDetails.tapKey,
        bidder_token_receive_address: walletDetails.address,
        meta_type: 'runes',
        collection_slug: fullRuneTicker,
        price: totalBidAmount,
        quantity,
        signed_bidding_message: signedBiddingMessage,
        timestamp: timestamp,
        address: walletDetails.address,
        signature: this.signature
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

      console.log(`Successfully created bid for ${fullRuneTicker} at ${totalBidAmount.toLocaleString()} sats for ${quantity.toLocaleString()} tokens`);
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
  RunesBiddingService
};
