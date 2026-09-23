/**
 * Vendor portal notification parsing (spec §8.5). Vendor service desks email
 * ticket updates; each vendor needs its own parser built from redacted real
 * samples. TODO(CONFIRM-VENDOR-FORMATS): no parser is registered until those
 * samples exist, so vendor emails are stored unparsed.
 */

export interface VendorParser {
  vendor: string;
  /** Sender domains this parser accepts, lower-case. */
  senderDomains: string[];
  /** Vendor ticket key in the subject, e.g. /\bVSD-\d+\b/. */
  keyPattern: RegExp;
  /** Optional status extraction from the subject or preview. */
  statusPattern?: RegExp;
}

export const VENDOR_PARSERS: VendorParser[] = [];

export interface ParsedVendorEmail {
  vendor: string;
  vendorKey: string;
  status: string | null;
}

export function parseVendorEmail(
  msg: { fromAddress: string; subject: string; preview: string },
  parsers: readonly VendorParser[] = VENDOR_PARSERS,
): ParsedVendorEmail | null {
  const domain = msg.fromAddress.split("@")[1]?.toLowerCase() ?? "";
  const parser = parsers.find((p) => p.senderDomains.includes(domain));
  if (!parser) return null;
  const key = msg.subject.match(parser.keyPattern)?.[0];
  if (!key) return null;
  const status = parser.statusPattern ? (`${msg.subject}\n${msg.preview}`.match(parser.statusPattern)?.[1] ?? null) : null;
  return { vendor: parser.vendor, vendorKey: key, status: status?.trim() ?? null };
}
