const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');
const { BIP32Factory } = require('bip32');
const { ECPairFactory } = require('ecpair');

const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);
const bip39 = require('bip39');

bitcoin.initEccLib(ecc);

// Default derivation path for BTC
const DEFAULT_DERIVATION_PATH = "m/84'/0'/0'/0/0";

function deriveWalletDetails(seed) {
  if (!bip39.validateMnemonic(seed)) {
    throw new Error('Invalid seed phrase');
  }
  
  // Convert mnemonic to seed
  const seedBuffer = bip39.mnemonicToSeedSync(seed);
  
  // Derive the child key
  const root = bip32.fromSeed(seedBuffer);
  const child = root.derivePath(DEFAULT_DERIVATION_PATH);
  
  // Convert public key to Buffer
  const pubkeyBuffer = Buffer.from(child.publicKey);
  
  // Create SegWit payment
  const p2wpkh = bitcoin.payments.p2wpkh({
    pubkey: pubkeyBuffer,
    network: bitcoin.networks.bitcoin
  });

  // Get tap key (full public key in hex)
  const tapKey = Buffer.from(child.publicKey).toString('hex');
  
  const details = {
    address: p2wpkh.address,
    tapKey
  };
  
  console.log('Derived wallet details:', {
    address: details.address,
    tapKey: details.tapKey,
    tapKeyLength: details.tapKey.length,
    derivationPath: DEFAULT_DERIVATION_PATH
  });
  
  return details;
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
  
  // Create ECPair with custom sign function that returns Buffer
  const keyPair = ECPair.fromPrivateKey(child.privateKey);
  const originalSign = keyPair.sign.bind(keyPair);
  keyPair.sign = (hash) => {
    const signature = originalSign(hash);
    return Buffer.from(signature);
  };
  return keyPair;
}

module.exports = {
  deriveWalletDetails,
  deriveSigningKey,
  DEFAULT_DERIVATION_PATH
};
