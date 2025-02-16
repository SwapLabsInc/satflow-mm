const bitcoin = require('bitcoinjs-lib');
const { ECPairFactory } = require('ecpair');
const tinysecp = require('tiny-secp256k1');

const ECPair = ECPairFactory(tinysecp);

const SIGHASH_ALL = 0x01;
const SIGHASH_SINGLE = 0x03;
const SIGHASH_ANYONECANPAY = 0x80;

function signPSBT(psbt, signingKey, isSecure, indicesToSign, tapKey) {
  // Create ECPair from signing key
  const keyPair = ECPair.fromPrivateKey(Buffer.from(signingKey.privateKey));
  const publicKey = Buffer.from(signingKey.publicKey);
  const signer = {
    publicKey,
    sign: (hash) => Buffer.from(keyPair.sign(hash))
  };

  // Determine which inputs to sign
  const inputsToSign = indicesToSign || [0];

  // Use different sighash types for secure vs insecure
  const sighashType = isSecure ?
    (SIGHASH_ALL | SIGHASH_ANYONECANPAY) :     // 0x81 for secure
    (SIGHASH_SINGLE | SIGHASH_ANYONECANPAY);   // 0x83 for insecure

  // Sign specified inputs
  for (const index of inputsToSign) {
    if (index >= psbt.data.inputs.length) {
      console.error(`Invalid input index ${index}, PSBT only has ${psbt.data.inputs.length} inputs`);
      continue;
    }
    psbt.signInput(index, signer, [sighashType]);
  }

  return psbt;
}

function finalizePSBT(psbt) {
  try {
    // We don't need to finalize PSBTs since Satflow will do that
    return psbt;
  } catch (error) {
    console.error('Error finalizing PSBT:', error.message);
    throw error;
  }
}

module.exports = {
  signPSBT,
  finalizePSBT
};
