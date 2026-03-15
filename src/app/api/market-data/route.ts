import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-user";
import { requireAuthorization } from "@/modules/auth/services/authorization";
import { apiSuccess, handleApiError } from "@/lib/api/response";

/**
 * GET /api/market-data
 *
 * Fetches crypto prices (with 24h change), ETH gas fees, and BTC network
 * stats (time since last block, mempool fee estimates) from public APIs.
 * Uses CoinGecko (free, no key) for prices, mempool.space for BTC data,
 * and a public gas tracker for ETH fees.
 * Responses are cached for 60s via Next.js to avoid rate-limiting.
 */

// Tracked assets — must match CoinGecko IDs (stablecoins removed — always ~$1)
const TRACKED_ASSETS: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  polkadot: "DOT",
  avalanche: "AVAX",
  chainlink: "LINK",
};

const PRICE_CHANGE_ALERT_THRESHOLD = 5; // ±5% in 24h triggers alert
const GAS_SPIKE_THRESHOLD = 50; // gwei — above this is "high"

interface AssetPrice {
  id: string;
  symbol: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  sparkline: number[];
  isAlert: boolean;
}

interface GasData {
  low: number;
  average: number;
  high: number;
  isSpike: boolean;
}

interface MarketAlert {
  type: "price_spike" | "price_drop" | "gas_spike";
  asset: string;
  message: string;
  value: number;
  severity: "warning" | "critical";
}

interface BtcNetworkData {
  lastBlockTimestamp: number; // unix seconds
  secondsSinceBlock: number;
  feeEstimates: {
    fastest: number; // sat/vB to get into next block
    halfHour: number; // ~3 blocks
    hour: number; // ~6 blocks
    economy: number; // low priority
  };
}

interface OpenInterestData {
  totalOI: number; // USD
  change24h: number; // percentage change
  btcOI: number;
  btcOIChange: number;
  ethOI: number;
  ethOIChange: number;
}

export const revalidate = 60; // ISR: cache for 60s

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const authz = requireAuthorization(auth, "metrics", "view");
  if (authz instanceof NextResponse) return authz;

  try {
    const [priceData, gasData, btcNetwork, openInterest] = await Promise.all([
      fetchPrices(),
      fetchGas(),
      fetchBtcNetwork(),
      fetchOpenInterest(),
    ]);

    // Generate market alerts
    const alerts: MarketAlert[] = [];

    for (const asset of priceData) {
      if (Math.abs(asset.change24h) >= PRICE_CHANGE_ALERT_THRESHOLD) {
        const isUp = asset.change24h > 0;
        alerts.push({
          type: isUp ? "price_spike" : "price_drop",
          asset: asset.symbol,
          message: `${asset.symbol} ${isUp ? "+" : ""}${asset.change24h.toFixed(1)}% in 24h ($${asset.price.toLocaleString()})`,
          value: asset.change24h,
          severity: Math.abs(asset.change24h) >= 10 ? "critical" : "warning",
        });
      }
    }

    if (gasData.isSpike) {
      alerts.push({
        type: "gas_spike",
        asset: "ETH",
        message: `ETH gas fees elevated: ${gasData.average} gwei avg`,
        value: gasData.average,
        severity: gasData.average >= 100 ? "critical" : "warning",
      });
    }

    return apiSuccess({
      prices: priceData,
      gas: gasData,
      btcNetwork,
      openInterest,
      alerts,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error, "market data");
  }
}

