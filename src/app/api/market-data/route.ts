import { NextResponse } from "next/server";
import { requireAuth, safeErrorMessage } from "@/lib/auth-user";

/**
 * GET /api/market-data
 *
 * Fetches crypto prices (with 24h change) and ETH gas fees from public APIs.
 * Uses CoinGecko (free, no key) for prices and a public gas tracker for fees.
 * Responses are cached for 60s via Next.js to avoid rate-limiting.
 */

// Tracked assets — must match CoinGecko IDs
const TRACKED_ASSETS: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  polkadot: "DOT",
  "usd-coin": "USDC",
  tether: "USDT",
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

export const revalidate = 60; // ISR: cache for 60s

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    const [priceData, gasData] = await Promise.all([
      fetchPrices(),
      fetchGas(),
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

    return NextResponse.json({
      success: true,
      data: {
        prices: priceData,
        gas: gasData,
        alerts,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: safeErrorMessage(error, "Market data") },
      { status: 500 },
    );
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

function getStaticFallback(): AssetPrice[] {
  // Return empty array if API is unreachable — dashboard will show "Market data unavailable"
  return [];
}
