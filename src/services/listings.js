const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const { deriveWalletDetails, deriveSigningKey, DEFAULT_DERIVATION_PATH } = require('./wallet-utils');
const { signPSBT, finalizePSBT } = require('./psbt-utils');
const { signChallenge } = require('./bip322');
const { logError } = require('../utils/logger');
const { SATFLOW_API_BASE_URL, MAGIC_EDEN_FEE_MULTIPLIER } = require('./core/environment');

async function listOnSatflow(item, listingPriceSats) {
  let intentSellPayload; // Declare outside try block for debug access
  let bulkListPayload; // Declare outside try block for debug access

  try {
    const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
    const config = {
      headers: {
        'x-api-key': process.env.SATFLOW_API_KEY
      }
    };

    // Step 1: Get the unsigned PSBT from Satflow
    intentSellPayload = {
      price: listingPriceSats,
      sellerOrdAddress: walletDetails.address,
      sellerReceiveAddress: walletDetails.address,
      tapInternalKey: walletDetails.tapKey
    };

    // For runes, use inscription_id as runesOutput (it's actually the UTXO ID)
    // For ordinals, use inscriptionId (collection_slug no longer exists in new API)
    if (item.token.rune_amount) {
      intentSellPayload.runesOutput = item.token.inscription_id;
    } else {
      intentSellPayload.inscriptionId = item.token.inscription_id;
    }

    const intentRes = await axios.post(
      `${SATFLOW_API_BASE_URL}/intent/sell`,
      intentSellPayload,
      config
    );

    const unsignedListingPSBTBase64 = intentRes.data.data.seller.unsignedListingPSBTBase64;
    if (!unsignedListingPSBTBase64) {
      throw new Error('No PSBT found in response');
    }

    // Extract secure listing PSBTs
    const secureListingPSBTs = intentRes.data.data.seller.secureListingPSBTs || [];

    // Step 2: Sign PSBTs
    // Use the same derivation path logic as deriveWalletDetails to ensure consistency
    const derivationPath = process.env.CUSTOM_DERIVATION_PATH || DEFAULT_DERIVATION_PATH;
    const signingKey = deriveSigningKey(
      process.env.LOCAL_WALLET_SEED,
      derivationPath
    );

    // Sign the listing PSBT (insecure/snipable)
    let psbt = bitcoin.Psbt.fromBase64(unsignedListingPSBTBase64, { network: bitcoin.networks.bitcoin });
    psbt = signPSBT(psbt, signingKey, false, null, walletDetails.tapKey);

    // Sign secure listing PSBTs
    const signedSecureListingPSBTs = [];
    for (const securePsbtData of secureListingPSBTs) {
      if (!securePsbtData.base64) continue;
      let securePsbt = bitcoin.Psbt.fromBase64(securePsbtData.base64, { network: bitcoin.networks.bitcoin });
      securePsbt = signPSBT(securePsbt, signingKey, true, securePsbtData.indicesToSign, walletDetails.tapKey);
      signedSecureListingPSBTs.push(securePsbt.toBase64());
    }

    // Step 3: Submit signed PSBTs
    const signedListingPsbtBase64 = psbt.toBase64();
    bulkListPayload = {
      signedListingPSBT: signedListingPsbtBase64,
      unsignedListingPSBT: unsignedListingPSBTBase64,
      signedSecureListingPSBTs: signedSecureListingPSBTs,
      listings: [{
        price: listingPriceSats,
        sellerOrdAddress: walletDetails.address,
        sellerReceiveAddress: walletDetails.address,
        tapInternalKey: walletDetails.tapKey,
        ...(item.token.rune_amount
          ? { runesOutput: item.token.inscription_id }
          : { inscriptionId: item.token.inscription_id }
        )
      }]
    };

    const bulkListRes = await axios.post(
      `${SATFLOW_API_BASE_URL}/list`,
      bulkListPayload,
      config
    );

    if (bulkListRes.status !== 200) {
      throw new Error(`Unexpected response: ${bulkListRes.status}`);
    }

    return bulkListRes.data;
  } catch (error) {
    logError(`Failed to list ${item.token.inscription_id}: ${error.message}`);

    // Debug logging for 400 and 500 errors
    if (error.response && (error.response.status === 400 || error.response.status === 500)) {
      const errorType = error.response.status === 400 ? '400 Bad Request' : '500 Internal Server Error';
      logError(`DEBUG - ${errorType} Details:`);
      logError('Response status:', error.response.status);
      logError('Response data:', JSON.stringify(error.response.data, null, 2));
      if (intentSellPayload) {
        logError('Intent sell payload sent:', JSON.stringify(intentSellPayload, null, 2));
      }
      if (bulkListPayload) {
        logError('Bulk list payload sent:', JSON.stringify(bulkListPayload, null, 2));
      }
      logError('Request headers:', JSON.stringify(error.config?.headers, null, 2));
    }

    throw error;
  }
}

