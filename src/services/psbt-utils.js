const bitcoin = require('bitcoinjs-lib');
const tinysecp = require('tiny-secp256k1');
const { ECPairFactory } = require('ecpair');

const ECPair = ECPairFactory(tinysecp);

const SIGHASH_ALL = 0x01;
const SIGHASH_SINGLE = 0x03;
const SIGHASH_ANYONECANPAY = 0x80;

function normalizeSignature(signature) {
  const r = signature.slice(0, 32);
  const s = signature.slice(32, 64);
  
  // Check if R value is negative (first bit is 1)
  if (r[0] & 0x80) {
    // Negate R value
    for (let i = 0; i < 32; i++) {
      r[i] = ~r[i];
    }
    // Add 1
    let carry = 1;
    for (let i = 31; i >= 0; i--) {
      const val = r[i] + carry;
      r[i] = val & 0xff;
      carry = val >> 8;
    }
  }
  
  // Check if S value is negative (first bit is 1)
  if (s[0] & 0x80) {
    // Negate S value
    for (let i = 0; i < 32; i++) {
      s[i] = ~s[i];
    }
    // Add 1
    let carry = 1;
    for (let i = 31; i >= 0; i--) {
      const val = s[i] + carry;
      s[i] = val & 0xff;
      carry = val >> 8;
    }
  }
  
  return Buffer.concat([Buffer.from(r), Buffer.from(s)]);
}

function encodeSignature(signature, sighashType) {
  const normalizedSig = normalizeSignature(signature);
  const r = normalizedSig.slice(0, 32);
  const s = normalizedSig.slice(32, 64);
  const signatureBuffer = Buffer.concat([
    Buffer.from([0x30, 0x44, 0x02, 0x20]),
    r,
    Buffer.from([0x02, 0x20]),
    s
  ]);
  return Buffer.concat([signatureBuffer, Buffer.from([sighashType])]);
}

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

function signPSBT(psbt, signingKey, isSecure, indicesToSign, tapKey) {
  // Create ECPair from signing key
  const keyPair = ECPair.fromPrivateKey(Buffer.from(signingKey.privateKey));
  
  // Convert public key to Buffer
  const pubkeyBuffer = Buffer.from(signingKey.publicKey);
  
  // Create P2WPKH output script for hash calculation
  const p2wpkh = bitcoin.payments.p2wpkh({
    pubkey: pubkeyBuffer,
    network: bitcoin.networks.bitcoin
  });
  
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
    const hash = bitcoin.Transaction.fromBuffer(psbt.data.globalMap.unsignedTx.toBuffer()).hashForWitnessV0(
      index,
      p2wpkh.output,
      psbt.data.inputs[index].witnessUtxo.value,
      sighashType
    );
    const signature = keyPair.sign(hash);
    const encodedSignature = encodeSignature(signature, sighashType);
    
    // Update input with signature
    psbt.updateInput(index, {
      partialSig: [{
        pubkey: pubkeyBuffer,
        signature: Buffer.from(encodedSignature)
      }]
    });
    console.log(`Successfully signed input ${index}`);
  }

  // Add tap_key field in the format from the example
  // Use a single byte (0x02) for the key type
  const tapKeyBuf = Buffer.from([0x02]); // Single byte key type
  const tapKeyValBuf = Buffer.from(tapKey, 'hex');
  
  // Add global fields
  psbt.data.globalMap.unknownKeyVals = [
    { key: tapKeyBuf, value: tapKeyValBuf }
  ];

  // Remove version field from global map
  delete psbt.data.globalMap.version;

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
