const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const { deriveWalletDetails, deriveSigningKey, DEFAULT_DERIVATION_PATH } = require('./wallet-utils');
const { signPSBT, finalizePSBT } = require('./psbt-utils');

async function listOnSatflow(item, listingPriceSats) {
  try {
    // Get wallet details from seed
    const walletDetails = deriveWalletDetails(process.env.LOCAL_WALLET_SEED);
    console.log('Using derived wallet details for listing:', {
      address: walletDetails.address,
      tapKeyLength: walletDetails.tapKey.length
    });

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

    console.log('Sending intent/sell request...');

    // Get the PSBT
    console.log('Intent/sell payload:', JSON.stringify(intentSellPayload, null, 2));
    const intentRes = await axios.post(
      'https://native.satflow.com/intent/sell',
      JSON.stringify(intentSellPayload),
      config
    );
    console.log('Intent/sell response status:', intentRes.status);
    console.log('Intent/sell response:', JSON.stringify(intentRes.data, null, 2));

    const unsignedListingPSBTBase64 = intentRes.data.seller.unsignedListingPSBTBase64;

    if (!unsignedListingPSBTBase64) {
      throw new Error('No PSBT found in response');
    }

    // Extract secure listing PSBTs
    const secureListingPSBTs = intentRes.data.seller.secureListingPSBTs || [];
    console.log('Secure listing PSBTs:', JSON.stringify(secureListingPSBTs, null, 2));

    // Step 2: Derive signing key and sign the PSBTs
    const signingKey = deriveSigningKey(
      process.env.LOCAL_WALLET_SEED,
      DEFAULT_DERIVATION_PATH
    );

    // Sign the listing PSBT (insecure/snipable)
    let psbt = bitcoin.Psbt.fromBase64(unsignedListingPSBTBase64, { network: bitcoin.networks.bitcoin });
    console.log('Listing PSBT details:');
    console.log('- Number of inputs:', psbt.data.inputs.length);
    console.log('- Number of outputs:', psbt.data.outputs.length);
    console.log('- Global fields:', psbt.data.globalMap);
    console.log('- Input details:', JSON.stringify(psbt.data.inputs, null, 2));
    console.log('- Output details:', JSON.stringify(psbt.data.outputs, null, 2));

    try {
      // Sign the listing PSBT with SIGHASH_SINGLE | ANYONECANPAY
      psbt = signPSBT(psbt, signingKey, false, null, walletDetails.tapKey);
      console.log('Successfully signed listing PSBT');
    } catch (error) {
      console.error('Error signing listing PSBT:', error);
      throw error;
    }

    // Sign secure listing PSBTs
    const signedSecureListingPSBTs = [];

    try {
      // Sign secure listing PSBTs if any
      if (secureListingPSBTs.length > 0) {
        for (const securePsbtData of secureListingPSBTs) {
          if (!securePsbtData.base64) {
            console.log('Skipping invalid secure PSBT:', securePsbtData);
            continue;
          }
          console.log('Signing secure listing PSBT:', securePsbtData.base64);
          let securePsbt = bitcoin.Psbt.fromBase64(securePsbtData.base64, { network: bitcoin.networks.bitcoin });

          // Decode and inspect the secure PSBT
          console.log('Secure PSBT details:');
          console.log('- Number of inputs:', securePsbt.data.inputs.length);
          console.log('- Number of outputs:', securePsbt.data.outputs.length);
          console.log('- Global fields:', securePsbt.data.globalMap);
          console.log('- Input details:', JSON.stringify(securePsbt.data.inputs, null, 2));
          console.log('- Output details:', JSON.stringify(securePsbt.data.outputs, null, 2));

          // Sign the secure PSBT with SIGHASH_ALL | ANYONECANPAY
          securePsbt = signPSBT(securePsbt, signingKey, true, securePsbtData.indicesToSign, walletDetails.tapKey);
          signedSecureListingPSBTs.push(securePsbt.toBase64());
          console.log('Successfully signed secure listing PSBT');
        }
      }
    } catch (error) {
      console.error('Error signing secure PSBTs:', error);
      throw error;
    }

    // Step 3: Validate and prepare PSBTs for submission
    const signedListingPsbtBase64 = psbt.toBase64();
    // Validate base64 format
    if (!/^[A-Za-z0-9+/=]+$/.test(signedListingPsbtBase64)) {
      throw new Error('Invalid signed listing PSBT base64 format');
    }

    // Validate base64 format
    if (!/^[A-Za-z0-9+/=]+$/.test(unsignedListingPSBTBase64)) {
      throw new Error('Invalid unsigned listing PSBT base64 format');
    }

    // Validate secure listing PSBTs base64 format
    signedSecureListingPSBTs.forEach((psbt, index) => {
      if (!/^[A-Za-z0-9+/=]+$/.test(psbt)) {
        throw new Error(`Invalid secure listing PSBT base64 format at index ${index}`);
      }
    });

    // Log PSBTs before submission
    console.log('\nSubmitting unfinalized PSBTs to Satflow:');
    console.log('Signed listing PSBT:', signedListingPsbtBase64);
    console.log('Unsigned listing PSBT:', unsignedListingPSBTBase64);
    console.log('Signed secure listing PSBTs:', signedSecureListingPSBTs);

    // Submit unfinalized PSBTs back to Satflow
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

    console.log('Sending bulkList request...');
    const bulkListRes = await axios.post(
      'https://native.satflow.com/bulkList',
      JSON.stringify(bulkListPayload),
      config
    );
    console.log('BulkList response status:', bulkListRes.status);
    console.log(`Listed inscription ${item.token.inscription_id} at ${listingPriceSats} sats`);
    return bulkListRes.data;
  } catch (error) {
    console.error('Error in listing on Satflow:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      headers: error.response?.headers
    });
    throw error; // Re-throw to handle in caller
  }
}

module.exports = {
  listOnSatflow
};
