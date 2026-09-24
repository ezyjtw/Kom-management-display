export type KomainuMethod = "GET" | "POST";

export interface KomainuEndpoint {
  readonly method: KomainuMethod;
  readonly pattern: RegExp;
}

const SEG = "[A-Za-z0-9_-]+";

function ep(method: KomainuMethod, path: string): KomainuEndpoint {
  const source = path.replace(/\{[a-z_]+\}/g, SEG);
  return Object.freeze({ method, pattern: new RegExp(`^${source}$`) });
}

// Spec §8.1 allowlist. Anything not listed here is refused by the client.
export const KOMAINU_ENDPOINTS: readonly KomainuEndpoint[] = Object.freeze([
  ep("POST", "/v1/auth/token"),
  ep("GET", "/v1/requests"),
  ep("GET", "/v1/requests/{request_id}"),
  ep("GET", "/v1/custody/transactions"),
  ep("GET", "/v1/custody/transactions/{transaction_id}"),
  ep("GET", "/v1/custody/wallets"),
  ep("GET", "/v1/custody/wallets/eodbalances"),
  ep("GET", "/v1/custody/wallets/{id}"),
  ep("GET", "/v1/custody/wallets/{id}/eodbalances"),
  ep("GET", "/v1/custody/whitelists"),
  ep("GET", "/v1/custody/whitelists/{id}"),
  ep("GET", "/v1/custody/accounts"),
  ep("GET", "/v1/custody/workspaces"),
  ep("GET", "/v1/custody/assets"),
  ep("GET", "/v1/staking/ethereum/stakes"),
  ep("GET", "/v1/staking/solana/stakes"),
  ep("GET", "/v1/staking/rewards/daily"),
  ep("GET", "/v1/collateral/portfolios"),
  ep("GET", "/v1/collateral/portfolios/{id}"),
  ep("GET", "/v1/collateral/operations"),
  ep("GET", "/v1/collateral/operations/{id}"),
  ep("GET", "/v1/collateral/settlements"),
  ep("GET", "/v1/collateral/settlements/{id}"),
  ep("GET", "/v1/audit-logs"),
]);

export const AUTH_TOKEN_PATH = "/v1/auth/token";

export function isAllowedEndpoint(method: string, path: string): boolean {
  const m = method.toUpperCase();
  return KOMAINU_ENDPOINTS.some((e) => e.method === m && e.pattern.test(path));
}
