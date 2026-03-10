/**
 * Vendor Supported Assets Reference Data
 *
 * Reference data for Ledger Enterprise and Fireblocks supported assets,
 * sourced from their official API documentation:
 *
 * - Ledger Enterprise: "Currencies and Tokens | API Documentation V1"
 *   https://help.enterprise.ledger.com/api-documentation/reference/api-reference/currencies
 *   API endpoints: GET /currencies, GET /currencies/tokens
 *
 * - Fireblocks: "List Supported Assets"
 *   https://developers.fireblocks.com/reference/getsupportedassets
 *   https://developers.fireblocks.com/reference/listassets
 *   API endpoints: GET /v1/supported_assets (legacy), GET /assets (new)
 *
 * This module provides lookup functions to auto-detect vendor support status
 * for tokens in the review pipeline.
 */

import type { VendorSupportStatus } from "@/types/tokens";

// ---------------------------------------------------------------------------
// Ledger Enterprise Supported Assets
// ---------------------------------------------------------------------------
// Ledger Enterprise (Vault) supports 15 blockchains natively + all ERC-20
// tokens. Source: https://help.enterprise.ledger.com/help-center/supported-networks
//
// API: GET /currencies — returns all supported currencies
//      GET /currencies/tokens — returns all supported tokens
//      GET /currencies/{name} — get currency by name
//      GET /currencies/tokens/{network}/{address} — get token by network+address

/** Ledger Enterprise natively supported blockchain networks (15 chains) */
export const LEDGER_ENTERPRISE_NETWORKS: ReadonlyArray<{
  name: string;
  symbol: string;
  aliases: string[];
  notes?: string;
}> = [
  { name: "Bitcoin", symbol: "BTC", aliases: ["bitcoin", "btc"] },
  { name: "Ethereum", symbol: "ETH", aliases: ["ethereum", "eth", "erc20"] },
  { name: "XRP", symbol: "XRP", aliases: ["xrp", "ripple"] },
  { name: "Litecoin", symbol: "LTC", aliases: ["litecoin", "ltc"] },
  { name: "Bitcoin Cash", symbol: "BCH", aliases: ["bitcoin cash", "bch", "bitcoincash"],
    notes: "CashAddr format not supported. Recipient addresses must be in Legacy Format (P2PKH / P2SH)." },
  { name: "Stellar", symbol: "XLM", aliases: ["stellar", "xlm"] },
  { name: "Tezos", symbol: "XTZ", aliases: ["tezos", "xtz"],
    notes: "Supports all Tezos addresses. Generated addresses are in TZ2 format only." },
  { name: "Polkadot", symbol: "DOT", aliases: ["polkadot", "dot"] },
  { name: "Cardano", symbol: "ADA", aliases: ["cardano", "ada"] },
  { name: "Solana", symbol: "SOL", aliases: ["solana", "sol", "spl"],
    notes: "Only Ed25519 addresses supported. Program Derived Addresses (PDAs) not supported." },
  { name: "Polygon", symbol: "POL", aliases: ["polygon", "pol", "matic"] },
  { name: "Tron", symbol: "TRX", aliases: ["tron", "trx", "trc20"],
    notes: "Requires 1 TRX sent to parent account to activate children accounts." },
  { name: "Dogecoin", symbol: "DOGE", aliases: ["dogecoin", "doge"] },
  { name: "Cosmos", symbol: "ATOM", aliases: ["cosmos", "atom"],
    notes: "Available via Vault Signer extension with Ledger Wallet application." },
  { name: "BASE", symbol: "BASE", aliases: ["base"],
    notes: "BASE Mainnet added to Ledger Vault." },
];

/** Ledger Enterprise supported token standards */
export const LEDGER_TOKEN_STANDARDS = ["ERC-20", "ERC-721", "ERC-1155", "TRC-20"] as const;

/** Networks on which Ledger Enterprise supports staking */
export const LEDGER_STAKING_NETWORKS = [
  "ETH", "SOL", "DOT", "XTZ", "ADA", "ATOM", "POL",
] as const;

// ---------------------------------------------------------------------------
// Fireblocks Supported Assets
// ---------------------------------------------------------------------------
// Fireblocks supports 150+ blockchains and thousands of assets.
// Source: https://developers.fireblocks.com/docs/list-supported-assets-1
//         https://developers.fireblocks.com/reference/supported-assets-object
//
// API: GET /v1/supported_assets (legacy) — all supported assets
//      GET /assets (new, paginated) — detailed asset list
//      GET /blockchains (new) — all supported blockchains
//
// Asset types: BASE_ASSET, ERC20, BEP20, SOL_ASSET, ALGO_ASSET,
//              TRON_TRC20, XLM_ASSET, FIAT

