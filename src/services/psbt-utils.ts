import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as tinysecp from 'tiny-secp256k1';

const ECPair = ECPairFactory(tinysecp);

const SIGHASH_ALL = 0x01;
const SIGHASH_SINGLE = 0x03;
const SIGHASH_ANYONECANPAY = 0x80;

function debugPSBT(psbt, isSecure, indicesToSign) {
  console.log('\nDEBUG: PSBT Details');
  console.log(`Type: ${isSecure ? 'Secure' : 'Insecure'} PSBT`);
  console.log(`Indices to sign: ${JSON.stringify(indicesToSign)}`);
  console.log(`Sighash type: ${isSecure ? '0x81 (SIGHASH_ALL | ANYONECANPAY)' : '0x83 (SIGHASH_SINGLE | ANYONECANPAY)'}`);

  console.log('\nInput details:');
  psbt.data.inputs.forEach((input, index) => {
    console.log(`\nInput ${index}:`);
    console.log('- witnessUtxo:', input.witnessUtxo);
    console.log('- partialSig:', input.partialSig?.map(sig => ({
      pubkey: sig.pubkey.toString('hex'),
      signature: sig.signature.toString('hex')
    })));
    console.log('- sighashType:', input.sighashType);
    console.log(`- Will be signed: ${indicesToSign.includes(index)}`);
  });

  console.log('\nGlobal fields:');
  console.log('- unknownKeyVals:', psbt.data.globalMap.unknownKeyVals?.map(kv => ({
    key: kv.key.toString('hex'),
    value: kv.value.toString('hex')
  })));
}

function signPSBT(psbt:bitcoin.Psbt, signingKey, isSecure, indicesToSign, tapKey) {
  // Create ECPair from signing key
  const keyPair = ECPair.fromPrivateKey(Buffer.from(signingKey.privateKey));
  const publicKey = Buffer.from(signingKey.publicKey);
  const signer:bitcoin.Signer = {
    publicKey,
    sign: (hash) => Buffer.from(keyPair.sign(hash))
  };

  // Determine which inputs to sign (always use provided indices or default to [0])
  const inputsToSign = indicesToSign || [0];
  console.log(`Will sign input indices: ${JSON.stringify(inputsToSign)}`);

  // Use different sighash types for secure vs insecure
  const sighashType = isSecure ?
    (SIGHASH_ALL | SIGHASH_ANYONECANPAY) :     // 0x81 for secure
    (SIGHASH_SINGLE | SIGHASH_ANYONECANPAY);   // 0x83 for insecure

  console.log(`Using sighash type: 0x${sighashType.toString(16)} for ${isSecure ? 'secure' : 'insecure'} PSBT`);

  // Sign specified inputs
  for (const index of inputsToSign) {
    if (index >= psbt.data.inputs.length) {
      console.error(`Invalid input index ${index}, PSBT only has ${psbt.data.inputs.length} inputs`);
      continue;
    }

    console.log(`Signing input ${index} with sighash type 0x${sighashType.toString(16)}`);
    psbt.signInput(index, signer, [sighashType]);
    console.log(`Successfully signed input ${index}`);
  }

  // Debug PSBT state
  debugPSBT(psbt, isSecure, inputsToSign);

  return psbt;
}

function finalizePSBT(psbt) {
  try {
    // We don't need to finalize PSBTs since Satflow will do that
    return psbt;
  } catch (error) {
    console.error('Error finalizing PSBT:', error);
    throw error;
  }
}

module.exports = {
  signPSBT,
  finalizePSBT
};
