import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type AddressResolver = (hostname: string) => Promise<string[]>;
type SafeFetchOptions = {
  maxBytes: number;
  acceptedTypes: (contentType: string) => boolean;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  resolveAddresses?: AddressResolver;
};

function privateIpv4(value: string) {
  const octets = value.split(".").map(Number);
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] >= 224);
}

export function isPublicAddress(value: string) {
  const version = isIP(value);
  if (version === 4) return !privateIpv4(value);
  if (version === 6) {
    const normalized = value.toLowerCase();
    return normalized !== "::" && normalized !== "::1" && !normalized.startsWith("fc") && !normalized.startsWith("fd") && !normalized.startsWith("fe8") && !normalized.startsWith("fe9") && !normalized.startsWith("fea") && !normalized.startsWith("feb");
  }
  return false;
}

async function defaultResolver(hostname: string) {
  return (await lookup(hostname, { all: true })).map((entry) => entry.address);
}

export async function assertPublicHttpsUrl(value: string | URL, resolveAddresses: AddressResolver = defaultResolver) {
  const url = value instanceof URL ? value : new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Only public HTTPS URLs are permitted.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("Private hosts are not permitted.");
  const literalVersion = isIP(hostname);
  const addresses = literalVersion ? [hostname] : await resolveAddresses(hostname);
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) throw new Error("Private addresses are not permitted.");
  return url;
}

export async function fetchPublicResource(rawUrl: string | URL, options: SafeFetchOptions) {
  const fetcher = options.fetcher ?? fetch;
  const resolver = options.resolveAddresses ?? defaultResolver;
  let url = await assertPublicHttpsUrl(rawUrl, resolver);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      cache: "no-store",
      headers: options.headers,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 3) throw new Error("Too many redirects.");
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect has no location.");
      url = await assertPublicHttpsUrl(new URL(location, url), resolver);
      continue;
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (!response.ok || !options.acceptedTypes(contentType) || declaredLength > options.maxBytes) throw new Error(`Remote resource rejected (${response.status}).`);
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > options.maxBytes) throw new Error("Remote resource has an invalid size.");
    return { bytes, contentType, finalUrl: url.toString() };
  }
  throw new Error("Remote resource unavailable.");
}