async function fetchPrices(): Promise<AssetPrice[]> {
  try {
    const ids = Object.keys(TRACKED_ASSETS).join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`,
      { next: { revalidate: 60 } },
    );

    if (!res.ok) return getStaticFallback();

    const data = await res.json();
    return data.map((coin: Record<string, unknown>) => ({
      id: coin.id as string,
      symbol: TRACKED_ASSETS[coin.id as string] || (coin.symbol as string).toUpperCase(),
      price: (coin.current_price as number) || 0,
      change24h: (coin.price_change_percentage_24h as number) || 0,
      high24h: (coin.high_24h as number) || 0,
      low24h: (coin.low_24h as number) || 0,
      sparkline: ((coin.sparkline_in_7d as Record<string, number[]>)?.price || []).slice(-24),
      isAlert: Math.abs((coin.price_change_percentage_24h as number) || 0) >= PRICE_CHANGE_ALERT_THRESHOLD,
    }));
  } catch {
    return getStaticFallback();
  }
}

async function fetchGas(): Promise<GasData> {
  try {
    // Use etherscan-compatible public API (no key needed for basic gas)
    const res = await fetch(
      "https://api.etherscan.io/api?module=gastracker&action=gasoracle",
      { next: { revalidate: 30 } },
    );

    if (!res.ok) return { low: 0, average: 0, high: 0, isSpike: false };

    const data = await res.json();
    if (data.status === "1" && data.result) {
      const low = parseFloat(data.result.SafeGasPrice) || 0;
      const average = parseFloat(data.result.ProposeGasPrice) || 0;
      const high = parseFloat(data.result.FastGasPrice) || 0;
      return { low, average, high, isSpike: average >= GAS_SPIKE_THRESHOLD };
    }

    return { low: 0, average: 0, high: 0, isSpike: false };
  } catch {
    return { low: 0, average: 0, high: 0, isSpike: false };
  }
}

async function fetchBtcNetwork(): Promise<BtcNetworkData> {
  try {
    const [blockRes, feesRes] = await Promise.all([
      fetch("https://mempool.space/api/blocks/tip/height", { next: { revalidate: 30 } }),
      fetch("https://mempool.space/api/v1/fees/recommended", { next: { revalidate: 30 } }),
    ]);

    let lastBlockTimestamp = 0;
    if (blockRes.ok) {
      // Get the latest block's timestamp
      const tipRes = await fetch("https://mempool.space/api/blocks", { next: { revalidate: 30 } });
      if (tipRes.ok) {
        const blocks = await tipRes.json();
        if (Array.isArray(blocks) && blocks.length > 0) {
          lastBlockTimestamp = blocks[0].timestamp;
        }
      }
    }

    let feeEstimates = { fastest: 0, halfHour: 0, hour: 0, economy: 0 };
    if (feesRes.ok) {
      const fees = await feesRes.json();
      feeEstimates = {
        fastest: fees.fastestFee || 0,
        halfHour: fees.halfHourFee || 0,
        hour: fees.hourFee || 0,
        economy: fees.economyFee || 0,
      };
    }

    const now = Math.floor(Date.now() / 1000);
    return {
      lastBlockTimestamp,
      secondsSinceBlock: lastBlockTimestamp > 0 ? now - lastBlockTimestamp : 0,
      feeEstimates,
    };
  } catch {
    return {
      lastBlockTimestamp: 0,
      secondsSinceBlock: 0,
      feeEstimates: { fastest: 0, halfHour: 0, hour: 0, economy: 0 },
    };
  }
}

async function fetchOpenInterest(): Promise<OpenInterestData> {
  try {
    // Use CoinGlass public API for aggregate OI data
    const res = await fetch(
      "https://open-api.coinglass.com/public/v2/open_interest?symbol=all",
      { next: { revalidate: 120 } },
    );

    if (res.ok) {
      const data = await res.json();
      if (data.code === "0" && Array.isArray(data.data)) {
        const btc = data.data.find((d: Record<string, unknown>) => d.symbol === "BTC");
        const eth = data.data.find((d: Record<string, unknown>) => d.symbol === "ETH");
        const totalOI = data.data.reduce((sum: number, d: Record<string, unknown>) => sum + ((d.openInterest as number) || 0), 0);
        const totalOIPrev = data.data.reduce((sum: number, d: Record<string, unknown>) => sum + ((d.openInterest24hPrevious as number) || 0), 0);

        return {
          totalOI,
          change24h: totalOIPrev > 0 ? ((totalOI - totalOIPrev) / totalOIPrev) * 100 : 0,
          btcOI: (btc?.openInterest as number) || 0,
          btcOIChange: (btc?.oiChange24h as number) || 0,
          ethOI: (eth?.openInterest as number) || 0,
          ethOIChange: (eth?.oiChange24h as number) || 0,
        };
      }
    }

    return getEmptyOI();
  } catch {
    return getEmptyOI();
  }
}

function getEmptyOI(): OpenInterestData {
  return { totalOI: 0, change24h: 0, btcOI: 0, btcOIChange: 0, ethOI: 0, ethOIChange: 0 };
}

function getStaticFallback(): AssetPrice[] {
  // Return empty array if API is unreachable — dashboard will show "Market data unavailable"
  return [];
}
