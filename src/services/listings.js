const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const { deriveWalletDetails, deriveSigningKey, DEFAULT_DERIVATION_PATH } = require('./wallet-utils');
const { signPSBT, finalizePSBT } = require('./psbt-utils');
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

module.exports = {
  listOnSatflow
};
