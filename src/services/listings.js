const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const { deriveWalletDetails, deriveSigningKey, DEFAULT_DERIVATION_PATH } = require('./wallet-utils');
const { signPSBT, finalizePSBT } = require('./psbt-utils');

async function listOnSatflow(item, listingPriceSats) {
  try {
    const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
    const config = {
      headers: {
        'x-api-key': process.env.SATFLOW_API_KEY
      }
    };

    // Step 1: Get the unsigned PSBT from Satflow
    const intentSellPayload = {
      price: listingPriceSats,
      inscription_id: item.token.inscription_id,
      collection_slug: item.collection.id,
      ord_address: walletDetails.address,
      receive_address: walletDetails.address,
      tap_key: walletDetails.tapKey
    };

    const intentRes = await axios.post(
      'https://native.satflow.com/intent/sell',
      JSON.stringify(intentSellPayload),
      config
    );

    const unsignedListingPSBTBase64 = intentRes.data.seller.unsignedListingPSBTBase64;
    if (!unsignedListingPSBTBase64) {
      throw new Error('No PSBT found in response');
    }

    // Extract secure listing PSBTs
    const secureListingPSBTs = intentRes.data.seller.secureListingPSBTs || [];

    // Step 2: Sign PSBTs
    const signingKey = deriveSigningKey(
      process.env.LOCAL_WALLET_SEED,
      DEFAULT_DERIVATION_PATH
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
    const bulkListPayload = {
      signed_listing_psbt: signedListingPsbtBase64,
      unsigned_listing_psbt: unsignedListingPSBTBase64,
      signed_secure_listing_psbts: signedSecureListingPSBTs,
      listings: [{
        price: listingPriceSats,
        inscription_id: item.token.inscription_id,
        collection_slug: item.collection.id,
        ord_address: walletDetails.address,
        receive_address: walletDetails.address,
        tap_key: walletDetails.tapKey
      }]
    };

    const bulkListRes = await axios.post(
      'https://native.satflow.com/bulkList',
      JSON.stringify(bulkListPayload),
      config
    );

    if (bulkListRes.status !== 200) {
      throw new Error(`Unexpected response: ${bulkListRes.status}`);
    }

    return bulkListRes.data;
  } catch (error) {
    console.error(`Failed to list ${item.token.inscription_id}: ${error.message}`);
    throw error;
  }
}

module.exports = {
  listOnSatflow
};
