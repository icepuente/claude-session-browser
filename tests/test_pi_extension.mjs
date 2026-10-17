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
    state: "idle", activity_at: 100,
  });
  t.mock.timers.tick(5_000);
  assert.equal(JSON.parse(readFileSync(signal(), "utf8")).updated_at, 105);
  assert.equal(JSON.parse(readFileSync(signal(), "utf8")).activity_at, 100);
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

const activity = () => JSON.parse(readFileSync(signal(), "utf8")).state;
const stream = (type, extra = {}) => emit("message_update", { assistantMessageEvent: { type, ...extra } });

test("turn activity follows thinking, text and tool-call generation", () => {
  load();
  emit("session_start");
  emit("before_agent_start");
  assert.equal(activity(), "thinking");
  stream("text_delta", { delta: "private response text" });
  assert.equal(activity(), "active");
  stream("thinking_delta", { delta: "private reasoning" });
  assert.equal(activity(), "thinking");
  stream("toolcall_delta", { delta: "private tool arguments" });
  assert.equal(activity(), "active");
  assert.equal(readFileSync(signal(), "utf8").includes("private"), false);
});

test("parallel tools remain active until the last tool ends", () => {
  load();
  emit("session_start");
  emit("agent_start");
  emit("tool_execution_start", { toolCallId: "a", toolName: "write" });
  emit("tool_execution_start", { toolCallId: "b", toolName: "bash" });
  stream("thinking_delta");
  assert.equal(activity(), "active");
  emit("tool_execution_end", { toolCallId: "a", isError: false });
  assert.equal(activity(), "active");
  emit("tool_execution_end", { toolCallId: "b", isError: false });
  assert.equal(activity(), "thinking");
});

test("blocking prompts override work and restore it when dismissed", () => {
  load();
  emit("session_start");
  emit("tool_execution_start", { toolCallId: "a" });
  emit("ui_prompt_start", { kind: "confirm", title: "private prompt" });
  emit("ui_prompt_start", { kind: "input" });
  assert.equal(activity(), "awaiting_approval");
  stream("text_delta");
  emit("ui_prompt_end");
  assert.equal(activity(), "awaiting_approval");
  emit("ui_prompt_end");
  assert.equal(activity(), "active");
  assert.equal(readFileSync(signal(), "utf8").includes("private"), false);
});

test("agent_end does not claim completion before retries and settlement", () => {
  load();
  emit("session_start");
  emit("agent_start");
  stream("text_delta");
  emit("agent_end");
  assert.equal(activity(), "active");
  emit("agent_before_settle", { outcome: "completed" });
  emit("agent_settled", { aborted: false });
  assert.equal(activity(), "waiting");
});

test("errors and rate limits use distinct states and recover on a new turn", () => {
  load();
  emit("session_start");
  emit("agent_start");
  stream("error", { reason: "error", error: { errorMessage: "429 rate_limit_error secret" } });
  assert.equal(activity(), "limit");
  emit("agent_before_settle", { outcome: "error" });
  emit("agent_settled", { aborted: false });
  assert.equal(activity(), "limit");
  emit("turn_start");
  assert.equal(activity(), "thinking");
  emit("message_end", { message: { role: "assistant", stopReason: "error", errorMessage: "connection failed secret" } });
  assert.equal(activity(), "error");
  emit("agent_before_settle", { outcome: "error" });
  emit("agent_settled", { aborted: false });
  assert.equal(activity(), "error");
  assert.equal(readFileSync(signal(), "utf8").includes("secret"), false);
});

test("ordinary response text mentioning a rate limit is still writing", () => {
  load();
  emit("session_start");
  stream("text_delta", { delta: "429 rate_limit_error" });
  assert.equal(activity(), "active");
});

test("aborting a run clears pending work and returns to waiting", () => {
  load();
  emit("session_start");
  emit("agent_start");
  emit("tool_execution_start", { toolCallId: "a" });
  emit("ui_prompt_start");
  emit("agent_before_settle", { outcome: "error" });
  emit("agent_settled", { aborted: true });
  assert.equal(activity(), "waiting");
  emit("agent_start");
  assert.equal(activity(), "thinking");
});

test("tool errors can recover without leaving a permanent error state", () => {
  load();
  emit("session_start");
  emit("tool_execution_start", { toolCallId: "a" });
  emit("tool_execution_end", { toolCallId: "a", isError: true });
  assert.equal(activity(), "error");
  stream("thinking_delta");
  assert.equal(activity(), "thinking");
});

test("compaction shows thinking and exits on success or cancellation", () => {
  load();
  emit("session_start");
  emit("session_before_compact");
  assert.equal(activity(), "thinking");
  emit("session_compact");
  assert.equal(activity(), "waiting");
  emit("session_before_compact");
  emit("session_compact_failed", { aborted: true });
  assert.equal(activity(), "waiting");
  emit("agent_start");
  emit("session_before_compact");
  emit("session_compact");
  assert.equal(activity(), "thinking");
});

test("activity timestamps change with state, not heartbeats or every token", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 100_000 });
  load();
  emit("session_start");
  emit("agent_start");
  t.mock.timers.tick(1_000);
  for (let i = 0; i < 100; i++) stream("thinking_delta");
  assert.equal(JSON.parse(readFileSync(signal(), "utf8")).updated_at, 100);
  stream("text_delta");
  assert.equal(JSON.parse(readFileSync(signal(), "utf8")).activity_at, 101);
  t.mock.timers.tick(4_000);
  const data = JSON.parse(readFileSync(signal(), "utf8"));
  assert.equal(data.updated_at, 105);
  assert.equal(data.activity_at, 101);
});

test("activity from another provider does not recreate the bridge signal", () => {
  load();
  emit("session_start");
  emit("model_select", { model: { provider: "openai" } });
  emit("agent_start");
  stream("text_delta");
  emit("ui_prompt_start");
  assert.equal(existsSync(signal()), false);
});

test("reload clears stale activity and prompt state", () => {
  load();
  emit("session_start");
  emit("ui_prompt_start");
  emit("session_shutdown");
  emit("session_start");
  assert.equal(activity(), "idle");
});
