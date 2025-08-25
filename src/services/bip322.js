const axios = require('axios');
const { BIP322, Signer, Verifier } = require('bip322-js');
const { deriveSigningKey, deriveWalletDetails, DEFAULT_DERIVATION_PATH } = require('./wallet-utils');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const { ECPairFactory } = require('ecpair');
const ECPair = ECPairFactory(ecc);
const { logError } = require('../utils/logger');

async function getSatflowChallenge(address) {
  try {
    const response = await axios.get(
      'https://api.satflow.com/v1/challenge',
      {
        params: {
          address
        },
        headers: {
          'Accept': 'application/json',
          'x-api-key': process.env.SATFLOW_API_KEY
        }
      }
    );

    // Handle new nested API response structure
    return response.data.data?.challenge || response.data.challenge;
  } catch (error) {
    logError(`Failed to get Satflow challenge: ${error.message}`);
    if (error.response) {
      logError('Response data:', error.response.data);
      logError('Response status:', error.response.status);
    }
    throw error;
  }
}

async function verifySatflowChallenge(address, signature, challenge) {
  try {
    // If no challenge is provided, get it from the server
    if (!challenge) {
      challenge = await getSatflowChallenge(address);
    }
    
    // Use BIP322 verification
    const isValid = Verifier.verifySignature(address, challenge, signature);
    return { verified: isValid };
  } catch (error) {
    logError(`Failed to verify challenge: ${error.message}`);
    throw error;
  }
}

function signChallenge(challenge, seed) {
  try {
    // Get the key pair using existing wallet-utils functionality
    const keyPair = deriveSigningKey(seed, DEFAULT_DERIVATION_PATH);
    
    // Get the corresponding address for this key
    const { address } = deriveWalletDetails(seed);
    
    // Convert private key to WIF format
    const ecPair = ECPair.fromPrivateKey(keyPair.privateKey);
    const wif = ecPair.toWIF();
    
    // Sign using BIP322
    const signature = Signer.sign(
      wif,
      address,
      challenge
    );
    
    return signature;
  } catch (error) {
    logError(`Failed to sign challenge: ${error.message}`);
    throw error;
  }
}

module.exports = {
  getSatflowChallenge,
  verifySatflowChallenge,
  signChallenge
};
