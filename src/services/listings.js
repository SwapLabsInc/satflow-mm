const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const { deriveWalletDetails, deriveSigningKey, DEFAULT_DERIVATION_PATH } = require('./wallet-utils');
const { signPSBT, finalizePSBT } = require('./psbt-utils');
const { signChallenge } = require('./bip322');
const { logError } = require('../utils/logger');
const { SATFLOW_API_BASE_URL } = require('./core/environment');

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

    // After successful Satflow listing, also list on Magic Eden (for Ordinals only)
    if (!item.token.rune_amount) {
      try {
        await listOnMagicEden(item, listingPriceSats);
      } catch (magicEdenError) {
        // Log but don't fail the overall listing if Magic Eden fails
        logError(`Magic Eden listing failed, but Satflow listing succeeded: ${magicEdenError.message}`);
      }
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

    // DEBUG: Log full intent response structure (REMOVE AFTER DEBUGGING)
    console.log('DEBUG - Magic Eden Intent Response Structure:');
    console.log('intentRes.data:', JSON.stringify(intentRes.data, null, 2));
    console.log('intentRes.data.data:', JSON.stringify(intentRes.data.data, null, 2));

    const intentData = intentRes.data.data;
    if (!intentData.success || !intentData.results || intentData.results.length === 0) {
      throw new Error('No results found in Magic Eden intent response');
    }

    // Extract data from the first result (we're only listing one item at a time)
    const result = intentData.results[0];
    
    // DEBUG: Log result structure (REMOVE AFTER DEBUGGING)
    console.log('DEBUG - First result structure:', JSON.stringify(result, null, 2));
    const unsignedCombinedPSBTBase64 = result.unsignedCombinedPSBTBase64;
    const unsignedListingPSBTBase64 = result.unsignedListingPSBTBase64;
    
    if (!unsignedCombinedPSBTBase64 || !unsignedListingPSBTBase64) {
      throw new Error('Missing unsigned PSBTs in Magic Eden intent response');
    }

    // DEBUG: Log intentData keys and check for messageToSign/sessionId (REMOVE AFTER DEBUGGING)
    console.log('DEBUG - intentData keys:', Object.keys(intentData));
    console.log('DEBUG - intentData.messageToSign:', intentData.messageToSign);
    console.log('DEBUG - intentData.sessionId:', intentData.sessionId);

    const messageToSign = intentData.messageToSign;
    const sessionId = intentData.sessionId;

    if (!messageToSign || !sessionId) {
      // DEBUG: More detailed error logging (REMOVE AFTER DEBUGGING)
      console.log('DEBUG - Missing fields! intentData:', JSON.stringify(intentData, null, 2));
      throw new Error('Missing messageToSign or sessionId in Magic Eden intent response');
    }

    // DEBUG: Log values found (REMOVE AFTER DEBUGGING)
    console.log('DEBUG - Found messageToSign:', messageToSign);
    console.log('DEBUG - Found sessionId:', sessionId);

    // Step 2: Sign PSBTs
    const derivationPath = process.env.CUSTOM_DERIVATION_PATH || DEFAULT_DERIVATION_PATH;
    const signingKey = deriveSigningKey(
      process.env.LOCAL_WALLET_SEED,
      derivationPath
    );

    // Sign the combined PSBT (secure, all inputs)
    let combinedPsbt = bitcoin.Psbt.fromBase64(unsignedCombinedPSBTBase64, { network: bitcoin.networks.bitcoin });
    const combinedInputsToSign = Array.from({ length: combinedPsbt.data.inputs.length }, (_, i) => i);
    combinedPsbt = signPSBT(combinedPsbt, signingKey, true, combinedInputsToSign, walletDetails.tapKey);
    const signedCombinedPSBT = combinedPsbt.toBase64();

    // Sign the listing PSBT (secure, typically input 0)
    let listingPsbt = bitcoin.Psbt.fromBase64(unsignedListingPSBTBase64, { network: bitcoin.networks.bitcoin });
    listingPsbt = signPSBT(listingPsbt, signingKey, true, [0], walletDetails.tapKey);
    const signedListingPSBT = listingPsbt.toBase64();

    // Step 3: Sign BIP322 message
    const { signature: signedMessage, challenge: unsignedMessage } = signChallenge(
      messageToSign,
      process.env.LOCAL_WALLET_SEED
    );

    // Step 4: Submit signed listing to Magic Eden
    submitPayload = {
      listings: [{
        inscriptionId: item.token.inscription_id,
        price: listingPriceSats,
        sellerReceiveAddress: walletDetails.address,
        signedRBFProtectedListingPSBT: signedListingPSBT,
        signedRBFProtectedListingTransientPSBT: signedListingPSBT
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
