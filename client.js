window.__ModuleLoader__.load({
  id: 'dsh-approval-timeout',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'approval-timeout';
    const STORAGE_KEY = 'dsh.approval-timeout.minutes';
    const DEFAULT_MINUTES = 10;
    const MAX_MINUTES = 240;
    const MINUTE = 60 * 1000;
    /** Offered choices, in minutes; 0 turns the behavior off. */
    const OPTIONS = [0, 1, 3, 5, 10, 15, 30, 60];

    const zh = {
      label: '审批超时自动拒绝',
      off: '关闭',
      minutes: '{n} 分钟',
      pending: '{tool}：{time} 后自动拒绝',
      hint: '授权提示超过该时间仍未响应时自动拒绝',
    };
    const en = {
      label: 'Approval auto-reject',
      off: 'Off',
      minutes: '{n} min',
      pending: '{tool}: auto-reject in {time}',
      hint: 'Rejects an approval prompt left unanswered for this long',
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

    return {
      inject: ['uiSession', 'slots', 'locale'],
      apply(ctx) {
        let t = (key) => key;
        const uiSession = ctx.uiSession;

        let minutes = readMinutes();
        /** key -> { key, sessionId, toolName, pending, startedAt, deadline } */
        const entries = new Map();
        /** key -> timeout handle */
        const timers = new Map();
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
              toolName: entry.toolName,
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
            reject(entry.key);
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

        /** Answer one tracked pending approval with `rejected`. */
        function reject(key) {
          const entry = entries.get(key);
          if (entry === undefined) return;
          entries.delete(key);
          clearTimer(key);
          syncTicker();
          const pending = entry.pending;
          if (pending.answerable === false || typeof pending.answer !== 'function') {
            publish();
            return;
          }
          try {
            Promise.resolve(pending.answer('rejected')).catch((error) => {
              console.error('[approval-timeout] the auto-reject answer was rejected', error);
            });
          } catch (error) {
            console.error('[approval-timeout] could not answer the pending approval', error);
          }
          publish();
        }

        function trackKey(sessionId, pending, index) {
          const identity = pending.key !== undefined && pending.key !== null
            ? String(pending.key)
            : `${String(pending.toolName)}|${String(pending.callId)}|${String(index)}`;
          return `${String(sessionId)}|${identity}`;
        }

        /** Reconcile tracked approvals with the Client's live pending interactions. */
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
            for (const [sessionId, value] of status) {
              index += 1;
              const pending = value === undefined || value === null ? undefined : value.pendingInteraction;
              if (pending === undefined || pending === null) continue;
              if (pending.kind !== 'approval' || typeof pending.answer !== 'function') continue;
              if (minutes <= 0) continue;
              const key = trackKey(sessionId, pending, index);
              const toolName = typeof pending.toolName === 'string' && pending.toolName !== ''
                ? pending.toolName
                : undefined;
              live.set(key, { key, sessionId, toolName, pending });
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
          const text = mine === undefined
            ? t('label')
            : t('pending', { tool: mine.toolName === undefined ? t('label') : mine.toolName, time: formatRemaining(mine.remaining) });
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
        }, 'approval-timeout: pending approval timers');

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