/** Fireblocks asset type enum matching API response */
export type FireblocksAssetType =
  | "BASE_ASSET"
  | "ERC20"
  | "BEP20"
  | "SOL_ASSET"
  | "ALGO_ASSET"
  | "TRON_TRC20"
  | "XLM_ASSET"
  | "FIAT";

/** Major Fireblocks-supported base assets with their asset IDs */
export const FIREBLOCKS_BASE_ASSETS: ReadonlyArray<{
  assetId: string;
  name: string;
  type: FireblocksAssetType;
  aliases: string[];
  testnetId?: string;
}> = [
  { assetId: "BTC", name: "Bitcoin", type: "BASE_ASSET", aliases: ["bitcoin", "btc"], testnetId: "BTC_TEST" },
  { assetId: "ETH", name: "Ethereum", type: "BASE_ASSET", aliases: ["ethereum", "eth"], testnetId: "ETH_TEST5" },
  { assetId: "SOL", name: "Solana", type: "BASE_ASSET", aliases: ["solana", "sol"], testnetId: "SOL_TEST" },
  { assetId: "XRP", name: "XRP", type: "BASE_ASSET", aliases: ["xrp", "ripple"] },
  { assetId: "DOT", name: "Polkadot", type: "BASE_ASSET", aliases: ["polkadot", "dot"] },
  { assetId: "MATIC", name: "Polygon", type: "BASE_ASSET", aliases: ["polygon", "matic", "pol"] },
  { assetId: "AVAX", name: "Avalanche", type: "BASE_ASSET", aliases: ["avalanche", "avax"] },
  { assetId: "ALGO", name: "Algorand", type: "BASE_ASSET", aliases: ["algorand", "algo"] },
  { assetId: "ATOM", name: "Cosmos", type: "BASE_ASSET", aliases: ["cosmos", "atom"] },
  { assetId: "ADA", name: "Cardano", type: "BASE_ASSET", aliases: ["cardano", "ada"] },
  { assetId: "DOGE", name: "Dogecoin", type: "BASE_ASSET", aliases: ["dogecoin", "doge"] },
  { assetId: "LTC", name: "Litecoin", type: "BASE_ASSET", aliases: ["litecoin", "ltc"] },
  { assetId: "XLM", name: "Stellar", type: "BASE_ASSET", aliases: ["stellar", "xlm"] },
  { assetId: "XTZ", name: "Tezos", type: "BASE_ASSET", aliases: ["tezos", "xtz"] },
  { assetId: "NEAR", name: "NEAR Protocol", type: "BASE_ASSET", aliases: ["near", "near protocol"] },
  { assetId: "FTM", name: "Fantom", type: "BASE_ASSET", aliases: ["fantom", "ftm"] },
  { assetId: "HBAR", name: "Hedera", type: "BASE_ASSET", aliases: ["hedera", "hbar"] },
  { assetId: "TRX", name: "Tron", type: "BASE_ASSET", aliases: ["tron", "trx"] },
  { assetId: "BCH", name: "Bitcoin Cash", type: "BASE_ASSET", aliases: ["bitcoin cash", "bch"] },
  { assetId: "EOS", name: "EOS", type: "BASE_ASSET", aliases: ["eos"] },
  { assetId: "SUI", name: "Sui", type: "BASE_ASSET", aliases: ["sui"] },
  { assetId: "APT", name: "Aptos", type: "BASE_ASSET", aliases: ["aptos", "apt"] },
  { assetId: "SEI", name: "Sei", type: "BASE_ASSET", aliases: ["sei"] },
  { assetId: "INJ", name: "Injective", type: "BASE_ASSET", aliases: ["injective", "inj"] },
  { assetId: "OSMO", name: "Osmosis", type: "BASE_ASSET", aliases: ["osmosis", "osmo"] },
  { assetId: "KAVA", name: "Kava", type: "BASE_ASSET", aliases: ["kava"] },
  { assetId: "AXL", name: "Axelar", type: "BASE_ASSET", aliases: ["axelar", "axl"] },
  { assetId: "TIA", name: "Celestia", type: "BASE_ASSET", aliases: ["celestia", "tia"] },
  { assetId: "DYDX", name: "dYdX", type: "BASE_ASSET", aliases: ["dydx"] },
  { assetId: "RUNE", name: "THORChain", type: "BASE_ASSET", aliases: ["thorchain", "rune"] },
  { assetId: "FLR", name: "Flare", type: "BASE_ASSET", aliases: ["flare", "flr"] },
  { assetId: "CELO", name: "Celo", type: "BASE_ASSET", aliases: ["celo"] },
  { assetId: "FLOW", name: "Flow", type: "BASE_ASSET", aliases: ["flow"] },
  { assetId: "EGLD", name: "MultiversX", type: "BASE_ASSET", aliases: ["multiversx", "egld", "elrond"] },
  { assetId: "LUNA2", name: "Terra 2.0", type: "BASE_ASSET", aliases: ["terra", "luna"] },
  { assetId: "KSM", name: "Kusama", type: "BASE_ASSET", aliases: ["kusama", "ksm"] },
  { assetId: "MINA", name: "Mina", type: "BASE_ASSET", aliases: ["mina"] },
  { assetId: "MOVR", name: "Moonriver", type: "BASE_ASSET", aliases: ["moonriver", "movr"] },
  { assetId: "GLMR", name: "Moonbeam", type: "BASE_ASSET", aliases: ["moonbeam", "glmr"] },
  { assetId: "ZEC", name: "Zcash", type: "BASE_ASSET", aliases: ["zcash", "zec"] },
  { assetId: "DASH", name: "Dash", type: "BASE_ASSET", aliases: ["dash"] },
];

