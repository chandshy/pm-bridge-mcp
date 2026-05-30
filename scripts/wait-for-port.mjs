#!/usr/bin/env node
// BUILD-018: poll a TCP host:port until it accepts a connection (or time out).
//
// `docker compose up -d` returns as soon as the container *starts*, not when
// the service inside is *ready*. Without this wait, vitest can hit a
// not-yet-listening IMAP/SMTP port on slow runners and time out. Mirrors the
// readiness loop in .github/workflows/preship.yml so local and CI behave alike.
//
//   node scripts/wait-for-port.mjs <host> <port> [retries]
//
// Exit 0 — port accepted a connection. Exit 1 — still not ready after retries.

import net from "node:net";

const [, , host = "127.0.0.1", portArg = "3143", retriesArg = "30"] = process.argv;
const port = Number(portArg);
const retries = Number(retriesArg);

function tryConnect() {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(1000);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 1; i <= retries; i++) {
  if (await tryConnect()) {
    console.log(`wait-for-port: ${host}:${port} ready after ${i} attempt(s).`);
    process.exit(0);
  }
  await sleep(1000);
}

console.error(`wait-for-port: ${host}:${port} not ready after ${retries}s.`);
process.exit(1);
