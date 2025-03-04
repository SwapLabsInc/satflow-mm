# Satflow Market Maker - Ordinal/Rune Marketplace Bid & Listing Bot

This Node.js application automates bidding and listing for Ordinals/Rune marketplace items. It currently uses:

- Magic Eden (as a price index source)
- Satflow (for listing items and, later, placing bids)

The application supports both Ordinals collections and Runes:
- Ordinals collections (e.g., Runestone, NodeMonkes)
- Runes (e.g., DOGGOTOTHEMOON)

## Prerequisites

1. **Node.js v14+**: Make sure you have a recent version of Node installed.
2. **npm or yarn**: To manage dependencies.
3. **Environment Variables**: A local `.env` file with your confidential keys (see `.env.sample` for structure).

## Environment Variables

### Required Variables

| Variable | Description |
|----------|-------------|
| `COLLECTIONS` | Comma-separated list of collections/runes to process. Format: `collection_name` for Ordinals, `rune:TICKER` for Runes (e.g., "runestone,nodemonkes,rune:DOGGOTOTHEMOON") |
| `LOCAL_WALLET_SEED` or (`LOCAL_WALLET_SEED_ENCRYPTED` + `LOCAL_WALLET_SEED_PASSWORD`) | Either the plaintext seed phrase (not recommended for production) or the encrypted seed with its password (recommended for production). See [Seed Encryption](#seed-encryption) below. |
| `SATFLOW_API_KEY` | API key for Satflow marketplace (easily obtained by requesting in our [Discord](https://discord.gg/satflow)) via a support ticket |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOOP_SECONDS` | Interval (in seconds) for each run | 15 |
| `UPDATE_THRESHOLD` | Minimum price difference (as decimal) required before updating listings/bids | 0.01 (1%) |
| `IGNORED_MARKET_ADDRESSES` | Comma-separated list of wallet addresses whose listings should be excluded from price calculations | - |
| `ZENROWS_API_KEY` | API key for ZenRows (used to proxy or scrape data from Magic Eden) | - |

### Collection-Specific Variables

For Ordinals collections (e.g., RUNESTONE, NODEMONKES), the following optional variables can be set:

| Variable Pattern | Description | Default |
|----------|-------------|---------|
| `{COLLECTION}_NUM_CHEAPEST_ITEMS` | Number of cheapest items to average in price calculation | 10 |
| `{COLLECTION}_LIST_ABOVE_PERCENT` | Multiplier to list above the average price (e.g., 1.2 = 120% of average) | 1.2 |
| `{COLLECTION}_BID_BELOW_PERCENT` | Multiplier to bid below the average price (e.g., 0.8 = 80% of average) | 0.8 |
| `{COLLECTION}_BID_LADDER` | Alternative to BID_BELOW_PERCENT: Defines multiple price points with allocations (e.g., "0.9:0.2,0.85:0.3,0.8:0.5") | - |
| `{COLLECTION}_MAX_BID_TOTAL` | Maximum total amount in sats to bid on this collection | Infinity |
| `PREMIUM_INSCRIPTION_{INSCRIPTION_ID}` | Inscription-specific listing multiplier that overrides the collection's LIST_ABOVE_PERCENT (e.g., 1.2 = 120% of average) | - |

### Runes-Specific Variables

For Runes (e.g., DOGGOTOTHEMOON), the following variables can be set:

| Variable Pattern | Description | Default |
|----------|-------------|---------|
| `{RUNE_TICKER}_MARKET_DEPTH_SATS` | **Required**: Market depth in sats for price calculation (e.g., 10000000 for 10M sats depth) | - |
| `{RUNE_TICKER}_LIST_ABOVE_PERCENT` | Multiplier to list above the average price (e.g., 1.2 = 120% of average) | 1.2 |
| `{RUNE_TICKER}_BID_BELOW_PERCENT` | Multiplier to bid below the average price (e.g., 0.8 = 80% of average) | 0.8 |
| `{RUNE_TICKER}_BID_LADDER` | Alternative to BID_BELOW_PERCENT: Defines multiple price points with allocations (e.g., "0.9:0.2,0.85:0.3,0.8:0.5") | - |
| `{RUNE_TICKER}_MAX_BID_TOTAL` | Maximum total amount in sats to bid on this rune | Infinity |

### Premium Inscription Pricing

You can set custom pricing multipliers for specific inscriptions using the `PREMIUM_INSCRIPTION_{INSCRIPTION_ID}` environment variable. This acts like an inscription-specific `LIST_ABOVE_PERCENT`, allowing you to price individual items at a premium (or discount) relative to the collection's average price.

Example:
```
# List a specific runestone at 120% of the average price
PREMIUM_INSCRIPTION_4727db8e2f1e8696b2d8339a8a1dd7e0f12a8a86e2df80eb4afbccfca06667c1i987=1.2
```

When set, this overrides the collection's `LIST_ABOVE_PERCENT` for that specific inscription. Other inscriptions in the collection continue to use the collection's default `LIST_ABOVE_PERCENT`.

## Seed Encryption

For enhanced security, especially in production environments, you can encrypt your wallet seed phrase. The application provides a built-in tool to help you encrypt your seed:

1. **Encrypt Your Seed**:
   ```bash
   npm run encrypt-seed
   ```
   This interactive tool will:
   - Let you enter a new seed phrase or use an existing one from your .env file
   - Validate the seed phrase
   - Prompt for an encryption password
   - Generate the encrypted seed
   - Provide the necessary environment variables

2. **Update Environment**:
   - Replace `LOCAL_WALLET_SEED` with the generated `LOCAL_WALLET_SEED_ENCRYPTED` in your .env file
   - The application will prompt for your decryption password each time it starts

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
   - This address should hold the Ordinal inscriptions and Runes you intend to list

## How It Works

1. **Collection/Rune Configuration**: The bot processes multiple collections and runes specified in the `COLLECTIONS` environment variable.

2. **Fetch Price Data**: 
   - For Ordinals collections: Calls Magic Eden to get listed items and their sat prices
   - For Runes: Calls Magic Eden's runes API to get order book data

3. **Calculate Average**: 
   - For Ordinals: Gathers the cheapest N items (default: 10, configurable via `{COLLECTION}_NUM_CHEAPEST_ITEMS`) to compute a baseline average price
   - For Runes: Calculates average price based on order book depth (required, configurable via `{RUNE_TICKER}_MARKET_DEPTH_SATS`)

4. **List Items**: The bot checks your wallet on Satflow, sees which items you hold, and lists them using your desired markup (configurable via `{COLLECTION/RUNE}_LIST_ABOVE_PERCENT`).

5. **Bid Items**: The bot places bids on items using one of two strategies:
   - **Single Price Strategy**: Places bids at a single price point below the average market price (configurable via `{COLLECTION/RUNE}_BID_BELOW_PERCENT`)
   - **Ladder Price Strategy**: Places bids at multiple price points with different allocations of your bidding budget (configurable via `{COLLECTION/RUNE}_BID_LADDER`)

6. **Price Update Threshold**: The bot only updates listings and bids when the price difference exceeds the configured threshold (`UPDATE_THRESHOLD`). For example, with a threshold of 0.01 (1%), a listing at 100,000 sats will only be updated if the new price differs by more than 1,000 sats. This helps reduce the number of updates sent to marketplaces and improves overall market health.

7. **Ladder Pricing**: When using the ladder pricing strategy, the bot distributes your bidding budget across multiple price points. For example, with a ladder configuration of "0.9:0.2,0.85:0.3,0.8:0.5", the bot will:
   - Place 20% of your budget at 90% of the average price
   - Place 30% of your budget at 85% of the average price
   - Place 50% of your budget at 80% of the average price
   This creates a more sophisticated market making strategy that can capture more trades at different price points.

   **Note for Ordinals**: Due to Satflow API requirements, all Ordinals bid prices are automatically rounded to 1000 sat increments (e.g., 3,000, 4,000, 5,000 sats). This rounding is handled automatically by the bot.

8. **Modularity**: The code supports multiple collections and runes, and is written to extend to multiple marketplaces in the future.

## Notes

- Always confirm your transactions on test environment or small amounts first to ensure correctness
- For advanced features (like multi-collection or multi-marketplace), you can expand the logic in `src/index.js`

## Disclaimer

- This tool is for demonstration purposes. Use caution when exposing private keys or executing transactions on the Bitcoin mainnet
- No guarantee of suitability for production use is provided
