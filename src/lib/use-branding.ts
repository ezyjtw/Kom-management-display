"use client";

import { useState, useEffect } from "react";

export interface BrandingData {
  appName: string;
  subtitle: string;
  logoData: string;
}

const DEFAULT_BRANDING: BrandingData = {
  appName: "KOMmand Centre",
  subtitle: "Ops Management & Comms Hub",
  logoData: "",
};

let cachedBranding: BrandingData | null = null;
let fetchPromise: Promise<BrandingData> | null = null;

function fetchBranding(): Promise<BrandingData> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch("/api/branding")
    .then((r) => r.json())
    .then((json) => {
      if (json.success && json.data) {
        cachedBranding = {
          appName: json.data.appName || DEFAULT_BRANDING.appName,
          subtitle: json.data.subtitle || DEFAULT_BRANDING.subtitle,
          logoData: json.data.logoData || "",
        };
      } else {
        cachedBranding = DEFAULT_BRANDING;
      }
      return cachedBranding;
    })
    .catch(() => {
      cachedBranding = DEFAULT_BRANDING;
      return cachedBranding;
    });
  return fetchPromise;
}

/**
 * Hook to get the current branding config.
 * Fetches once and caches across all components.
 */
export function useBranding() {
  const [branding, setBranding] = useState<BrandingData>(cachedBranding || DEFAULT_BRANDING);

  useEffect(() => {
    if (cachedBranding) {
      setBranding(cachedBranding);
      return;
    }
    fetchBranding().then(setBranding);
  }, []);

  const refresh = () => {
    fetchPromise = null;
    cachedBranding = null;
    fetchBranding().then(setBranding);
  };

  return { branding, refresh };
}
