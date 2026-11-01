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

// --- fake pending question -------------------------------------------------
// Mirrors the fields `client.js` reads from a real PendingQuestion: `kind`,
// `key`, `questions`, an optional read-only `review`, and a `snapshot()` that
// reports the answer channel. `answer()` records the batch instead of settling.
const questionAnswers = [];

function makeQuestion(key, questions, options = {}) {
  return {
    sessionId,
    kind: options.kind ?? 'question',
    key,
    questions,
    callId: 'call-q',
    review: options.review,
    dismissal: options.dismissal ?? 'hide',
    channel: options.channel ?? 'waterfall',
    waitState: options.waitState ?? 'counting',
    countdown: options.countdown,
    closed: options.closed === true,
    snapshot() {
      return {
        state: this.channel === 'rpc' ? 'continued' : 'open',
        waitState: this.waitState,
        countdown: this.countdown,
        channel: this.channel,
        closed: this.closed,
      };
    },
    dismissed: 0,
    dismiss() {
      this.dismissed += 1;
      pendingSnapshot = new Map();
      for (const listener of [...statusListeners]) listener();
      return Promise.resolve();
    },
    answer(payload) {
      questionAnswers.push(payload);
      pendingSnapshot = new Map();
      for (const listener of [...statusListeners]) listener();
      return Promise.resolve(payload);
    },
  };
}


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

// --- questions -------------------------------------------------------------
// Re-enable at 5 minutes. The idle chip carries the plugin's label; the picker
// still offers every choice.
const flush = () => new Promise((resolve) => realSetTimeout(resolve, 0));
pendingSnapshot = new Map();
picker().props.onChange({ target: { value: '5' } });
ok(localStorage.getItem('dsh.approval-timeout.minutes') === '5', 'question section starts at 5 minutes');
ok(chip() === '审批/提问超时', `idle chip was ${JSON.stringify(chip())}`);

// A live question is tracked exactly like an approval.
const question = makeQuestion('question:s1:call-9', [
  { id: 'q1', question: 'Which one?', header: 'Choose' },
  { id: 'q2', question: 'Why?' },
]);
timers = [];
questionAnswers.length = 0;
showPending(question);
ok(timers.length === 1, `expected one question timer, got ${timers.length}`);
ok(Math.abs(timers[0].ms - 5 * 60 * 1000) < 1500, `question delay was ${timers[0].ms}`);
ok(/^提问：\d+:\d\d 后自动跳过$/.test(chip()), `question chip was ${JSON.stringify(chip())}`);

// Firing it sends the exact batch the panel sends when every question is skipped.
timers[0].fn();
await flush();
deepStrictEqual(
  questionAnswers,
  [{ answers: [{ id: 'q1', selected: [] }, { id: 'q2', selected: [] }] }],
  'question timeout must submit a skip batch',
);
ok(chip() === '审批/提问超时', `chip must return to idle, got ${JSON.stringify(chip())}`);
ok(intervals.length === 0, `ticker should stop, got ${intervals.length}`);

// A continued card (rpc channel) no longer blocks the agent: never answer it for the user.
timers = [];
questionAnswers.length = 0;
showPending(makeQuestion('question:s1:call-10', [{ id: 'q1', question: 'old?' }], { channel: 'rpc' }));
ok(timers.length === 0, `continued question must not be tracked, got ${timers.length}`);
ok(chip() === '审批/提问超时', 'continued question must stay idle');

// A card the Host never named has no tool-call row to reopen it: at the deadline the
// only way out is closing it, which ends the request instead of faking an answer.
timers = [];
questionAnswers.length = 0;
const unnamed = makeQuestion("question:s1:unnamed", [{ id: "q1", question: "blocked?" }], { dismissal: "cancel", channel: "none" });
showPending(unnamed);
ok(timers.length === 1, `unnamed blocking question is tracked, got ${timers.length}`);
timers[0].fn();
await flush();
ok(unnamed.dismissed === 1, `unnamed card must be cancelled, got ${unnamed.dismissed}`);
ok(questionAnswers.length === 0, "cancelling must not fake an answer");
// A timed question already owns its countdown in the Client: do not double-own it.
timers = [];
showPending(makeQuestion('question:s1:call-11', [{ id: 'q1', question: 'timed?' }], {
  countdown: { remainingMs: 60 * 1000, running: true },
}));
ok(timers.length === 0, `timed question must not be tracked, got ${timers.length}`);

// A settled review card is read-only, and a closed card is gone.
timers = [];
showPending(makeQuestion('question:s1:call-12', [{ id: 'q1', question: 'plan?' }], {
  kind: 'plan-review',
  review: { approved: false },
}));
ok(timers.length === 0, `review card must not be tracked, got ${timers.length}`);
showPending(makeQuestion('question:s1:call-13', [{ id: 'q1', question: 'gone?' }], { closed: true }));
ok(timers.length === 0, `closed card must not be tracked, got ${timers.length}`);

// Somebody editing the answer gets a one-minute slip, not a skipped question.
timers = [];
questionAnswers.length = 0;
const editing = makeQuestion('question:s1:call-14', [{ id: 'q1', question: 'type here' }], { waitState: 'editing' });
showPending(editing);
ok(timers.length === 1, `editing question is still tracked, got ${timers.length}`);
const firedWhileEditing = timers[0];
timers = [];
firedWhileEditing.fn();
ok(questionAnswers.length === 0, 'an answer being edited must not be thrown away');
ok(timers.length === 1, `expected a snoozed timer, got ${timers.length}`);
ok(Math.abs(timers[0].ms - 60 * 1000) < 1500, `snooze was ${timers[0].ms}`);
ok(/^提问：\d+:\d\d 后自动跳过$/.test(chip()), `snoozed chip was ${JSON.stringify(chip())}`);
editing.waitState = 'counting';
timers[0].fn();
await flush();
deepStrictEqual(questionAnswers, [{ answers: [{ id: 'q1', selected: [] }] }], 'skipped after the snooze');

// A plan review is deliberately left alone: its only "not now" outcome tells the
// agent to revise and present again, so timing it out would loop instead of unblock.
timers = [];
questionAnswers.length = 0;
showPending(makeQuestion('question:s1:call-15', [{ id: 'plan', question: 'Approve the plan?' }], { kind: 'plan-review' }));
ok(timers.length === 0, `plan review must not be tracked, got ${timers.length}`);
ok(questionAnswers.length === 0, 'plan review must never be answered for the user');
ok(chip() === '审批/提问超时', `plan review chip was ${JSON.stringify(chip())}`);

// Turning it off also leaves questions alone.
timers = [];
questionAnswers.length = 0;
picker().props.onChange({ target: { value: '0' } });
ok(timers.length === 0, `off must drop pending timers, got ${timers.length}`);
showPending(makeQuestion('question:s1:call-16', [{ id: 'q1', question: 'off?' }]));
ok(timers.length === 0, `off must not track questions, got ${timers.length}`);
ok(questionAnswers.length === 0, 'off must not answer a question');
ok(chip() === '审批/提问超时', 'off keeps the chip idle');

ok(errors.length === 0, `no internal errors expected, got: ${errors.join(' | ')}`);

console.error = realConsoleError;
console.log('offline harness passed: 10-minute default, approval countdown + auto-reject, multi-question skip batch, 1-minute snooze while editing, continued/timed/review/plan cards left alone, off = untouched');