async function listOnMagicEden(item, listingPriceSats) {
  let intentPayload; // Declare outside try block for debug access
  let submitPayload; // Declare outside try block for debug access

  try {
    const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
    const config = {
      headers: {
        'x-api-key': process.env.SATFLOW_API_KEY
      }
    };

    // Step 1: Create listing intent for Magic Eden
    intentPayload = {
      listings: [{
        price: listingPriceSats,
        tokenId: item.token.inscription_id
      }],
      sellerOrdAddress: walletDetails.address,
      receiveAddress: walletDetails.address,
      sellerPublicKey: walletDetails.publicKey,
      marketplace: 'magiceden'
    };

    const intentRes = await axios.post(
      `${SATFLOW_API_BASE_URL}/intent/external-sell`,
      intentPayload,
      config
    );

    const intentData = intentRes.data.data;
    if (!intentData.success || !intentData.results || intentData.results.length === 0) {
      throw new Error('No results found in Magic Eden intent response');
    }

    // Extract data from the first result (we're only listing one item at a time)
    const result = intentData.results[0];

    const unsignedCombinedPSBTBase64 = result.unsignedCombinedPSBTBase64;
    const unsignedRBFListingPsbtBase64 = result.listing.seller.unsignedRBFProtectedListingPSBT;
    const unsignedRBFListingTransientPsbtBase64 = result.listing.seller.unsignedRBFProtectedListingTransientPSBT;

    if (!unsignedCombinedPSBTBase64 || !unsignedRBFListingPsbtBase64) {
      throw new Error('Missing unsigned PSBTs in Magic Eden intent response');
    }

    const messageToSign = intentData.messageToSign;
    const sessionId = intentData.sessionId ?? Math.round(Math.random() * 9999).toString();

    if (!messageToSign) {
      // DEBUG: More detailed error logging (REMOVE AFTER DEBUGGING)
      console.log('DEBUG - Missing fields! intentData:', JSON.stringify(intentData, null, 2));
      throw new Error('Missing messageToSign in Magic Eden intent response');
    }

    // Step 2: Sign PSBTs
    const derivationPath = process.env.CUSTOM_DERIVATION_PATH || DEFAULT_DERIVATION_PATH;
    const signingKey = deriveSigningKey(
      process.env.LOCAL_WALLET_SEED,
      derivationPath
    );

    // Sign the combined PSBT (secure, all inputs)
    let combinedPsbt = bitcoin.Psbt.fromBase64(unsignedCombinedPSBTBase64, { network: bitcoin.networks.bitcoin });
    combinedPsbt = signPSBT(combinedPsbt, signingKey, false, [0], walletDetails.tapKey);
    const signedCombinedPSBT = combinedPsbt.toBase64();

    // Sign the listing PSBT (secure, typically input 0)
    let listingPsbt = bitcoin.Psbt.fromBase64(unsignedRBFListingPsbtBase64, { network: bitcoin.networks.bitcoin });
    listingPsbt = signPSBT(listingPsbt, signingKey, true, [0], walletDetails.tapKey);
    const signedListingPSBT = listingPsbt.toBase64();

    // Sign the listing PSBT (secure, typically input 0)
    let listingTransientPsbt = bitcoin.Psbt.fromBase64(unsignedRBFListingTransientPsbtBase64, { network: bitcoin.networks.bitcoin });
    listingTransientPsbt = signPSBT(listingTransientPsbt, signingKey, true, [0], walletDetails.tapKey);
    const signedListingTransientPSBT = listingTransientPsbt.toBase64();

    // Step 3: Sign BIP322 message
    const { signature: signedMessage, challenge: unsignedMessage } = signChallenge(
      messageToSign,
      process.env.LOCAL_WALLET_SEED
    );

    // Step 4: Submit signed listing to Magic Eden
    submitPayload = {
      listings: [{
        ...result,
        inscriptionId: item.token.inscription_id,
        price: listingPriceSats,
        sellerReceiveAddress: walletDetails.address,
        signedRBFProtectedListingPSBT: signedListingPSBT,
        signedRBFProtectedListingTransientPSBT: signedListingTransientPSBT
      }],
      signedCombinedPSBT: signedCombinedPSBT,
      sellerPublicKey: walletDetails.publicKey,
      sellerOrdAddress: walletDetails.address,
      receiveAddress: walletDetails.address,
      type: 'ordinals',
      marketplace: 'magiceden',
      signedMessage: signedMessage,
      unsignedMessage: unsignedMessage,
      sessionId: sessionId
    };

    const submitRes = await axios.post(
      `${SATFLOW_API_BASE_URL}/list/external`,
      submitPayload,
      config
    );

    if (submitRes.status !== 200) {
      throw new Error(`Unexpected response: ${submitRes.status}`);
    }

    return submitRes.data;
  } catch (error) {
    logError(`Failed to list ${item.token.inscription_id} on Magic Eden: ${error.message}`);
    console.log(error.stack);

    // Debug logging for 400 and 500 errors
    if (error.response && (error.response.status === 400 || error.response.status === 500)) {
      const errorType = error.response.status === 400 ? '400 Bad Request' : '500 Internal Server Error';
      logError(`DEBUG - Magic Eden ${errorType} Details:`);
      logError('Response status:', error.response.status);
      logError('Response data:', JSON.stringify(error.response.data, null, 2));
      if (intentPayload) {
        logError('Intent payload sent:', JSON.stringify(intentPayload, null, 2));
      }
      if (submitPayload) {
        logError('Submit payload sent:', JSON.stringify(submitPayload, null, 2));
      }
      logError('Request headers:', JSON.stringify(error.config?.headers, null, 2));
    }

    throw error;
  }
}

module.exports = {
  listOnSatflow,
  listOnMagicEden
};