/** Fireblocks-supported EVM L2/Sidechain networks */
export const FIREBLOCKS_EVM_NETWORKS: ReadonlyArray<{
  assetId: string;
  name: string;
  aliases: string[];
}> = [
  { assetId: "ETH-MATIC", name: "Polygon PoS", aliases: ["polygon", "matic"] },
  { assetId: "ETH-ARBITRUM", name: "Arbitrum One", aliases: ["arbitrum", "arb"] },
  { assetId: "ETH-OPT", name: "Optimism", aliases: ["optimism", "op"] },
  { assetId: "BASECHAIN_ETH", name: "Base", aliases: ["base"] },
  { assetId: "AVAXCCHAIN", name: "Avalanche C-Chain", aliases: ["avalanche", "avax c-chain"] },
  { assetId: "BNB_BSC", name: "BNB Smart Chain", aliases: ["bsc", "bnb", "binance smart chain"] },
  { assetId: "FTM_FANTOM", name: "Fantom Opera", aliases: ["fantom"] },
  { assetId: "CELO_ALT", name: "Celo", aliases: ["celo"] },
  { assetId: "GLMR_GLMR", name: "Moonbeam", aliases: ["moonbeam"] },
  { assetId: "MOVR_MOVR", name: "Moonriver", aliases: ["moonriver"] },
  { assetId: "ETH-ZKSYNC", name: "zkSync Era", aliases: ["zksync", "zksync era"] },
  { assetId: "ETH-STARKNET", name: "StarkNet", aliases: ["starknet"] },
  { assetId: "LINEA_ETH", name: "Linea", aliases: ["linea"] },
  { assetId: "SCROLL_ETH", name: "Scroll", aliases: ["scroll"] },
  { assetId: "MANTLE_ETH", name: "Mantle", aliases: ["mantle"] },
  { assetId: "BLAST_ETH", name: "Blast", aliases: ["blast"] },
];

