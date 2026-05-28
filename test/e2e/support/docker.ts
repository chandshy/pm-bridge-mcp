/**
 * Greenmail container lifecycle wrapper.
 *
 * Idempotent: `up()` is a no-op when the container is already running and
 * IMAP is responsive. `down()` removes the container; safe to call when the
 * container is absent.
 */

import { execSync } from "child_process";
import { createConnection } from "net";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMPOSE_FILE = join(__dirname, "..", "fixtures", "greenmail-compose.yml");
const CONTAINER = "mailpouch-e2e-greenmail";

const GREENMAIL_HOST = "127.0.0.1";
export const GREENMAIL_IMAP_PORT = 3143;
export const GREENMAIL_SMTP_PORT = 3025;

/** TCP probe — resolves true if the port accepts a connection within `timeoutMs`. */
function probeTcp(port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: GREENMAIL_HOST, port });
    const finish = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function waitForReady(port: number, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await probeTcp(port)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Greenmail port ${port} did not become ready within ${attempts * 0.5}s`);
}

/** True if the container exists and is in 'running' state. */
function isContainerRunning(): boolean {
  try {
    const out = execSync(`docker inspect -f '{{.State.Running}}' ${CONTAINER}`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out === "true";
  } catch {
    return false;
  }
}

export async function up(): Promise<void> {
  if (isContainerRunning() && (await probeTcp(GREENMAIL_IMAP_PORT))) return;
  execSync(`docker compose -f ${COMPOSE_FILE} up -d`, { stdio: "inherit" });
  await waitForReady(GREENMAIL_IMAP_PORT);
  await waitForReady(GREENMAIL_SMTP_PORT);
}

export async function down(): Promise<void> {
  try {
    execSync(`docker compose -f ${COMPOSE_FILE} down`, { stdio: "inherit" });
  } catch {
    // already down — nothing to do
  }
}

/**
 * Hard-restart Greenmail. Use in beforeAll of any scenario file that must
 * not be polluted by state left over from earlier files in the run. Vitest
 * runs e2e files serially under singleFork; this is the cleanest way to
 * guarantee a fresh UID space and empty mailbox tree.
 */
export async function restart(): Promise<void> {
  await up();
  execSync(`docker compose -f ${COMPOSE_FILE} restart`, { stdio: "inherit" });
  await waitForReady(GREENMAIL_IMAP_PORT);
  await waitForReady(GREENMAIL_SMTP_PORT);
}

/** Greenmail user provisioned in compose env. */
export const TEST_USER = {
  email: "alice@test.local",
  username: "alice",
  password: "test-password",
} as const;

/** Second Greenmail user — useful for send/receive scenarios. */
export const TEST_USER_BOB = {
  email: "bob@test.local",
  username: "bob",
  password: "test-password",
} as const;
