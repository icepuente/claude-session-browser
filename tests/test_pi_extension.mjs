import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import csbBuddy from "../integrations/pi/csb-buddy.ts";

let directory, handlers, originalDirectory, originalChild;
const ctx = (provider = "claude-bridge", mode = "tui") => ({ model: { provider }, mode });
const signal = () => join(process.env.CSB_PI_BUDDY_DIR, `${process.pid}.json`);
const emit = (event, data = {}, context = ctx()) => handlers.get(event)?.(data, context);
const load = () => csbBuddy({ on: (event, handler) => handlers.set(event, handler) });

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "csb-pi-test-"));
  originalDirectory = process.env.CSB_PI_BUDDY_DIR;
  originalChild = process.env.PI_SUBAGENT_CHILD;
  process.env.CSB_PI_BUDDY_DIR = join(directory, "signals");
  delete process.env.PI_SUBAGENT_CHILD;
  handlers = new Map();
});

afterEach(() => {
  emit("session_shutdown");
  if (originalDirectory === undefined) delete process.env.CSB_PI_BUDDY_DIR;
  else process.env.CSB_PI_BUDDY_DIR = originalDirectory;
  if (originalChild === undefined) delete process.env.PI_SUBAGENT_CHILD;
  else process.env.PI_SUBAGENT_CHILD = originalChild;
  rmSync(directory, { recursive: true, force: true });
});

test("loading extensions without starting a session creates no signal", () => {
  load();
  emit("model_select", { model: { provider: "claude-bridge" } });
  assert.equal(existsSync(signal()), false);
});

test("bridge session publishes only presence metadata and refreshes while idle", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 100_000 });
  load();
  emit("session_start");
  assert.deepEqual(JSON.parse(readFileSync(signal(), "utf8")), {
    version: 1, pid: process.pid, provider: "claude-bridge", updated_at: 100,
  });
  t.mock.timers.tick(5_000);
  assert.equal(JSON.parse(readFileSync(signal(), "utf8")).updated_at, 105);
  assert.equal(existsSync(`${signal()}.tmp`), false);
});

test("switching provider removes the signal and stops heartbeats", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  load();
  emit("session_start");
  emit("model_select", { model: { provider: "openai" } });
  assert.equal(existsSync(signal()), false);
  t.mock.timers.tick(20_000);
  assert.equal(existsSync(signal()), false);
  emit("model_select", { model: { provider: "claude-bridge" } });
  assert.equal(existsSync(signal()), true);
});

test("a non-bridge session does not show until switched to bridge", () => {
  load();
  emit("session_start", {}, ctx("anthropic"));
  assert.equal(existsSync(signal()), false);
  emit("model_select", { model: { provider: "claude-bridge" } });
  assert.equal(existsSync(signal()), true);
});

test("shutdown cleans up and can be called more than once", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const listeners = process.listenerCount("exit");
  load();
  emit("session_start");
  emit("session_shutdown");
  emit("session_shutdown");
  t.mock.timers.tick(20_000);
  assert.equal(existsSync(signal()), false);
  assert.equal(process.listenerCount("exit"), listeners);
});

test("session restarts replace the old heartbeat and exit listener", () => {
  const listeners = process.listenerCount("exit");
  load();
  emit("session_start");
  emit("session_start", {}, ctx("openai"));
  assert.equal(existsSync(signal()), false);
  assert.equal(process.listenerCount("exit"), listeners + 1);
  emit("session_start");
  assert.equal(existsSync(signal()), true);
  assert.equal(process.listenerCount("exit"), listeners + 1);
});

test("RPC sessions are supported", () => {
  load();
  emit("session_start", {}, ctx("claude-bridge", "rpc"));
  assert.equal(existsSync(signal()), true);
});

test("print-mode jobs do not publish", () => {
  load();
  emit("session_start", {}, ctx("claude-bridge", "print"));
  emit("model_select", { model: { provider: "claude-bridge" } });
  assert.equal(existsSync(signal()), false);
});

test("subagent processes do not install event handlers", () => {
  process.env.PI_SUBAGENT_CHILD = "1";
  load();
  assert.equal(handlers.size, 0);
  assert.equal(existsSync(signal()), false);
});

test("unwritable signal directory never interrupts Pi", () => {
  writeFileSync(process.env.CSB_PI_BUDDY_DIR, "not a directory");
  load();
  assert.doesNotThrow(() => emit("session_start"));
  assert.doesNotThrow(() => emit("session_shutdown"));
});
