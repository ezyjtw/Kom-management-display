"use client";

import { useEffect, useState } from "react";
import { getProviders, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Zap, Loader2 } from "lucide-react";
import { useBranding } from "@/lib/use-branding";
import { safeCallback } from "@/lib/safe-callback";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { branding } = useBranding();
  const [providerIds, setProviderIds] = useState<string[] | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("/dashboard");
  const [reauth, setReauth] = useState(false);

  useEffect(() => {
    getProviders()
      .then((p) => setProviderIds(p ? Object.keys(p) : []))
      .catch(() => setProviderIds([]));
    const query = new URLSearchParams(window.location.search);
    setCallbackUrl(safeCallback(query.get("callbackUrl")));
    setReauth(query.get("reauth") === "1");
    if (query.get("reason") === "session_expired") setError("Your session has expired. Please sign in again.");
    const code = query.get("error");
    if (code === "AccessDenied") {
      setError("Access denied. Your account is not mapped to a KOMmand Centre role or employee record. Contact your administrator.");
    } else if (code) {
      setError("Sign-in failed. Please try again.");
    }
  }, []);

  const ssoEnabled = providerIds?.includes("azure-ad") ?? false;
  const localEnabled = providerIds?.includes("credentials") ?? false;

  // Step-up re-authentication (spec §17.3): a sensitive action needs a recent
  // sign-in, so ask Entra to prompt for credentials again, then come back.
  useEffect(() => {
    if (reauth && ssoEnabled) void signIn("azure-ad", { callbackUrl }, { prompt: "login" });
  }, [reauth, ssoEnabled, callbackUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password");
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          {branding.logoData ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoData} alt={branding.appName} className="h-16 w-16 rounded-xl mx-auto mb-4 object-contain" />
          ) : (
            <div className="inline-flex p-3 bg-primary/10 rounded-xl mb-4">
              <Zap size={32} className="text-primary" />
            </div>
          )}
          <h1 className="text-2xl font-bold text-foreground">{branding.appName}</h1>
          <p className="text-sm text-muted-foreground mt-1">{reauth ? "Sign in again to confirm it is you" : "Sign in to your ops dashboard"}</p>
        </div>

        {error && (
          <div role="alert" className="bg-red-500/10 text-red-400 text-sm px-4 py-2 rounded-lg mb-4">
            {error}
          </div>
        )}

        {ssoEnabled && (
          <button
            type="button"
            onClick={() => signIn("azure-ad", { callbackUrl }, reauth ? { prompt: "login" } : undefined)}
            className="w-full h-10 mb-4 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
          >
            Sign in with Microsoft
          </button>
        )}

        {providerIds !== null && !ssoEnabled && !localEnabled && (
          <div className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground">
            No sign-in method is configured. Set the AZURE_AD_* variables (or ALLOW_LOCAL_LOGIN=true outside production).
          </div>
        )}

        {/* Local login (non-production only) */}
        {localEnabled && (
        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl p-6 space-y-4">

          <div>
            <label htmlFor="login-email" className="text-sm font-medium text-foreground block mb-1.5">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="text-sm font-medium text-foreground block mb-1.5">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>
        )}

        {/* Dev-mode hint — no credentials exposed */}
        {localEnabled && process.env.NODE_ENV === "development" && (
          <div className="mt-6 bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">
              Development mode — use credentials from your SEED_*_PASSWORD environment variables.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
