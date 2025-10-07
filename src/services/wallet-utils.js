const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const { BIP32Factory } = require('bip32');
const { ECPairFactory } = require('ecpair');

const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);
const bip39 = require('bip39');

bitcoin.initEccLib(ecc);

// Default derivation path for BTC - DO NOT CHANGE
// This path is critical for generating the correct addresses and keys
const DEFAULT_DERIVATION_PATH = "m/84'/0'/0'/0/0";

function deriveWalletDetails(seed) {
  if (!bip39.validateMnemonic(seed)) {
    throw new Error('Invalid seed phrase');
  }
  
  // Convert mnemonic to seed
  const seedBuffer = bip39.mnemonicToSeedSync(seed);
  
  // Derive the child key using custom path if provided, otherwise use default
  const derivationPath = process.env.CUSTOM_DERIVATION_PATH || DEFAULT_DERIVATION_PATH;
  const root = bip32.fromSeed(seedBuffer);
  const child = root.derivePath(derivationPath);
  
  // Convert public key to Buffer
  const pubkeyBuffer = Buffer.from(child.publicKey);
  
  // Create SegWit payment
  const p2wpkh = bitcoin.payments.p2wpkh({
    pubkey: pubkeyBuffer,
    network: bitcoin.networks.bitcoin
  });

  // Get tap key (full public key in hex)
  const tapKey = Buffer.from(child.publicKey).toString('hex');
  
  return {
    address: p2wpkh.address,
    tapKey
  };
}

function deriveSigningKey(seed, path) {
  if (!bip39.validateMnemonic(seed)) {
    throw new Error('Invalid seed phrase');
  }
  
  // Convert mnemonic to seed
  const seedBuffer = bip39.mnemonicToSeedSync(seed);
  
  // Derive the child key
  const root = bip32.fromSeed(seedBuffer);
  const child = root.derivePath(path);
  
  // Return the child key directly since it has the correct format
  return child;
}

module.exports = {
  deriveWalletDetails,
  deriveSigningKey,
  DEFAULT_DERIVATION_PATH
};
