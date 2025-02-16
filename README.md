# Ordinal/Rune Marketplace Bid & Listing Bot

This Node.js application automates bidding and listing for Ordinals/Rune marketplace items. It currently uses:

- Magic Eden (as a price index source)
- Satflow (for listing items and, later, placing bids)

The application comes pre-configured with support for two collections:
- Runestone
- NodeMonkes

## Prerequisites

1. **Node.js v14+**: Make sure you have a recent version of Node installed.
2. **npm or yarn**: To manage dependencies.
3. **Environment Variables**: A local `.env` file with your confidential keys (see `.env.sample` for structure).

## Environment Variables

### Required Variables

| Variable | Description |
|----------|-------------|
| `COLLECTIONS` | Comma-separated list of collections to process (defaults to "runestone,nodemonkes") |
| `LOCAL_WALLET_SEED` | The seed phrase (private—do not commit) |
| `SATFLOW_API_KEY` | API key for Satflow marketplace |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOOP_SECONDS` | Interval (in seconds) for each run | 15 |
| `UPDATE_THRESHOLD` | Minimum price difference (as decimal) required before updating listings/bids | 0.01 (1%) |
| `ZENROWS_API_KEY` | API key for ZenRows (used to proxy or scrape data from Magic Eden) | - |

### Collection-Specific Variables

For each collection (e.g., RUNESTONE, NODEMONKES), the following optional variables can be set:

| Variable Pattern | Description | Default |
|----------|-------------|---------|
| `{COLLECTION}_NUM_CHEAPEST_ITEMS` | Number of cheapest items to average in price calculation | 10 |
| `{COLLECTION}_LIST_ABOVE_PERCENT` | Multiplier to list above the average price (e.g., 1.2 = 120% of average) | 1.2 |
| `{COLLECTION}_BID_BELOW_PERCENT` | Multiplier to bid below the average price (e.g., 0.8 = 80% of average) | Not implemented yet |
| `PREMIUM_INSCRIPTION_{INSCRIPTION_ID}` | Inscription-specific listing multiplier that overrides the collection's LIST_ABOVE_PERCENT (e.g., 1.2 = 120% of average) | - |

### Premium Inscription Pricing

You can set custom pricing multipliers for specific inscriptions using the `PREMIUM_INSCRIPTION_{INSCRIPTION_ID}` environment variable. This acts like an inscription-specific `LIST_ABOVE_PERCENT`, allowing you to price individual items at a premium (or discount) relative to the collection's average price.

Example:
```
# List a specific runestone at 120% of the average price
PREMIUM_INSCRIPTION_4727db8e2f1e8696b2d8339a8a1dd7e0f12a8a86e2df80eb4afbccfca06667c1i987=1.2
```

When set, this overrides the collection's `LIST_ABOVE_PERCENT` for that specific inscription. Other inscriptions in the collection continue to use the collection's default `LIST_ABOVE_PERCENT`.

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

3. **Calculate Average**: For each collection, it gathers the cheapest N items (default: 10, configurable via `{COLLECTION}_NUM_CHEAPEST_ITEMS`) to compute a baseline average price.

4. **List Items**: The bot checks your wallet on Satflow, sees which items from each collection you hold, and lists them using your desired markup (default: 120%, configurable via `{COLLECTION}_LIST_ABOVE_PERCENT`).

5. **(Future) Bid Items**: Logic for bidding below average (`{COLLECTION}_BID_BELOW_PERCENT`) will be added later.

6. **Price Update Threshold**: The bot only updates listings and bids when the price difference exceeds the configured threshold (`UPDATE_THRESHOLD`). For example, with a threshold of 0.01 (1%), a listing at 100,000 sats will only be updated if the new price differs by more than 1,000 sats. This helps reduce the number of updates sent to marketplaces and improves overall market health.

7. **Modularity**: The code supports multiple collections and is written to extend to multiple marketplaces in the future.

## Notes

- This is a starter implementation. Security-hardened logic for handling private keys in production has not been included
- Always confirm your transactions on test environment or small amounts first to ensure correctness
- For advanced features (like multi-collection or multi-marketplace), you can expand the logic in `src/index.js`

## Disclaimer

- This tool is for demonstration purposes. Use caution when exposing private keys or executing transactions on the Bitcoin mainnet
- No guarantee of suitability for production use is provided