/** Well-known Fireblocks ERC-20/BEP-20/token asset IDs */
export const FIREBLOCKS_KNOWN_TOKENS: ReadonlyArray<{
  assetId: string;
  name: string;
  symbol: string;
  type: FireblocksAssetType;
  nativeAsset: string;
  aliases: string[];
}> = [
  { assetId: "USDT", name: "Tether USD", symbol: "USDT", type: "ERC20", nativeAsset: "ETH", aliases: ["tether", "usdt"] },
  { assetId: "USDC", name: "USD Coin", symbol: "USDC", type: "ERC20", nativeAsset: "ETH", aliases: ["usdc", "usd coin"] },
  { assetId: "DAI", name: "Dai", symbol: "DAI", type: "ERC20", nativeAsset: "ETH", aliases: ["dai", "makerdao"] },
  { assetId: "LINK", name: "Chainlink", symbol: "LINK", type: "ERC20", nativeAsset: "ETH", aliases: ["chainlink", "link"] },
  { assetId: "UNI", name: "Uniswap", symbol: "UNI", type: "ERC20", nativeAsset: "ETH", aliases: ["uniswap", "uni"] },
  { assetId: "AAVE", name: "Aave", symbol: "AAVE", type: "ERC20", nativeAsset: "ETH", aliases: ["aave"] },
  { assetId: "MKR", name: "Maker", symbol: "MKR", type: "ERC20", nativeAsset: "ETH", aliases: ["maker", "mkr"] },
  { assetId: "COMP", name: "Compound", symbol: "COMP", type: "ERC20", nativeAsset: "ETH", aliases: ["compound", "comp"] },
  { assetId: "CRV", name: "Curve DAO", symbol: "CRV", type: "ERC20", nativeAsset: "ETH", aliases: ["curve", "crv"] },
  { assetId: "GRT", name: "The Graph", symbol: "GRT", type: "ERC20", nativeAsset: "ETH", aliases: ["the graph", "grt"] },
  { assetId: "SNX", name: "Synthetix", symbol: "SNX", type: "ERC20", nativeAsset: "ETH", aliases: ["synthetix", "snx"] },
  { assetId: "SUSHI", name: "SushiSwap", symbol: "SUSHI", type: "ERC20", nativeAsset: "ETH", aliases: ["sushiswap", "sushi"] },
  { assetId: "YFI", name: "yearn.finance", symbol: "YFI", type: "ERC20", nativeAsset: "ETH", aliases: ["yearn", "yfi"] },
  { assetId: "SHIB", name: "Shiba Inu", symbol: "SHIB", type: "ERC20", nativeAsset: "ETH", aliases: ["shiba inu", "shib"] },
  { assetId: "WBTC", name: "Wrapped Bitcoin", symbol: "WBTC", type: "ERC20", nativeAsset: "ETH", aliases: ["wrapped bitcoin", "wbtc"] },
  { assetId: "STETH", name: "Lido Staked ETH", symbol: "stETH", type: "ERC20", nativeAsset: "ETH", aliases: ["lido", "steth", "staked eth"] },
  { assetId: "WSTETH", name: "Wrapped stETH", symbol: "wstETH", type: "ERC20", nativeAsset: "ETH", aliases: ["wsteth", "wrapped steth"] },
  { assetId: "RETH", name: "Rocket Pool ETH", symbol: "rETH", type: "ERC20", nativeAsset: "ETH", aliases: ["reth", "rocket pool"] },
  { assetId: "PYUSD", name: "PayPal USD", symbol: "PYUSD", type: "ERC20", nativeAsset: "ETH", aliases: ["pyusd", "paypal usd"] },
  { assetId: "MATIC_POLYGON", name: "MATIC (on Polygon)", symbol: "MATIC", type: "ERC20", nativeAsset: "ETH", aliases: [] },
  { assetId: "ARB", name: "Arbitrum", symbol: "ARB", type: "ERC20", nativeAsset: "ETH", aliases: ["arbitrum", "arb"] },
  { assetId: "OP", name: "Optimism", symbol: "OP", type: "ERC20", nativeAsset: "ETH", aliases: ["optimism", "op"] },
  { assetId: "LDO", name: "Lido DAO", symbol: "LDO", type: "ERC20", nativeAsset: "ETH", aliases: ["lido dao", "ldo"] },
  { assetId: "ENS", name: "Ethereum Name Service", symbol: "ENS", type: "ERC20", nativeAsset: "ETH", aliases: ["ens"] },
  { assetId: "RNDR", name: "Render", symbol: "RNDR", type: "ERC20", nativeAsset: "ETH", aliases: ["render", "rndr"] },
  { assetId: "FET", name: "Fetch.ai", symbol: "FET", type: "ERC20", nativeAsset: "ETH", aliases: ["fetch", "fet"] },
  { assetId: "GNO", name: "Gnosis", symbol: "GNO", type: "ERC20", nativeAsset: "ETH", aliases: ["gnosis", "gno"] },
  { assetId: "PEPE", name: "Pepe", symbol: "PEPE", type: "ERC20", nativeAsset: "ETH", aliases: ["pepe"] },
  { assetId: "RPL", name: "Rocket Pool", symbol: "RPL", type: "ERC20", nativeAsset: "ETH", aliases: ["rocket pool", "rpl"] },
  { assetId: "SAND", name: "The Sandbox", symbol: "SAND", type: "ERC20", nativeAsset: "ETH", aliases: ["sandbox", "sand"] },
  { assetId: "MANA", name: "Decentraland", symbol: "MANA", type: "ERC20", nativeAsset: "ETH", aliases: ["decentraland", "mana"] },
  { assetId: "AXS", name: "Axie Infinity", symbol: "AXS", type: "ERC20", nativeAsset: "ETH", aliases: ["axie", "axs"] },
  { assetId: "APE", name: "ApeCoin", symbol: "APE", type: "ERC20", nativeAsset: "ETH", aliases: ["apecoin", "ape"] },
  // BEP-20 tokens (BNB Smart Chain)
  { assetId: "BUSD_BSC", name: "BUSD (BNB Chain)", symbol: "BUSD", type: "BEP20", nativeAsset: "BNB_BSC", aliases: ["busd"] },
  { assetId: "USDT_BSC", name: "USDT (BNB Chain)", symbol: "USDT", type: "BEP20", nativeAsset: "BNB_BSC", aliases: [] },
  { assetId: "USDC_BSC", name: "USDC (BNB Chain)", symbol: "USDC", type: "BEP20", nativeAsset: "BNB_BSC", aliases: [] },
  // Tron TRC-20 tokens
  { assetId: "USDT_TRX", name: "USDT (Tron)", symbol: "USDT", type: "TRON_TRC20", nativeAsset: "TRX", aliases: [] },
  { assetId: "USDC_TRX", name: "USDC (Tron)", symbol: "USDC", type: "TRON_TRC20", nativeAsset: "TRX", aliases: [] },
  // Solana SPL tokens
  { assetId: "USDC_SOL", name: "USDC (Solana)", symbol: "USDC", type: "SOL_ASSET", nativeAsset: "SOL", aliases: [] },
  { assetId: "USDT_SOL", name: "USDT (Solana)", symbol: "USDT", type: "SOL_ASSET", nativeAsset: "SOL", aliases: [] },
];

