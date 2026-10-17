/** Report interactive Pi sessions using claude-bridge to the desktop buddy. */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HEARTBEAT_MS = 5_000;

export default function csbBuddy(pi: ExtensionAPI) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;
  const directory = process.env.CSB_PI_BUDDY_DIR || join(homedir(), ".claude", "csb_pi_sessions");
  const file = join(directory, `${process.pid}.json`);
  const temporary = `${file}.tmp`;
  let sessionActive = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  function remove() {
    // An optional desktop companion must never interrupt a Pi session.
    for (const path of [file, temporary]) {
      try { rmSync(path, { force: true }); } catch { /* unavailable directory */ }
    }
  }

  function stopHeartbeat() {
    if (timer) clearInterval(timer);
    timer = undefined;
    remove();
  }

  function publish() {
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(temporary, JSON.stringify({
        version: 1,
        pid: process.pid,
        provider: "claude-bridge",
        updated_at: Date.now() / 1000,
      }), { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, file);
    } catch { /* retry on the next heartbeat; no session failure */ }
  }

  function selectProvider(provider: string | undefined) {
    stopHeartbeat();
    if (!sessionActive || provider !== "claude-bridge") return;
    publish();
    timer = setInterval(publish, HEARTBEAT_MS);
    timer.unref();
  }

  function shutdown() {
    sessionActive = false;
    stopHeartbeat();
    process.removeListener("exit", shutdown);
  }

  pi.on("session_start", (_event, ctx) => {
    shutdown();
    // Print-mode jobs and subagents should not keep a desktop pet present.
    sessionActive = ctx.mode === "tui" || ctx.mode === "rpc";
    if (!sessionActive) return;
    process.once("exit", shutdown);
    selectProvider(ctx.model?.provider);
  });
  pi.on("model_select", (event) => {
    if (sessionActive) selectProvider(event.model.provider);
  });
  pi.on("session_shutdown", shutdown);
}
