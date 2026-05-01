// Shared TLS options for Proton Bridge local connections (SMTP + IMAP).
//
// Node 25 rejects IP literals (e.g. "127.0.0.1") as the TLS servername before
// checkServerIdentity can run. Using "localhost" keeps SNI legal. The pinned
// Bridge CA cert is the trust anchor; checkServerIdentity is bypassed because
// Bridge exports certs with CN=127.0.0.1, which would not match "localhost".
export function buildBridgeTlsOptions(cert: Buffer): Record<string, unknown> {
  return {
    ca: [cert],
    minVersion: "TLSv1.2",
    servername: "localhost",
    checkServerIdentity: () => undefined,
  };
}
