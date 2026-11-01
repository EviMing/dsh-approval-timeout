# dsh-approval-timeout

Answers an unanswered approval prompt or an unanswered question in the DeepSeek Harness (dsh) Web UI after a configurable timeout — **10 minutes by default**.

中文: [README.md](README.md)

## Behavior

Harness blocks in the browser until you click. This plugin puts a deadline on both waits:

- **Approvals**: at the deadline the prompt is answered with `rejected` exactly as if you clicked **Reject** — the panel goes away, the tool call fails as rejected, and the same `approval/decided: rejected` audit event is written. It only ever rejects, never approves, so a stale prompt fails closed.
- **Questions** (`ask_user_question`): at the deadline every question is answered with an empty selection, exactly as if you pressed **Skip** — the agent receives `{ answers: [{ id, selected: [] }, ...] }`, an explicit "the user did not answer", never a fabricated reply and never an implied approval. The panel goes away and the tool returns the empty batch.
- While you are answering (panel focused, text being edited) the deadline slips by 60 seconds instead of discarding what you typed.

With nothing pending the plugin is dormant. Picking **Off** restores dsh's native behavior (wait forever).

## Install

```bash
dsh plugin --profile web add github:EviMing/dsh-approval-timeout
# or, once published to npm:
dsh plugin --profile web add dsh-approval-timeout
```

Restart / reload `dsh web`. A control appears under the composer:

```
Approval/question timeout   [10 min ▾]
```

## Use

- Pick the timeout from the menu: **Off / 1 / 3 / 5 / 10 / 15 / 30 / 60 minutes**. Takes effect immediately and is remembered.
- While an approval is pending the row turns yellow and shows a countdown, e.g. `bash: auto-reject in 9:58`.
- While a question is pending it shows `Question: auto-skip in 9:58`.
- The value lives in browser `localStorage` (`dsh.approval-timeout.minutes`) — per browser profile, no server-side config, no profile patch edits.

## What it leaves alone

It only touches requests that are still blocking the agent and whose panel is alive:

- settled, read-only question cards (they have no answer channel — answering one would inject a reply the agent never asked for);
- cards whose live channel is gone (`continued`);
- questions that already carry a client-side countdown (`ask_user_question` in its timed mode);
- **plan reviews**: their only non-approving outcome tells the agent to revise and present again, so a timeout there would loop instead of unblocking, and the plugin deliberately leaves them to dsh;
- cards the Host never named and that cannot be cancelled (dismissing them only collapses the panel).

## Why it lives in the client

The approval panel is rendered in the browser by `@deepseek-ai/dsh-client-ui-approval`, the question panel by `@deepseek-ai/dsh-client-ui-user-questions`. The host-side `approval/request` and `user-questions/request` waterfalls only forward the request to the browser and wait for the client to answer; the gateway settles solely on a client answer or on an aborted request signal. A host-side answerer that returns early would leave the panel on screen while the tool was already settled, turning a later click into a no-op.

So this plugin reads the session's `pendingInteraction` from `ctx.uiSession.sessionStatus` (the live `PendingApproval` / `PendingQuestion` instance) and calls its own methods at the deadline — `pending.answer('rejected')` for approvals, `pending.answer({ answers: [...] })` for questions, `pending.dismiss()` for cards that can only be cancelled — the exact path a click takes, so audit, panel, and tool outcome stay consistent.

## Safety

- Reject-only and skip-only; there is no code path that approves on timeout.
- No network requests, no credential access, no session events, no `document.body` writes.
- Only side effects: one `pending.answer(...)` call and one integer in `localStorage`.
- Uninstall: `dsh plugin --profile web remove dsh-approval-timeout` (or disable it in the plugins page), then reload. Nothing is left behind.

## Development

```bash
node verify/offline.mjs
```

The offline harness needs no browser: it drives `client.js` with a fake `window.__ModuleLoader__`, React, client services, a fake `PendingApproval` and a fake `PendingQuestion` that record calls, then asserts the 10-minute default, the countdown text, the reschedule on change, the approval `answer('rejected')` at the deadline, one skip batch covering several questions, that rpc/continued/timed/read-only/plan cards are left alone, the 60-second slip while editing, dismissal of an unnamed card, and that **Off** leaves everything untouched.

## Compatibility

Tested on dsh `0.2.0-rc.2` (`dsh web`) with `@deepseek-ai/dsh-client-ui-session` and
`@deepseek-ai/dsh-client-ui-approval`; the question half talks to
`@deepseek-ai/dsh-client-ui-user-questions` by duck typing, so it needs no extra injection.
A desktop build bundling an older dsh may lack `uiSession.sessionStatus`; the plugin then stays
inert rather than erroring.

## License

MIT
