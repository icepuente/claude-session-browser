# Clawd for pi sessions

[pi](https://github.com/earendil-works/pi) can run Claude models through the
[claude-bridge](https://github.com/elidickinson/pi-claude-bridge) provider. Those
sessions don't write Claude Code transcripts the buddy could read, so a small pi
extension, [pi-csb-buddy](https://github.com/icepuente/pi-csb-buddy), reports
what they are doing instead.

## Setting it up

Turn on **Show pi sessions in the buddy** in the **Buddy** tab. The app runs

```sh
pi install npm:pi-csb-buddy@0.1.1
```

The version is pinned on purpose; a newer one arrives with an app update.
Turning the setting off runs `pi remove` for whichever source is installed. If
you installed pi-csb-buddy yourself (from npm or git, any version), the setting
already shows as on and nothing is installed twice. Running pi sessions pick it
up after `/reload`; new ones right away.

Without the app, the same is `pi install npm:pi-csb-buddy` by hand.

## What gets written

While an interactive or RPC pi session has `claude-bridge` selected, the
extension keeps one file per pi process in `~/.claude/csb_pi_sessions/`
(override with `CSB_PI_BUDDY_DIR`, read by both sides):

```json
{ "version": 1, "pid": 1234, "provider": "claude-bridge",
  "updated_at": 1760000000.0, "state": "active", "activity_at": 1760000000.0 }
```

It is rewritten on every state change plus a heartbeat every five seconds, and
removed when pi exits or switches to another provider. Print-mode runs and
subagents write nothing. No prompts, replies, tool arguments or error messages
are stored.

The app only counts a file while its `node.exe`/`bun.exe`/`pi.exe` process is
alive and the heartbeat is at most 15 seconds old. A crashed pi drops out on
the next scan; a file whose heartbeat stopped expires after 15 seconds. A live pi session counts like an open Claude Code
terminal for the *only while Claude Code is running* visibility and for snooze.

## States and animations

| pi state | When | Clawd |
| --- | --- | --- |
| `thinking` | Turn started, thinking, between tools, compacting | Thinking |
| `active` | Streaming text or tool calls, a tool running | Writing code |
| `awaiting_approval` | A confirmation, selection or input prompt is open | Waiting for approval |
| `waiting` | The run settled | Done, then idle after a few minutes |
| `error` | A tool or the provider failed | Surprise |
| `limit` | The provider error looks like a rate or usage limit | Out of quota |
| `idle` | Session started, nothing run yet | Breathing, asleep after 15 minutes |

Heartbeats keep a session present but don't reset its idle clock. While any pi
session is live its state wins over transcript inference. With several, prompts
and limits come first, then errors, then work, then waiting; ties go to the most
recent change. Without a live pi session the buddy works exactly as before.

pi detection uses the Windows process list, like the rest of the buddy's
detection.

## Tests

```sh
python -m unittest discover -s tests -v
python tools/check_i18n.py
```
