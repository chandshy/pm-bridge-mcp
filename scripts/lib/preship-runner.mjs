// Sequential step runner + summary formatter for the preship gate.
//
// Each step is { name, mode, run() }:
//   mode: "hard"     — failure aborts the run with a non-zero exit
//   mode: "advisory" — failure prints a warning and the run continues
//
// run() must return { ok, summary?, output? }:
//   ok: boolean — true = step passed, false = step failed
//   summary: short single-line note shown next to the step in the table
//   output: long-form detail printed when the step fails OR when --verbose

import { styleText } from "node:util";

const CHECK = styleText(["green", "bold"], "✓");
const CROSS = styleText(["red", "bold"], "✗");
const WARN_MARK = styleText(["yellow", "bold"], "!");
const SKIP_MARK = styleText(["gray"], "○");
const HR = "─".repeat(60);

function fmtDuration(ms) {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m} m ${s.toString().padStart(2, "0")} s`;
}

export async function runSteps(steps, { header = "PRESHIP", verbose = false } = {}) {
  const results = [];
  const t0 = Date.now();
  console.log(styleText("bold", header));
  console.log(HR);
  let halted = false;
  for (const step of steps) {
    if (halted) {
      results.push({ step, status: "skipped", durationMs: 0 });
      continue;
    }
    process.stdout.write(`… ${step.name}\r`);
    const start = Date.now();
    let res;
    try {
      res = await step.run();
    } catch (e) {
      res = { ok: false, summary: e instanceof Error ? e.message : String(e), output: e?.stack ?? "" };
    }
    const durationMs = Date.now() - start;
    const status = res.ok ? "ok" : step.mode === "advisory" ? "advisory" : "fail";
    results.push({ step, status, durationMs, ...res });
    const mark = status === "ok" ? CHECK : status === "advisory" ? WARN_MARK : CROSS;
    const nameCol = step.name.padEnd(16);
    const durCol = fmtDuration(durationMs).padStart(8);
    const summary = res.summary ? "  " + styleText("gray", res.summary) : "";
    console.log(`${mark} ${nameCol} ${durCol}${summary}`);
    if (status === "fail") {
      if (res.output) console.log(styleText("gray", res.output));
      halted = true;
    } else if (status === "advisory" && (res.output || verbose)) {
      if (res.output) console.log(styleText("gray", res.output));
    } else if (verbose && res.output) {
      console.log(styleText("gray", res.output));
    }
  }
  const totalMs = Date.now() - t0;
  console.log(HR);
  const summary = formatFinal(results, totalMs);
  console.log(summary.line);
  return { results, ok: summary.ok, totalMs };
}

function formatFinal(results, totalMs) {
  const failed = results.filter((r) => r.status === "fail");
  const advisories = results.filter((r) => r.status === "advisory");
  const skipped = results.filter((r) => r.status === "skipped");
  const ok = failed.length === 0;
  let label;
  if (!ok) {
    label = styleText(["red", "bold"], "FAIL");
    const names = failed.map((r) => r.step.name).join(", ");
    label += `  — hard failure: ${names}`;
  } else {
    label = styleText(["green", "bold"], "PASS");
    if (advisories.length > 0) {
      label += ` (with ${advisories.length} advisory)`;
    }
  }
  if (skipped.length > 0) {
    label += styleText("gray", `  · ${skipped.length} skipped after halt`);
  }
  return { ok, line: `${label}  · total ${fmtDuration(totalMs)}` };
}

// ─── Standardized step builder for spawning a subprocess ─────────────────────

import { spawn } from "node:child_process";

/**
 * Run a child process and resolve a step result. Captures stdout+stderr.
 * Treats exit 0 as ok unless `successWhen` is provided.
 *
 *   spawnStep("vitest", ["run"], { mode: "hard" })
 */
export function spawnStep(cmd, args, opts = {}) {
  const { successWhen, env, cwd, summary } = opts;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...(env ?? {}) },
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => chunks.push(c));
    child.on("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf-8");
      const ok = successWhen ? successWhen({ code, output }) : code === 0;
      resolve({
        ok,
        summary: typeof summary === "function" ? summary({ code, output, ok }) : summary,
        output: ok ? undefined : output,
        exitCode: code,
      });
    });
    child.on("error", (err) => {
      resolve({ ok: false, summary: `failed to spawn: ${err.message}`, output: err.stack });
    });
  });
}

/**
 * Helper for npm-script steps: `spawnNpmRun("test")` runs `npm run test`.
 */
export function spawnNpmRun(scriptName, opts = {}) {
  return spawnStep("npm", ["run", "--silent", scriptName], opts);
}
