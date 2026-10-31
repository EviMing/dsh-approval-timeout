// Offline harness for ../client.js
// Exercises the auto-reject path without a browser: fake window/locale/slots/uiSession,
// controlled timers, and a fake PendingApproval that records answer() calls.
// Run with: node verify/offline.mjs
import { readFileSync } from 'node:fs';
import { deepStrictEqual, ok } from 'node:assert';

const SOURCE = new URL('../client.js', import.meta.url);

// --- fake timers -----------------------------------------------------------
const realSetTimeout = globalThis.setTimeout;
let timers = [];
let intervals = [];
globalThis.setTimeout = (fn, ms) => {
  const record = { fn, ms, cleared: false };
  timers.push(record);
  return record;
};
globalThis.clearTimeout = (record) => {
  if (record) record.cleared = true;
  timers = timers.filter((t) => t !== record);
};
globalThis.setInterval = (fn, ms) => {
  const record = { fn, ms };
  intervals.push(record);
  return record;
};
globalThis.clearInterval = (record) => {
  intervals = intervals.filter((i) => i !== record);
};

// --- fake browser ----------------------------------------------------------
const storage = new Map();
const localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
};
let definition;
globalThis.window = {
  __ModuleLoader__: { load: (def) => { definition = def; } },
  localStorage,
};

// --- fake react ------------------------------------------------------------
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
};

// --- fake pending approval -------------------------------------------------
const sessionId = 'session-1';
let pendingSnapshot = new Map();
const statusListeners = new Set();
const answered = [];

const pending = {
  sessionId,
  kind: 'approval',
  key: 'approval:1',
  toolName: 'bash',
  callId: 'call-1',
  answerable: true,
  answer(outcome) {
    answered.push(outcome);
    this.answerable = false;
    pendingSnapshot = new Map();
    for (const listener of [...statusListeners]) listener();
    return Promise.resolve(outcome);
  },
};
pendingSnapshot.set(sessionId, { running: true, pendingInteraction: pending, completionUnread: false });

// --- fake client services --------------------------------------------------
let captured = undefined;
let dictionaries;
const errors = [];
const realConsoleError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); };

function template(dict, key, params) {
  const raw = dict[key];
  if (raw === undefined) return key;
  if (params === undefined) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? '' : String(params[name])));
}

const ctx = {
  uiSession: {
    sessionStatus: {
      getSnapshot: () => pendingSnapshot,
      subscribe(listener) {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
    },
  },
  locale: {
    register(namespace, dicts) {
      ok(namespace === 'approval-timeout', 'namespace');
      dictionaries = dicts;
      return () => {};
    },
    bind(namespace) {
      const dict = namespace === 'approval-timeout' ? dictionaries.zh : {};
      return (key, params) => template(dict, key, params);
    },
  },
  slots: {
    inject(owner, register) {
      ok(owner === 'conversation.composer.dock', 'slot owner');
      register();
    },
    register(options, Component) {
      captured = { options, Component };
      return () => {};
    },
  },
  effect(fn) {
    return fn();
  },
};

// --- load ------------------------------------------------------------------
new Function('window', readFileSync(SOURCE, 'utf8'))(globalThis.window);
ok(definition !== undefined, 'module loader received a definition');
ok(definition.id === 'dsh-approval-timeout', 'module id');
const clientModule = definition.factory((name) => {
  ok(name === 'react', `unexpected require: ${name}`);
  return React;
});
ok(Array.isArray(clientModule.inject), 'inject list');
clientModule.apply(ctx);

// --- assertions ------------------------------------------------------------
ok(captured !== undefined, 'dock was registered');
deepStrictEqual(
  [captured.options.name, captured.options.id, captured.options.order],
  ['conversation.composer.dock', 'approval-timeout', 30],
);

// The pending approval was picked up and a timer was scheduled for the default 10 minutes.
ok(timers.length === 1, `expected one timer, got ${timers.length}`);
ok(Math.abs(timers[0].ms - 10 * 60 * 1000) < 1500, `default delay was ${timers[0].ms}`);

// Render: idle state shows the label and the picker at the default value.
let tree = captured.Component({ sessionId });
ok(JSON.stringify(tree).includes('审批超时自动拒绝'), 'dock label rendered');
let select = tree.children[1];
ok(select.type === 'select', 'picker rendered');
ok(select.props.value === '10', `picker value ${select.props.value}`);
ok(select.children[0].length === 8, `expected 8 choices, got ${select.children[0].length}`);

// Render: a pending approval in this session turns the chip into a countdown.
tree = captured.Component({ sessionId });
const text = tree.children[0].children[0];
ok(/^bash：\d+:\d\d 后自动拒绝$/.test(text), `countdown text was ${JSON.stringify(text)}`);

// Changing the picker persists and reschedules from the original start.
timers = [];
select.props.onChange({ target: { value: '1' } });
ok(localStorage.getItem('dsh.approval-timeout.minutes') === '1', 'persisted choice');
ok(timers.length === 1, 'rescheduled once');
ok(Math.abs(timers[0].ms - 60 * 1000) < 1500, `1 minute delay was ${timers[0].ms}`);

// Firing the deadline answers the pending approval with `rejected`, exactly like a click.
ok(answered.length === 0, 'nothing answered yet');
timers[0].fn();
await new Promise((resolve) => realSetTimeout(resolve, 0));
deepStrictEqual(answered, ['rejected']);

// The ticker stops once nothing is pending.
ok(intervals.length === 0, `ticker should be stopped, got ${intervals.length}`);

// "Off" (0) leaves a pending approval alone.
answered.length = 0;
timers = [];
pending.answerable = true;
pendingSnapshot = new Map([[sessionId, { running: true, pendingInteraction: pending, completionUnread: false }]]);
select.props.onChange({ target: { value: '0' } });
ok(localStorage.getItem('dsh.approval-timeout.minutes') === '0', 'off persisted');
ok(timers.length === 0, 'no timer while off, got ' + timers.length);
ok(answered.length === 0, 'off must not answer anything');
ok(errors.length === 0, `no internal errors expected, got: ${errors.join(' | ')}`);

console.error = realConsoleError;
console.log('offline harness passed: 10-minute default, countdown render, 1-minute reschedule, auto-reject via answer("rejected"), off = untouched');
