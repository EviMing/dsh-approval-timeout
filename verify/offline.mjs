// Offline harness for ../client.js
// Exercises the auto-reject path without a browser: fake window/locale/slots/uiSession,
// controlled timers, a fake PendingApproval that records answer() calls, and a mini React
// that models useState/useEffect re-renders so picker regressions are caught.
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

// --- mini react ------------------------------------------------------------
// Hook order is a single list, like React; setState re-renders the instance
// synchronously (which is what a user click does inside an event handler).
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState(init) {
    const inst = currentInstance;
    const index = hookIndex++;
    if (!(index in inst.hooks)) inst.hooks[index] = typeof init === 'function' ? init() : init;
    const set = (next) => {
      const value = typeof next === 'function' ? next(inst.hooks[index]) : next;
      if (Object.is(value, inst.hooks[index])) return;
      inst.hooks[index] = value;
      renderInstance(inst);
    };
    return [inst.hooks[index], set];
  },
  useEffect(effect) {
    const inst = currentInstance;
    const index = hookIndex++;
    if (inst.ran[index]) return;
    inst.ran[index] = true;
    inst.cleanups[index] = effect();
  },
};

let currentInstance = null;
let hookIndex = 0;

function renderInstance(inst) {
  const previous = currentInstance;
  const previousIndex = hookIndex;
  currentInstance = inst;
  hookIndex = 0;
  try {
    inst.tree = inst.component(inst.props);
    return inst.tree;
  } finally {
    currentInstance = previous;
    hookIndex = previousIndex;
  }
}

// --- fake pending approval -------------------------------------------------
const sessionId = 'session-1';
let pendingSnapshot = new Map();
const statusListeners = new Set();
const answered = [];

function makePending(key) {
  return {
    sessionId,
    kind: 'approval',
    key,
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
}

let pending = makePending('approval:1');
function showPending(approval) {
  pending = approval;
  pendingSnapshot = new Map([[sessionId, { running: true, pendingInteraction: approval, completionUnread: false }]]);
  for (const listener of [...statusListeners]) listener();
}

showPending(pending);

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
ok(definition.id === '@local/approval-timeout', 'module id');
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

const instance = { component: captured.Component, props: { sessionId }, hooks: [], ran: [], cleanups: [], tree: undefined };
const mount = () => renderInstance(instance);
const picker = () => {
  const found = [];
  const walk = (node) => {
    if (node === undefined || node === null || typeof node !== 'object') return;
    if (node.type === 'select') found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(instance.tree);
  ok(found.length === 1, `expected one picker, got ${found.length}`);
  return found[0];
};
const chip = () => {
  const found = [];
  const walk = (node) => {
    if (node === undefined || node === null || typeof node !== 'object') return;
    if (node.type === 'span') found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(instance.tree);
  return found[0].children[0];
};

mount();

// The pending approval was picked up and a timer was scheduled for the default 10 minutes.
ok(timers.length === 1, `expected one timer, got ${timers.length}`);
ok(Math.abs(timers[0].ms - 10 * 60 * 1000) < 1500, `default delay was ${timers[0].ms}`);
ok(picker().props.value === '10', `default picker value ${picker().props.value}`);
ok(picker().children[0].length === 8, `expected 8 choices, got ${picker().children[0].length}`);

// A pending approval in this session turns the chip into a countdown.
ok(/^bash：\d+:\d\d 后自动拒绝$/.test(chip()), `countdown text was ${JSON.stringify(chip())}`);

// Choosing a new timeout must persist, reschedule from the original start, AND re-render
// the picker (regression: the picker used to snap back to the previous value).
timers = [];
picker().props.onChange({ target: { value: '30' } });
ok(localStorage.getItem('dsh.approval-timeout.minutes') === '30', 'persisted choice');
ok(timers.length === 1, `rescheduled once, got ${timers.length}`);
ok(Math.abs(timers[0].ms - 30 * 60 * 1000) < 1500, `30 minute delay was ${timers[0].ms}`);
ok(picker().props.value === '30', `picker must follow the choice, got ${picker().props.value}`);
ok(/^bash：\d+:\d\d 后自动拒绝$/.test(chip()), `countdown after change was ${JSON.stringify(chip())}`);

// A later change also sticks.
timers = [];
picker().props.onChange({ target: { value: '1' } });
ok(timers.length === 1, 'rescheduled once for 1 minute');
ok(Math.abs(timers[0].ms - 60 * 1000) < 1500, `1 minute delay was ${timers[0].ms}`);
ok(picker().props.value === '1', `picker must follow the second choice, got ${picker().props.value}`);

// Firing the deadline answers the pending approval with `rejected`, exactly like a click.
ok(answered.length === 0, 'nothing answered yet');
timers[0].fn();
await new Promise((resolve) => realSetTimeout(resolve, 0));
deepStrictEqual(answered, ['rejected']);

// The ticker stops once nothing is pending.
ok(intervals.length === 0, `ticker should be stopped, got ${intervals.length}`);

// Idle: the picker keeps the chosen value and reports it back to the UI.
picker().props.onChange({ target: { value: '15' } });
ok(picker().props.value === '15', `idle picker must follow the choice, got ${picker().props.value}`);
ok(localStorage.getItem('dsh.approval-timeout.minutes') === '15', 'idle choice persisted');

// "Off" (0) leaves a pending approval alone.
answered.length = 0;
timers = [];
const second = makePending('approval:2');
showPending(second);
ok(timers.length === 1, `15-minute timer expected for the new approval, got ${timers.length}`);
ok(Math.abs(timers[0].ms - 15 * 60 * 1000) < 1500, `new approval delay was ${timers[0].ms}`);
ok(picker().props.value === '15', `start value ${picker().props.value}`);
picker().props.onChange({ target: { value: '0' } });
ok(localStorage.getItem('dsh.approval-timeout.minutes') === '0', 'off persisted');
ok(picker().props.value === '0', `off must be shown, got ${picker().props.value}`);
ok(timers.length === 0, 'no timer while off, got ' + timers.length);
ok(answered.length === 0, 'off must not answer anything');
ok(errors.length === 0, `no internal errors expected, got: ${errors.join(' | ')}`);

console.error = realConsoleError;
console.log('offline harness passed: 10-minute default, countdown render, picker follows every choice (idle and pending), 1-minute reschedule, auto-reject via answer("rejected"), off = untouched');
