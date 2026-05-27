// Shared TLS options for Proton Bridge local connections (SMTP + IMAP).
//
// Node 25 rejects IP literals (e.g. "127.0.0.1") as the TLS servername before
// checkServerIdentity can run. Using "localhost" keeps SNI legal. The pinned
// Bridge CA cert is the trust anchor; checkServerIdentity is bypassed because
// Bridge exports certs with CN=127.0.0.1, which would not match "localhost".

import { readFileSync } from "fs";
import { createHash } from "crypto";
import { logger } from "../utils/logger.js";

/** SHA-256 hashes of pinned Bridge certs, keyed by absolute path.
 *  The first time we read a cert we remember its hash; subsequent reads must
 *  produce the same bytes or we refuse the connection. Closes the TOCTOU
 *  window where an attacker with write access to the cert path could swap it
 *  between the bridge cert export (verified by the user out-of-band) and a
 *  later TLS connect. */
const pinnedCertHashes = new Map<string, string>();

export function buildBridgeTlsOptions(cert: Buffer): Record<string, unknown> {
  return {
    ca: [cert],
    minVersion: "TLSv1.2",
    servername: "localhost",
    checkServerIdentity: () => undefined,
  };
}

/** Read the Bridge CA cert at `certPath`, verifying it matches the hash we
 *  pinned on first read. Throws if the bytes have changed since startup. */
export function readPinnedBridgeCert(certPath: string): Buffer {
  const buf = readFileSync(certPath);
  const hash = createHash("sha256").update(buf).digest("hex");
  const existing = pinnedCertHashes.get(certPath);
  if (existing === undefined) {
    pinnedCertHashes.set(certPath, hash);
    return buf;
  }
  if (existing !== hash) {
    logger.error(
      `Bridge CA cert at ${certPath} changed since startup (hash ${existing.slice(0, 16)}… → ${hash.slice(0, 16)}…). Refusing connection — the pinned trust anchor must remain stable for the life of the process.`,
      "BridgeTLS",
    );
    throw new Error(`Bridge cert pin violation: ${certPath} hash changed since startup`);
  }
  return buf;
}

/** Reset the pinned-hash table. Test-only. */
export function _resetBridgeCertPinsForTests(): void {
  pinnedCertHashes.clear();
}
