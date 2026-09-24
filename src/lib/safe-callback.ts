/** Post-sign-in destination: same-site paths only, never a scheme-relative or absolute URL (open redirect). */
export function safeCallback(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(raw)) return fallback;
  return raw;
}
