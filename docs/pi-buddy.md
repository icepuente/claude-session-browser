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

The extension writes only its PID, provider, schema version, and timestamp
to `~/.claude/csb_pi_sessions/<pid>.json` every five seconds. Session Browser
requires both a live Pi/Node/Bun process and a heartbeat at most 15 seconds
old. Its existing two-second polling cache still applies. A crashed process
is ignored on the next scan; an abandoned heartbeat expires within 15 seconds.
No prompts, transcripts, API keys, or model requests are involved.

This adds visibility detection only. It does not translate Pi activity into
buddy animations. Claude Desktop remains excluded.

For isolated tests, both components accept `CSB_PI_BUDDY_DIR`. To disable the
integration, remove the Pi extension and reload Pi. Stale files are ignored.

Validation:

```sh
python -m unittest discover -s tests -v
node --test tests/test_pi_extension.mjs
python tools/check_i18n.py
```
