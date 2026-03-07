"use client";

import { useState, useEffect, useCallback } from "react";

interface UseApiDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch data from an API endpoint following the { success, data, error } convention.
 * Handles loading state, error surfacing, and provides a refetch function.
 *
 * @param url - API endpoint URL (e.g. "/api/tokens")
 * @param deps - Optional dependency array to trigger re-fetches (default: [])
 */
export function useApiData<T = unknown>(url: string | null, deps: unknown[] = []): UseApiDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!url) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || `Request failed (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — check your connection");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, ...deps]);

  return { data, loading, error, refetch };
}