// ---------------------------------------------------------------------------
// Lookup Functions
// ---------------------------------------------------------------------------

/**
 * Determine Ledger Enterprise support status for a given token.
 *
 * Uses the Ledger Enterprise "Currencies and Tokens" API reference
 * (GET /currencies, GET /currencies/tokens) to determine support:
 *
 * - "supported": Native chain asset on a supported network, or ERC-20 token
 * - "partial": Token standard supported (e.g. TRC-20) but may need confirmation
 * - "not_supported": Network not in Ledger Enterprise's 15 supported chains
 * - "unknown": Cannot determine from available data
 */
export function checkLedgerSupport(
  symbol: string,
  network: string,
  tokenType: string,
): VendorSupportStatus {
  const symLower = symbol.toLowerCase();
  const netLower = network.toLowerCase();
  const typeLower = tokenType.toLowerCase();

  // Check if it's a native asset on a supported network
  for (const chain of LEDGER_ENTERPRISE_NETWORKS) {
    if (chain.symbol.toLowerCase() === symLower || chain.aliases.includes(symLower)) {
      return "supported";
    }
  }

  // Check if the network is supported
  const networkSupported = LEDGER_ENTERPRISE_NETWORKS.some(
    (chain) =>
      chain.symbol.toLowerCase() === netLower ||
      chain.aliases.includes(netLower) ||
      chain.name.toLowerCase() === netLower,
  );

  if (networkSupported) {
    // ERC-20 tokens on Ethereum are always supported
    if (typeLower === "erc20" || netLower === "ethereum" || netLower === "eth") {
      return "supported";
    }
    // TRC-20 on Tron
    if ((typeLower === "trc20" || netLower === "tron" || netLower === "trx") && typeLower !== "native") {
      return "supported";
    }
    // SPL tokens on Solana — partial (Ed25519 only, no PDAs)
    if (typeLower === "spl" || netLower === "solana" || netLower === "sol") {
      return "partial";
    }
    // Other tokens on supported networks
    return "partial";
  }

  // Check for known unsupported but popular networks
  const unsupportedNetworks = [
    "avalanche", "avax", "algorand", "algo", "near", "fantom", "ftm",
    "hedera", "hbar", "aptos", "apt", "sui", "sei", "arbitrum", "arb",
    "optimism", "op", "zksync", "starknet", "bsc", "bnb",
  ];
  if (unsupportedNetworks.includes(netLower)) {
    return "not_supported";
  }

  return "unknown";
}

