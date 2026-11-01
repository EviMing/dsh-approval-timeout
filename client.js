window.__ModuleLoader__.load({
  id: '@local/approval-timeout',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'approval-timeout';
    const STORAGE_KEY = 'dsh.approval-timeout.minutes';
    const DEFAULT_MINUTES = 10;
    const MAX_MINUTES = 240;
    const MINUTE = 60 * 1000;
    /** While the user is answering, the deadline slips by this much instead of firing. */
    const SNOOZE_MS = 60 * 1000;
    /** Offered choices, in minutes; 0 turns the behavior off. */
    const OPTIONS = [0, 1, 3, 5, 10, 15, 30, 60];

    const zh = {
      label: '审批/提问超时',
      off: '关闭',
      minutes: '{n} 分钟',
      approvalPending: '{tool}：{time} 后自动拒绝',
      questionPending: '提问：{time} 后自动跳过',
      hint: '授权提示或提问超过该时间仍无人响应时自动处理：授权按拒绝，提问按跳过（正在作答时顺延）',
    };
    const en = {
      label: 'Approval/question timeout',
      off: 'Off',
      minutes: '{n} min',
      approvalPending: '{tool}: auto-reject in {time}',
      questionPending: 'Question: auto-skip in {time}',
      hint: 'Answers an approval with reject, and skips a question, when nobody responds in time; slips while you are answering',
    };

    /** Read the persisted timeout, falling back to the default. */
    function readMinutes() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw === null) return DEFAULT_MINUTES;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) return DEFAULT_MINUTES;
        return Math.min(MAX_MINUTES, Math.round(value));
      } catch (error) {
        console.error('[approval-timeout] could not read the stored timeout', error);
        return DEFAULT_MINUTES;
      }
    }

    /** Render a remaining duration as m:ss. */
    function formatRemaining(ms) {
      const total = Math.max(0, Math.ceil(ms / 1000));
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
    }

    const rowStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      minHeight: '20px',
      fontSize: '12px',
      lineHeight: '20px',
      color: 'var(--dsw-alias-label-secondary)',
    };
    const pendingStyle = { ...rowStyle, color: 'var(--dsw-alias-state-warn-primary)' };
    const hintStyle = { ...rowStyle, color: 'var(--dsw-alias-label-secondary)' };
    const selectStyle = {
      font: 'inherit',
      fontSize: '12px',
      lineHeight: '16px',
      padding: '2px 6px',
      borderRadius: '6px',
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-bg-layer-1)',
      border: '1px solid var(--dsw-alias-border-l1)',
      cursor: 'pointer',
    };

    /** Read a pending question's card state; older Clients may not expose one. */
    function readState(pending) {
      if (typeof pending.snapshot !== 'function') return undefined;
      try {
        const state = pending.snapshot();
        return state !== null && typeof state === 'object' ? state : undefined;
      } catch (error) {
        console.error('[approval-timeout] could not read the pending interaction state', error);
        return undefined;
      }
    }

    return {
      inject: ['uiSession', 'slots', 'locale'],
      apply(ctx) {
        let t = (key) => key;
        const uiSession = ctx.uiSession;

        let minutes = readMinutes();
        /** key -> { key, sessionId, kind, label, pending, startedAt, deadline } */
        const entries = new Map();
        /** key -> timeout handle */
        const timers = new Map();
        /** key -> answered-at; keeps a card that lingers after being answered from being re-tracked. */
        const settled = new Map();
        const listeners = new Set();
        let ticker = null;
        let revision = 0;

        function publish() {
          revision += 1;
          for (const listener of [...listeners]) {
            try {
              listener();
            } catch (error) {
              console.error('[approval-timeout] a subscriber threw', error);
            }
          }
        }

        function snapshot() {
          const now = Date.now();
          const pendings = [];
          for (const entry of entries.values()) {
            pendings.push({
              sessionId: entry.sessionId,
              kind: entry.kind,
              label: entry.label,
              remaining: Math.max(0, entry.deadline - now),
            });
          }
          return { minutes, revision, pendings };
        }

        function clearTimer(key) {
          const timer = timers.get(key);
          if (timer !== undefined) {
            clearTimeout(timer);
            timers.delete(key);
          }
        }

        function schedule(entry) {
          clearTimer(entry.key);
          if (minutes <= 0) return;
          const delay = Math.max(0, entry.deadline - Date.now());
          timers.set(entry.key, setTimeout(() => {
            timers.delete(entry.key);
            settle(entry.key);
          }, delay));
        }

        function syncTicker() {
          const needed = minutes > 0 && entries.size > 0;
          if (needed && ticker === null) {
            ticker = setInterval(() => publish(), 1000);
          } else if (!needed && ticker !== null) {
            clearInterval(ticker);
            ticker = null;
          }
        }

        /** Stop tracking one interaction without answering it. */
        function untrack(key) {
          if (!entries.delete(key)) return;
          clearTimer(key);
          syncTicker();
          publish();
        }

        /** Answer one tracked interaction, then stop tracking it. */
        function answer(key, payload) {
          const entry = entries.get(key);
          if (entry === undefined) return;
          entries.delete(key);
          clearTimer(key);
          settled.set(key, Date.now());
          syncTicker();
          const pending = entry.pending;
          if (typeof pending.answer !== 'function') {
            publish();
            return;
          }
          try {
            Promise.resolve(pending.answer(payload)).catch((error) => {
              console.error('[approval-timeout] the automatic answer was rejected', error);
            });
          } catch (error) {
            console.error('[approval-timeout] could not answer the pending interaction', error);
          }
          publish();
        }

        /** The answer batch a user gets by skipping every question in the panel. */
        function skipAll(pending) {
          const questions = Array.isArray(pending.questions) ? pending.questions : [];
          const answers = [];
          for (const question of questions) {
            if (question === undefined || question === null) continue;
            if (question.id === undefined || question.id === null) continue;
            answers.push({ id: question.id, selected: [] });
          }
          return answers.length === 0 ? undefined : { answers };
        }

        /** Deadline reached: settle the interaction the way a user's click would. */
        function settle(key) {
          const entry = entries.get(key);
          if (entry === undefined) return;
          const pending = entry.pending;

          if (entry.kind === 'approval') {
            if (pending.answerable === false) {
              untrack(key);
              return;
            }
            answer(key, 'rejected');
            return;
          }

          // Only a live waterfall request still blocks the agent. A continued or
          // dismissed card is a leftover: answering it would inject a reply the agent
          // never asked for, so drop it instead of fabricating one.
          const state = readState(pending);
          if (state === undefined || state.channel !== 'waterfall') {
            // A card the Host never named cannot be reopened from its tool call row, so
            // closing it is the only way out and ends the request; a named card stays
            // reachable from that row, so leaving it untouched loses nothing.
            if (pending.dismissal === 'cancel' && typeof pending.dismiss === 'function') {
              try {
                Promise.resolve(pending.dismiss()).catch((error) => {
                  console.error('[approval-timeout] could not cancel the pending question', error);
                });
              } catch (error) {
                console.error('[approval-timeout] could not cancel the pending question', error);
              }
            }
            untrack(key);
            return;
          }
          // Somebody is typing or holding the panel open: slip the deadline instead of
          // throwing their answer away mid-edit.
          if (state.waitState === 'focused' || state.waitState === 'editing' || state.waitState === 'waiting') {
            entry.deadline = Date.now() + SNOOZE_MS;
            schedule(entry);
            publish();
            return;
          }
          const payload = skipAll(pending);
          if (payload === undefined) {
            untrack(key);
            return;
          }
          answer(key, payload);
        }

        function trackKey(sessionId, pending, index) {
          const identity = pending.key !== undefined && pending.key !== null
            ? String(pending.key)
            : `${String(pending.toolName)}|${String(pending.callId)}|${String(index)}`;
          return `${String(sessionId)}|${identity}`;
        }

        /** Reconcile tracked interactions with the Client's live pending interactions. */
        function sync() {
          let changed = false;
          const live = new Map();
          let status;
          try {
            status = uiSession.sessionStatus.getSnapshot();
          } catch (error) {
            console.error('[approval-timeout] could not read the session status', error);
            return;
          }
          if (status instanceof Map) {
            let index = 0;
            const staleBefore = Date.now() - 10 * MINUTE;
            for (const [key, at] of settled) {
              if (at < staleBefore) settled.delete(key);
            }
            for (const [sessionId, value] of status) {
              index += 1;
              const pending = value === undefined || value === null ? undefined : value.pendingInteraction;
              if (pending === undefined || pending === null) continue;
              if (typeof pending.answer !== 'function') continue;
              let label;
              if (pending.kind === 'approval') {
                if (pending.answerable === false) continue;
                label = typeof pending.toolName === 'string' && pending.toolName !== ''
                  ? pending.toolName
                  : undefined;
              } else if (pending.kind === 'question') {
                // `review` marks a settled, read-only record card: nothing waits on it.
                if (pending.review !== undefined && pending.review !== null) continue;
                // A plan review is excluded on purpose: its only "not now" outcome tells the
                // agent to revise and present again, so a timeout there would loop instead
                // of unblocking.
                const state = readState(pending);
                if (state !== undefined) {
                  // A continued card no longer blocks anything, and a timed question
                  // already owns its own countdown — leave both to the Client.
                  if (state.state === 'continued' || state.closed === true) continue;
                  if (state.channel === 'rpc' || state.countdown !== undefined) continue;
                }
              } else {
                continue;
              }
              if (minutes <= 0) continue;
              const key = trackKey(sessionId, pending, index);
              if (settled.has(key)) continue;
              live.set(key, { key, sessionId, kind: pending.kind, label, pending });
            }
          }
          for (const key of [...entries.keys()]) {
            if (live.has(key)) continue;
            entries.delete(key);
            clearTimer(key);
            changed = true;
          }
          for (const [key, record] of live) {
            if (entries.has(key)) continue;
            const startedAt = Date.now();
            const entry = { ...record, startedAt, deadline: startedAt + minutes * MINUTE };
            entries.set(key, entry);
            schedule(entry);
            changed = true;
          }
          syncTicker();
          if (changed) publish();
        }

        function setMinutes(value) {
          const next = Number.isFinite(value)
            ? Math.min(MAX_MINUTES, Math.max(0, Math.round(value)))
            : DEFAULT_MINUTES;
          minutes = next;
          try {
            window.localStorage.setItem(STORAGE_KEY, String(next));
          } catch (error) {
            console.error('[approval-timeout] could not persist the timeout', error);
          }
          for (const entry of entries.values()) {
            entry.deadline = entry.startedAt + next * MINUTE;
            schedule(entry);
          }
          sync();
          // `sync()` only republishes when the set of tracked interactions changes, so a
          // bare timeout edit (nothing pending, or the same interaction still pending)
          // would leave every subscriber — including the picker — showing the old value.
          publish();
        }

        function useSnapshot() {
          const [value, setValue] = React.useState(() => snapshot());
          React.useEffect(() => {
            const listener = () => setValue(snapshot());
            listeners.add(listener);
            setValue(snapshot());
            return () => {
              listeners.delete(listener);
            };
          }, []);
          return value;
        }

        /** Composer dock control: current countdown plus the timeout picker. */
        function ApprovalTimeoutDock(props) {
          const state = useSnapshot();
          const sessionId = props === undefined ? undefined : props.sessionId;
          const mine = sessionId === undefined
            ? undefined
            : state.pendings.find((pending) => pending.sessionId === sessionId);
          let text = t('label');
          if (mine !== undefined) {
            const time = formatRemaining(mine.remaining);
            if (mine.kind === 'approval') {
              text = t('approvalPending', {
                tool: mine.label === undefined ? t('label') : mine.label,
                time,
              });
            } else {
              text = t('questionPending', { time });
            }
          }
          return h('div', { style: mine === undefined ? hintStyle : pendingStyle },
            h('span', { title: t('hint') }, text),
            h('select', {
              value: String(state.minutes),
              style: selectStyle,
              title: t('hint'),
              'aria-label': t('label'),
              onChange(event) {
                setMinutes(Number(event.target.value));
              },
            }, OPTIONS.map((option) => h('option', { key: String(option), value: String(option) },
              option <= 0 ? t('off') : t('minutes', { n: option })))),
          );
        }

        ctx.effect(() => {
          const disposeLocale = ctx.locale.register(NS, { zh, en });
          t = ctx.locale.bind(NS);
          const unsubscribe = uiSession.sessionStatus.subscribe(sync);
          sync();
          return () => {
            unsubscribe();
            disposeLocale();
            for (const key of [...timers.keys()]) clearTimer(key);
            if (ticker !== null) {
              clearInterval(ticker);
              ticker = null;
            }
            entries.clear();
            listeners.clear();
          };
        }, 'approval-timeout: pending interaction timers');

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'approval-timeout',
          order: 30,
          label: () => t('label'),
        }, ApprovalTimeoutDock));
      },
    };
  },
});
