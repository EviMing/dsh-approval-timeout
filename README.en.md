# dsh-approval-timeout

Auto-rejects an unanswered approval prompt in the DeepSeek Harness (dsh) Web UI after a configurable timeout — **10 minutes by default**.

中文: [README.md](README.md)

## Behavior

- Whenever the harness needs your nod (run a command, write a file, install a plugin…), dsh shows an approval panel. This plugin starts a deadline for it.
- At the deadline the prompt is answered with `rejected` exactly as if you clicked **Reject**: the panel goes away, the tool call fails as rejected, and the same `rejected` audit event is written.
- It only ever rejects — it never auto-approves. After the deadline the request fails closed.
- With nothing pending the plugin is dormant. Picking **Off** restores dsh's native behavior (wait forever).

## Install

```bash
dsh plugin --profile web add github:EviMing/dsh-approval-timeout
# or, once published to npm:
dsh plugin --profile web add dsh-approval-timeout
```

Restart / reload `dsh web`. A control appears under the composer:

```
Approval auto-reject   [10 min ▾]
```

## Use

- Pick the timeout from the menu: **Off / 1 / 3 / 5 / 10 / 15 / 30 / 60 minutes**. Takes effect immediately and is remembered.
- While an approval is pending the row turns yellow and shows a countdown, e.g. `bash: auto-reject in 9:58`.
- The value lives in browser `localStorage` (`dsh.approval-timeout.minutes`) — per browser profile, no server-side config, no profile patch edits.

## Why it lives in the client

The approval panel is rendered in the browser by `@deepseek-ai/dsh-client-ui-approval`. The host-side `approval/request` waterfall only forwards the request to the browser and waits for the client to answer; the gateway settles solely on a client answer or on an aborted request signal. A host-side answerer that returns `'rejected'` early would leave the panel on screen while the tool was already rejected, turning a later click into a no-op.

So this plugin reads the session's `pendingInteraction` from `ctx.uiSession.sessionStatus` (the live `PendingApproval` instance) and calls its own `pending.answer('rejected')` at the deadline — the exact path a click takes, so audit, panel, and tool outcome stay consistent.

## Safety

- Reject-only; there is no code path that approves on timeout.
- No network requests, no credential access, no session events, no `document.body` writes.
- Only side effects: one `answer('rejected')` call and one integer in `localStorage`.
- Uninstall: `dsh plugin --profile web remove dsh-approval-timeout` (or disable it in the plugins page), then reload. Nothing is left behind.

## Development

```bash
node verify/offline.mjs
```

The offline harness needs no browser: it drives `client.js` with a fake `window.__ModuleLoader__`, React, client services and a fake `PendingApproval` that records calls, then asserts the 10-minute default, the countdown text, the 1-minute reschedule from the original start, a single `answer('rejected')` at the deadline, and that **Off** leaves pending approvals untouched.

## Compatibility

Tested on dsh `0.2.0-rc.2` (`dsh web`) with `@deepseek-ai/dsh-client-ui-session` and
`@deepseek-ai/dsh-client-ui-approval`. A desktop build bundling an older dsh may lack
`uiSession.sessionStatus`; the plugin then stays inert rather than erroring.

## License

MIT