/**
 * Determine Fireblocks support status for a given token.
 *
 * Uses the Fireblocks "List Supported Assets" API reference
 * (GET /v1/supported_assets, GET /assets) to determine support:
 *
 * - "supported": Known base asset or well-known token in Fireblocks
 * - "partial": On a supported network but specific token not in known list
 *   (Fireblocks supports custom token addition on supported networks)
 * - "not_supported": Network not supported by Fireblocks
 * - "unknown": Cannot determine from available data
 */
export function checkFireblocksSupport(
  symbol: string,
  network: string,
  tokenType: string,
): VendorSupportStatus {
  const symLower = symbol.toLowerCase();
  const netLower = network.toLowerCase();

  // Check base assets
  for (const asset of FIREBLOCKS_BASE_ASSETS) {
    if (
      asset.assetId.toLowerCase() === symLower ||
      asset.aliases.includes(symLower)
    ) {
      return "supported";
    }
  }

  // Check known tokens
  for (const token of FIREBLOCKS_KNOWN_TOKENS) {
    if (
      token.symbol.toLowerCase() === symLower ||
      token.assetId.toLowerCase() === symLower ||
      token.aliases.includes(symLower)
    ) {
      return "supported";
    }
  }

  // Check if network is supported (EVM chains, L2s)
  const networkSupported =
    FIREBLOCKS_BASE_ASSETS.some(
      (a) => a.aliases.includes(netLower) || a.assetId.toLowerCase() === netLower,
    ) ||
    FIREBLOCKS_EVM_NETWORKS.some(
      (n) => n.aliases.includes(netLower) || n.assetId.toLowerCase() === netLower,
    );

  if (networkSupported) {
    // Fireblocks supports adding custom tokens on supported networks
    return "partial";
  }

  return "unknown";
}

/**
 * Auto-detect vendor support for all vendors given a token's details.
 * Returns an object with support status for each vendor.
 */
export function detectVendorSupport(
  symbol: string,
  network: string,
  tokenType: string,
): {
  fireblocksSupport: VendorSupportStatus;
  ledgerSupport: VendorSupportStatus;
} {
  return {
    fireblocksSupport: checkFireblocksSupport(symbol, network, tokenType),
    ledgerSupport: checkLedgerSupport(symbol, network, tokenType),
  };
}

/**
 * Get a human-readable note about vendor support considerations.
 * Useful for populating vendorNotes in the token review.
 */
export function getVendorNotes(
  symbol: string,
  network: string,
  tokenType: string,
): Record<string, string> {
  const notes: Record<string, string> = {};
  const netLower = network.toLowerCase();

  // Ledger notes
  const ledgerChain = LEDGER_ENTERPRISE_NETWORKS.find(
    (c) => c.symbol.toLowerCase() === netLower || c.aliases.includes(netLower),
  );
  if (ledgerChain?.notes) {
    notes.ledger = ledgerChain.notes;
  }

  // Ledger ERC-20 note
  if (tokenType.toLowerCase() === "erc20") {
    notes.ledger = (notes.ledger ? notes.ledger + " " : "") +
      "All ERC-20 tokens supported via Ledger Enterprise API (GET /currencies/tokens).";
  }

  // Fireblocks notes
  const fbBase = FIREBLOCKS_BASE_ASSETS.find(
    (a) => a.aliases.includes(symbol.toLowerCase()) || a.assetId.toLowerCase() === symbol.toLowerCase(),
  );
  if (fbBase?.testnetId) {
    notes.fireblocks = `Testnet asset ID: ${fbBase.testnetId}. Use GET /v1/supported_assets to verify workspace availability.`;
  }

  const fbToken = FIREBLOCKS_KNOWN_TOKENS.find(
    (t) => t.symbol.toLowerCase() === symbol.toLowerCase() || t.assetId.toLowerCase() === symbol.toLowerCase(),
  );
  if (fbToken) {
    notes.fireblocks = `Fireblocks asset ID: ${fbToken.assetId} (type: ${fbToken.type}, native: ${fbToken.nativeAsset}).`;
  }

  // Check for multi-chain stablecoin deployment
  if (["usdt", "usdc"].includes(symbol.toLowerCase())) {
    const chains = FIREBLOCKS_KNOWN_TOKENS
      .filter((t) => t.symbol.toLowerCase() === symbol.toLowerCase())
      .map((t) => t.nativeAsset);
    if (chains.length > 1) {
      notes.fireblocks = (notes.fireblocks ? notes.fireblocks + " " : "") +
        `Multi-chain: available on ${chains.join(", ")} via Fireblocks.`;
    }
  }

  return notes;
}
