import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ProviderUnavailableError } from "./provider-error";

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
    // Only global unicast; reject mapped IPv4, local and transition ranges.
    return /^[23]/.test(normalized) && !normalized.startsWith("2001:0:") && !normalized.startsWith("2002:");
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
    }).catch(() => { throw new ProviderUnavailableError("Remote resource timed out or could not be reached."); });
    if (response.status === 429 || response.status >= 500) throw new ProviderUnavailableError(`Remote provider returned ${response.status}.`);
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
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Remote resource has no body.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > options.maxBytes) {
          await reader.cancel();
          throw new Error("Remote resource has an invalid size.");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    const bytes = body.buffer;
    if (!bytes.byteLength || bytes.byteLength > options.maxBytes) throw new Error("Remote resource has an invalid size.");
    return { bytes, contentType, finalUrl: url.toString() };
  }
  throw new Error("Remote resource unavailable.");
}
