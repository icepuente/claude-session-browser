# Personal Pi / claude-bridge integration

This feature lives on `personal/pi-claude-bridge-buddy` in the personal fork.
It is separate from the upstream desktop-detection PR.

Copy `integrations/pi/csb-buddy.ts` to `~/.pi/agent/extensions/csb-buddy.ts`,
then start Pi or use `/reload` in an existing session. Run the Session Browser
build from this branch with the buddy enabled and visibility set to
**Only when Claude Code is running**.

The buddy also appears while an interactive or RPC Pi session has the
`claude-bridge` provider selected, including between turns. Selecting another
provider or exiting Pi removes that session's signal. Print-mode jobs and
`PI_SUBAGENT_CHILD=1` subagents do not publish a signal.

The extension writes only its PID, provider, schema version, activity state,
and presence/activity timestamps to `~/.claude/csb_pi_sessions/<pid>.json`.
State changes are published immediately, with a heartbeat every five seconds.
Repeated streaming tokens do not each cause a file write. Session Browser
requires both a live Pi/Node/Bun process and a heartbeat at most 15 seconds
old. Its existing two-second polling cache still applies. A crashed process
is ignored on the next scan; an abandoned heartbeat expires within 15 seconds.
No prompts, transcripts, API keys, or model requests are involved.

Pi activity now selects the existing buddy animations:

| Pi activity | Buddy animation |
| --- | --- |
| Starting a turn, thinking, or compacting context | Thinking |
| Streaming text, generating tool calls, or running tools | Coding |
| Blocking confirmation, selection, or input prompt | Waiting for approval |
| Turn fully settled, or cancelled | Done / waiting |
| Failed tool or run | Surprise |
| Provider reports a rate/usage limit | Limit |
| New idle session, or prolonged inactivity | Breathing, then sleep |

Finishing one tool does not stop the working animation while another tool is
running. Dismissing a blocking prompt restores the underlying activity. A
run shows Done only after `agent_settled`, so automatic retries and queued
continuations do not look finished prematurely. Heartbeats do not reset the
idle clock: Done fades to idle after a few minutes and sleep after 15 minutes.

When Pi sessions are present, their live state takes precedence over Claude
transcript inference. With multiple Pi sessions, prompts/limits take priority,
then errors, ongoing work, and finally waiting/idle sessions; the most recent
state change breaks ties. Without a live Pi signal, native Claude detection
works as before. Claude Desktop remains excluded.

Animation changes use the existing two-second detection poll and animation
smoothing. Preview, party mode, and hover effects keep their normal overrides.
No message text, reasoning, tool arguments/results, or error messages are saved.

For isolated tests, both components accept `CSB_PI_BUDDY_DIR`. To disable the
integration, remove the Pi extension and reload Pi. Stale files are ignored.

Validation:

```sh
python -m unittest discover -s tests -v
node --test tests/test_pi_extension.mjs
python tools/check_i18n.py
```
