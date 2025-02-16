# Ordinal/Rune Marketplace Bid & Listing Bot

This Node.js application automates bidding (WIP) and listing for Ordinals/Rune marketplace items. It currently uses:

- Magic Eden (as a price index source)
- Satflow (for listing items and, later, placing bids)

## Prerequisites

1. **Node.js v14+**: Make sure you have a recent version of Node installed.
2. **npm or yarn**: To manage dependencies.
3. **Environment Variables**: A local `.env` file with your confidential keys (see `.env.sample` for structure).

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `COLLECTIONS` | Comma-separated list of collections to process (e.g., "runestone,nodemonkes") | - |
| `LOOP_SECONDS` | Interval (in seconds) for each run | 15 |
| `LOCAL_WALLET_SEED` | The seed phrase (private—do not commit) | - |
| `LOCAL_TAP_KEY` | Taproot key used for signing listings on Satflow | - |
| `LOCAL_WALLET_ADDRESS` | The segwit address associated with your wallet | - |
| `ZENROWS_API_KEY` | API key for ZenRows (used to proxy or scrape data from Magic Eden) | - |
| `SATFLOW_API_KEY` | API key for Satflow marketplace | - |

For each collection (e.g., RUNESTONE, NODEMONKES), the following variables can be set:
| Variable Pattern | Description | Default |
|----------|-------------|---------|
| `{COLLECTION}_NUM_CHEAPEST_ITEMS` | Number of cheapest items to average in price calculation | - |
| `{COLLECTION}_BID_BELOW_PERCENT` | Multiplier to bid below the average price (e.g., 0.8 = 80% of average) | - |
| `{COLLECTION}_LIST_ABOVE_PERCENT` | Multiplier to list above the average price (e.g., 1.2 = 120% of average) | - |

## Usage

1. **Clone or Download** this repository.

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Set Up Environment**:
   - Copy `.env.sample` to `.env`
   - Fill in the required variables in `.env` (for development)

4. **Run the Application**:
   ```bash
   npm start
   ```

5. **Signing into Marketplaces**:
   - Ensure that your wallet address in `.env` matches the address you use on Satflow and Magic Eden
   - This address should hold the Ordinal inscriptions you intend to list

## How It Works

1. **Collection Configuration**: The bot processes multiple collections specified in the `COLLECTIONS` environment variable.

2. **Fetch Price Data**: For each collection, the bot calls Magic Eden (via ZenRows) to get listed items and their sat prices.

3. **Calculate Average**: For each collection, it gathers the cheapest N items (defined by `{COLLECTION}_NUM_CHEAPEST_ITEMS`) to compute a baseline average price.

4. **List Items**: The bot checks your wallet on Satflow, sees which items from each collection you hold, and lists them using your desired markup (`{COLLECTION}_LIST_ABOVE_PERCENT`).

5. **(Future) Bid Items**: Logic for bidding below average (`{COLLECTION}_BID_BELOW_PERCENT`) will be added later.

6. **Modularity**: The code supports multiple collections and is written to extend to multiple marketplaces in the future.

## Notes

- This is a starter implementation. Security-hardened logic for handling private keys in production has not been included
- Always confirm your transactions on test environment or small amounts first to ensure correctness
- For advanced features (like multi-collection or multi-marketplace), you can expand the logic in `src/index.js`

## Disclaimer

- This tool is for demonstration purposes. Use caution when exposing private keys or executing transactions on the Bitcoin mainnet
- No guarantee of suitability for production use is provided
