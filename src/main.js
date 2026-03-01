// Pomodoro Timer – MVP (both timers visible, auto-switch at zero)

const WORK_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;
const STORAGE_KEY = 'pomodoro-state';
const DAY_MS = 24 * 60 * 60 * 1000;

let audioContext = null;

function getAudioContext() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  return audioContext;
}

function isCountdownMuted() {
  return state?.muted === true;
}

function playBeep(options = {}) {
  if (isCountdownMuted()) return;
  const { frequency = 700, duration = 0.15 } = options;
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.06, t0);
    gain.gain.exponentialRampToValueAtTime(0.004, t0 + duration);
    osc.start(t0);
    osc.stop(t0 + duration);

    const overtone = ctx.createOscillator();
    const overtoneGain = ctx.createGain();
    overtone.type = 'sine';
    overtone.frequency.value = frequency * 2.37;
    overtone.connect(overtoneGain);
    overtoneGain.connect(ctx.destination);
    overtoneGain.gain.setValueAtTime(0.025, t0);
    overtoneGain.gain.exponentialRampToValueAtTime(0.001, t0 + duration * 0.6);
    overtone.start(t0);
    overtone.stop(t0 + duration * 0.6);
  } catch (_) {}
}

function playSegmentEndSound() {
  playBeep({ frequency: 440, duration: 1.15 });
}

function playDingDong() {
  if (isCountdownMuted()) return;
  const pentatonic = [659, 784, 880, 1046, 554];
  const high = pentatonic[3];
  const low = pentatonic[0];
  const noteDuration = 0.045;
  const gapMs = 20;
  const trillLength = 1.5;
  const cycleMs = noteDuration * 1000 + gapMs;
  const count = Math.floor((trillLength * 1000) / cycleMs);
  for (let i = 0; i < count; i++) {
    setTimeout(() => playBeep({ frequency: i % 2 === 0 ? high : low, duration: noteDuration }), i * cycleMs);
  }
}


const el = {
  timer: document.querySelector('.timer'),
  timerStatus: document.getElementById('timer-status'),
  segmentWork: document.getElementById('segment-work'),
  segmentBreak: document.getElementById('segment-break'),
  restartWorkBtn: document.querySelector('#segment-work .timer__btn--restart'),
  skipWorkBtn: document.querySelector('#segment-work .timer__btn--skip'),
  restartBreakBtn: document.querySelector('#segment-break .timer__btn--restart'),
  skipBreakBtn: document.getElementById('break-skip-btn'),
  timeDisplayWork: document.getElementById('time-display-work'),
  timeDisplayBreak: document.getElementById('time-display-break'),
  pauseBtn: document.getElementById('pause-btn'),
  presets: document.getElementById('presets'),
  progressWork: document.getElementById('progress-work'),
  progressBreak: document.getElementById('progress-break'),
  muteBtn: document.getElementById('mute-btn'),
  glowPulses: document.getElementById('glow-pulses'),
  ripples: document.getElementById('ripples'),
  dayLog: document.getElementById('day-log'),
  dayLogSummary: document.getElementById('day-log-summary'),
  dayLogCycles: document.getElementById('day-log-cycles'),
  dayLogClear: document.getElementById('day-log-clear'),
  dayLogViewAll: document.getElementById('day-log-view-all'),
  dayLogHide: document.getElementById('day-log-hide'),
};

let state = {
  workRemainingSeconds: WORK_SECONDS,
  breakRemainingSeconds: BREAK_SECONDS,
  workDuration: WORK_SECONDS,
  breakDuration: BREAK_SECONDS,
  currentMode: 'work',
  isRunning: false,
  intervalId: null,
  muted: false,
  /** Current "day" starts when first timer runs; cleared after 24h */
  dayStartedAt: null,
  /** Completed work+break cycles this day: { completedAt, workDuration, breakDuration } */
  completedCycles: [],
  /** True when we entered break because work timer hit zero (so this break counts toward a completed cycle) */
  workSegmentCompletedByTimer: false,
  /** When work was skipped, store work elapsed/duration until break finishes or is skipped; then we log the incomplete entry */
  pendingSkippedWork: null,
};

let logExpanded = false;
/** When collapsed, how many entries to show (3 by default; can be 2, 1, 0 after deletes). Reset to min(3, total) when user clicks "hide". */
let collapsedVisibleCount = 3;

/** Timeout id for revealing remaining entries 3s after all visible were deleted. */
let revealRemainingTimeoutId = null;
/** When true, next render adds slide-in animation to first list item (after revealing remaining). */
let justRevealedRemainingEntries = false;

let glowPulseIndex = 0;

/** Cache key for the log list so we don't re-render it every tick (avoids x flicker). */
let lastRenderedLogKey = '';
let lastRenderedLogExpanded = false;
let lastRenderedVisibleCount = -1;

/** Previous mode so we can delay updating the newly active counter until after its scale-up transition. */
let lastCurrentMode = null;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatTimeOfDay(ts) {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const hour12 = h % 12 || 12;
  const ampm = h < 12 ? 'am' : 'pm';
  return `${hour12}:${String(m).padStart(2, '0')}${ampm}`;
}

/** Format seconds as "Xm" or "Xm Ys" for log display. */
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

const MAX_DURATION_SECONDS = 55 * 60;

/** Parse "M:SS", "MM:SS", "M", "10s", "5m", "4m30s". Returns seconds or null if invalid. Values > 1 hour cap at 55 min. */
function parseTimeInput(str) {
  const trimmed = String(str).trim();
  if (!trimmed) return null;
  let seconds;
  const lower = trimmed.toLowerCase();
  const mmSsMatch = trimmed.match(/^(\d+)\s*m\s*(\d+)\s*s$/i);
  if (mmSsMatch) {
    const min = parseInt(mmSsMatch[1], 10);
    const sec = parseInt(mmSsMatch[2], 10);
    if (min < 0 || sec < 0 || sec > 59) return null;
    seconds = min * 60 + sec;
  } else if (lower.endsWith('s') && !lower.includes('m')) {
    const num = parseInt(trimmed.slice(0, -1).trim(), 10);
    if (Number.isNaN(num) || num < 0) return null;
    seconds = num;
  } else if (lower.endsWith('m')) {
    const num = parseInt(trimmed.slice(0, -1).trim(), 10);
    if (Number.isNaN(num) || num < 0) return null;
    seconds = num * 60;
  } else if (trimmed.includes(':')) {
    const [mPart, sPart] = trimmed.split(':');
    const min = mPart.trim() === '' ? 0 : parseInt(mPart, 10);
    const sec = sPart.trim() === '' ? 0 : parseInt(sPart, 10);
    if (Number.isNaN(min) || Number.isNaN(sec) || min < 0 || sec < 0 || sec > 59) return null;
    seconds = min * 60 + sec;
  } else {
    const min = parseInt(trimmed, 10);
    if (Number.isNaN(min) || min < 0) return null;
    seconds = min * 60;
  }
  return seconds > 60 * 60 ? MAX_DURATION_SECONDS : seconds;
}

function getTimeRemaining() {
  return state.currentMode === 'work' ? state.workRemainingSeconds : state.breakRemainingSeconds;
}

function setTimeRemaining(seconds) {
  if (state.currentMode === 'work') {
    state.workRemainingSeconds = seconds;
  } else {
    state.breakRemainingSeconds = seconds;
  }
}

/** Call when a full work+break cycle finishes (transitioning from break → work). */
/** @param breakElapsedSeconds - actual break time; if omitted, break ran to zero so use full duration */
/** @param omitBreak - if true, entry omits break (e.g. skipped break with no time elapsed while paused) */
function recordCompletedCycle(breakElapsedSeconds, omitBreak) {
  ensureDayStarted();
  const breakTime = omitBreak ? 0 : (breakElapsedSeconds ?? state.breakDuration);
  const entry = {
    completedAt: Date.now(),
    type: 'cycle',
    workDuration: state.workDuration,
    breakDuration: breakTime,
    intendedBreakDuration: state.breakDuration,
  };
  if (omitBreak) entry.omitBreak = true;
  state.completedCycles.push(entry);
}

/** Log the pending skipped-work entry (work was skipped, now break has finished or been skipped). */
/** @param breakElapsedSeconds - actual break time */
/** @param omitBreak - if true, entry omits break in display */
function recordPendingSkippedWork(breakElapsedSeconds, omitBreak) {
  if (!state.pendingSkippedWork) return;
  ensureDayStarted();
  const entry = {
    completedAt: Date.now(),
    type: 'skipped_work',
    workElapsedSeconds: state.pendingSkippedWork.workElapsedSeconds,
    workDuration: state.pendingSkippedWork.workDuration,
    breakElapsedSeconds: omitBreak ? 0 : breakElapsedSeconds,
    intendedBreakDuration: state.breakDuration,
  };
  if (omitBreak) entry.omitBreak = true;
  state.completedCycles.push(entry);
  state.pendingSkippedWork = null;
}

function getDuration(mode) {
  return mode === 'work' ? state.workDuration : state.breakDuration;
}

function isDayExpired() {
  return state.dayStartedAt != null && Date.now() - state.dayStartedAt >= DAY_MS;
}

function ensureDayStarted() {
  if (state.dayStartedAt == null || isDayExpired()) {
    state.dayStartedAt = Date.now();
    state.completedCycles = [];
    state.pendingSkippedWork = null;
  }
}

function saveState() {
  const payload = {
    workRemainingSeconds: state.workRemainingSeconds,
    breakRemainingSeconds: state.breakRemainingSeconds,
    workDuration: state.workDuration,
    breakDuration: state.breakDuration,
    currentMode: state.currentMode,
    isRunning: state.isRunning,
    muted: state.muted,
    dayStartedAt: state.dayStartedAt,
    completedCycles: state.completedCycles,
    workSegmentCompletedByTimer: state.workSegmentCompletedByTimer,
    pendingSkippedWork: state.pendingSkippedWork,
  };
  if (state.isRunning) {
    payload.lastSavedAt = Date.now();
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const required = ['workRemainingSeconds', 'breakRemainingSeconds', 'workDuration', 'breakDuration', 'currentMode', 'isRunning'];
    if (!required.every((k) => typeof data[k] === 'number' || (k === 'currentMode' && (data[k] === 'work' || data[k] === 'break')) || (k === 'isRunning' && typeof data[k] === 'boolean'))) return;
    state.workRemainingSeconds = Math.max(0, Math.floor(data.workRemainingSeconds));
    state.breakRemainingSeconds = Math.max(0, Math.floor(data.breakRemainingSeconds));
    state.workDuration = Math.max(1, Math.floor(data.workDuration));
    state.breakDuration = Math.max(1, Math.floor(data.breakDuration));
    state.currentMode = data.currentMode === 'break' ? 'break' : 'work';
    state.isRunning = Boolean(data.isRunning);
    if (typeof data.muted === 'boolean') state.muted = data.muted;

    if (typeof data.dayStartedAt === 'number') state.dayStartedAt = data.dayStartedAt;
    if (Array.isArray(data.completedCycles)) {
      state.completedCycles = data.completedCycles.filter((c) => {
        if (!c || typeof c.completedAt !== 'number') return false;
        if (c.type === 'skipped_work') {
          return typeof c.workElapsedSeconds === 'number' && typeof c.workDuration === 'number';
        }
        return typeof c.workDuration === 'number' && typeof c.breakDuration === 'number';
      });
    }
    if (typeof data.workSegmentCompletedByTimer === 'boolean') state.workSegmentCompletedByTimer = data.workSegmentCompletedByTimer;
    if (data.pendingSkippedWork && typeof data.pendingSkippedWork.workElapsedSeconds === 'number' && typeof data.pendingSkippedWork.workDuration === 'number') {
      state.pendingSkippedWork = data.pendingSkippedWork;
    }
    if (isDayExpired()) {
      state.dayStartedAt = null;
      state.completedCycles = [];
      state.workSegmentCompletedByTimer = false;
      state.pendingSkippedWork = null;
    }

    if (state.isRunning && typeof data.lastSavedAt === 'number') {
      const elapsed = Math.floor((Date.now() - data.lastSavedAt) / 1000);
      const remaining = getTimeRemaining();
      const newRemaining = Math.max(0, remaining - elapsed);
      setTimeRemaining(newRemaining);
      if (newRemaining <= 0) {
        setTimeRemaining(getDuration(state.currentMode));
        state.currentMode = state.currentMode === 'work' ? 'break' : 'work';
      }
    }
  } catch (_) {}
}

function render() {
  const workElapsed = state.workDuration - state.workRemainingSeconds;
  const breakElapsed = state.breakDuration - state.breakRemainingSeconds;
  const hideWorkControls = state.currentMode === 'work' && !state.isRunning && workElapsed < 1;
  const hideBreakControls = state.currentMode === 'break' && breakElapsed < 1 && state.isRunning;
  const hideBreakRestartBtn = state.currentMode === 'break' && breakElapsed < 1;

  el.segmentWork.classList.toggle('timer__segment--active', state.currentMode === 'work');
  el.segmentBreak.classList.toggle('timer__segment--active', state.currentMode === 'break');
  el.segmentWork.classList.toggle('timer__segment--controls-hidden', hideWorkControls);
  el.segmentBreak.classList.toggle('timer__segment--controls-hidden', hideBreakControls);
  el.segmentBreak.classList.toggle('timer__segment--break-restart-hidden', hideBreakRestartBtn);
  el.segmentWork.setAttribute('aria-current', state.currentMode === 'work' ? 'true' : 'false');
  el.segmentBreak.setAttribute('aria-current', state.currentMode === 'break' ? 'true' : 'false');

  if (state.isRunning) {
    el.timerStatus.innerHTML = 'Timer is <span class="timer__status-highlight">running</span>';
  } else if (state.currentMode === 'work' && state.workRemainingSeconds === getDuration('work')) {
    el.timerStatus.textContent = 'Timer is ready';
  } else {
    el.timerStatus.textContent = 'Timer is paused';
  }
  el.pauseBtn.setAttribute('aria-label', state.isRunning ? 'Stop timer' : 'Start timer');
  el.pauseBtn.setAttribute('data-state', state.isRunning ? 'running' : 'stopped');

  if (el.muteBtn) {
    el.muteBtn.setAttribute('aria-label', state.muted ? 'Unmute countdown sounds' : 'Mute countdown sounds');
    el.muteBtn.setAttribute('data-muted', state.muted ? 'true' : 'false');
  }

  const workDuration = getDuration('work');
  const breakDuration = getDuration('break');
  const workProgress = workDuration > 0 ? 1 - state.workRemainingSeconds / workDuration : 0;
  const breakProgress = breakDuration > 0 ? 1 - state.breakRemainingSeconds / breakDuration : 0;
  el.progressWork.style.setProperty('--progress', String(workProgress));
  el.progressBreak.style.setProperty('--progress', String(breakProgress));

  if (el.restartWorkBtn) el.restartWorkBtn.hidden = hideWorkControls;
  if (el.skipWorkBtn) el.skipWorkBtn.hidden = hideWorkControls;
  if (el.restartBreakBtn) el.restartBreakBtn.hidden = hideBreakRestartBtn;
  if (el.skipBreakBtn) {
    el.skipBreakBtn.hidden = hideBreakControls;
    const showSkipIcon = !hideBreakControls && state.currentMode === 'break' && !state.isRunning && breakElapsed < 1;
    el.skipBreakBtn.classList.toggle('timer__btn--break-skip-icon', showSkipIcon);
    if (!el.skipBreakBtn.hidden) {
      el.skipBreakBtn.setAttribute('aria-label', 'Complete break and continue');
    }
  }

  if (el.dayLogCycles) {
    const totalEntries = state.completedCycles.length;
    if (el.dayLogSummary) {
      if (totalEntries === 0) {
        const workElapsed = state.workDuration - state.workRemainingSeconds;
        const hasWorkTimeElapsed =
          state.isRunning ||
          workElapsed > 0 ||
          state.pendingSkippedWork != null ||
          state.workSegmentCompletedByTimer;
        el.dayLogSummary.textContent = hasWorkTimeElapsed ? 'Pomodoro in progress…' : 'Nothing yet.';
        el.dayLogSummary.hidden = false;
      } else {
        el.dayLogSummary.hidden = true;
      }
    }
    const sorted = [...state.completedCycles].sort((a, b) => b.completedAt - a.completedAt);
    const logKey = sorted.map((e) => e.completedAt).join(',');
    const maxVisibleDefault = 3;
    const prevEntryCount = lastRenderedLogKey ? lastRenderedLogKey.split(',').length : 0;
    if (sorted.length > prevEntryCount) {
      if (prevEntryCount <= 3 && sorted.length >= 4) {
        logExpanded = false;
        collapsedVisibleCount = 3;
      } else if (!logExpanded) {
        const addedCount = sorted.length - prevEntryCount;
        collapsedVisibleCount = Math.min(3, collapsedVisibleCount + addedCount);
      }
    }
    if (sorted.length >= 4 && !logExpanded) {
      collapsedVisibleCount = Math.min(collapsedVisibleCount, 3);
    }
    if (sorted.length < 4 && logExpanded) {
      logExpanded = false;
      collapsedVisibleCount = Math.min(3, sorted.length);
    }
    const visibleCount = logExpanded ? sorted.length : Math.min(collapsedVisibleCount, sorted.length);
    const visibleEntries = sorted.slice(0, visibleCount);
    const logViewChanged = logKey !== lastRenderedLogKey || logExpanded !== lastRenderedLogExpanded || visibleCount !== lastRenderedVisibleCount;
    if (logViewChanged) {
      const prevCount = lastRenderedLogKey ? lastRenderedLogKey.split(',').length : 0;
      lastRenderedLogKey = logKey;
      lastRenderedLogExpanded = logExpanded;
      lastRenderedVisibleCount = visibleCount;
      const isNewEntry = sorted.length > prevCount;
      el.dayLogCycles.innerHTML = visibleEntries
      .map((entry, i) => {
        const cycleClass = i === 0 && isNewEntry ? 'day-log__cycle day-log__cycle--new' : 'day-log__cycle';
        const timePart = `<span class="day-log__sep">•</span> ${formatTimeOfDay(entry.completedAt)}`;
        const removeBtn = `<button type="button" class="day-log__remove" data-sorted-index="${i}" aria-label="Remove entry"><svg class="day-log__remove-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`;
        if (entry.type === 'skipped_work') {
          const workPart = `<span class="day-log__dur day-log__dur--work-skipped">${formatDuration(entry.workElapsedSeconds)}</span>`;
          if (entry.omitBreak) {
            return `<li class="${cycleClass}">${removeBtn}<span class="day-log__entry">${workPart} ${timePart}</span></li>`;
          }
          const breakElapsed = entry.breakElapsedSeconds ?? 0;
          const breakShort = typeof entry.intendedBreakDuration === 'number' && breakElapsed < entry.intendedBreakDuration;
          const breakClass = breakShort ? 'day-log__dur day-log__dur--break day-log__dur--break-short' : 'day-log__dur day-log__dur--break';
          return `<li class="${cycleClass}">${removeBtn}<span class="day-log__entry">${workPart} + <span class="${breakClass}">${formatDuration(breakElapsed)}</span> ${timePart}</span></li>`;
        }
        const workPart = `<span class="day-log__dur day-log__dur--work">${formatDuration(entry.workDuration)}</span>`;
        if (entry.omitBreak) {
          return `<li class="${cycleClass}">${removeBtn}<span class="day-log__entry">${workPart} ${timePart}</span></li>`;
        }
        const breakShort = typeof entry.intendedBreakDuration === 'number' && entry.breakDuration < entry.intendedBreakDuration;
        const breakClass = breakShort ? 'day-log__dur day-log__dur--break day-log__dur--break-short' : 'day-log__dur day-log__dur--break';
        return `<li class="${cycleClass}">${removeBtn}<span class="day-log__entry">${workPart} + <span class="${breakClass}">${formatDuration(entry.breakDuration)}</span> ${timePart}</span></li>`;
      })
      .join('');
      if (justRevealedRemainingEntries) {
        justRevealedRemainingEntries = false;
        Array.from(el.dayLogCycles.children).forEach((li) => {
          li.classList.add('day-log__cycle--fade-in');
          li.addEventListener('animationend', () => li.classList.remove('day-log__cycle--fade-in'), { once: true });
        });
      } else if (isNewEntry && el.dayLogCycles.firstElementChild) {
        const firstLi = el.dayLogCycles.firstElementChild;
        firstLi.addEventListener('animationend', () => firstLi.classList.remove('day-log__cycle--new'), { once: true });
      }
    }
    const showShowAll = !logExpanded && totalEntries > visibleCount;
    const showHide = logExpanded && totalEntries >= 4;
    if (el.dayLogViewAll) {
      if (showShowAll) {
        const chevronDown = '<svg class="day-log__view-all-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
        const hiddenCount = totalEntries - visibleCount;
        el.dayLogViewAll.innerHTML = `${chevronDown} more (${hiddenCount})`;
        el.dayLogViewAll.setAttribute('aria-label', `Show ${hiddenCount} more log entries`);
      }
      el.dayLogViewAll.hidden = !showShowAll;
    }
    if (el.dayLogHide) {
      el.dayLogHide.hidden = !showHide;
    }
    if (el.dayLogClear) el.dayLogClear.hidden = !showHide;
    if (el.dayLog) {
      el.dayLog.classList.toggle('day-log--has-entries', totalEntries > 0);
      el.dayLog.classList.toggle('day-log--expanded', logExpanded);
      el.dayLog.classList.toggle('day-log--entries-4-plus', totalEntries >= 4);
    }
  }

  // Defer time display updates to next frame so segment --active transition isn’t glitched by input reflow
  // Double rAF so counter font-size/width transition runs when segment becomes active (value update after paint)
  const modeJustChanged = lastCurrentMode != null && lastCurrentMode !== state.currentMode;
  lastCurrentMode = state.currentMode;

  const COUNTER_TRANSITION_MS = 520;

  function updateWorkDisplay() {
    if (document.activeElement !== el.timeDisplayWork) {
      el.timeDisplayWork.value = formatTime(state.workRemainingSeconds);
    }
  }
  function updateBreakDisplay() {
    if (document.activeElement !== el.timeDisplayBreak) {
      el.timeDisplayBreak.value = formatTime(state.breakRemainingSeconds);
    }
  }

  if (modeJustChanged) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (state.currentMode === 'work') updateBreakDisplay();
        else updateWorkDisplay();
      });
    });
    setTimeout(() => {
      if (state.currentMode === 'work') updateWorkDisplay();
      else updateBreakDisplay();
    }, COUNTER_TRANSITION_MS);
  } else {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateWorkDisplay();
        updateBreakDisplay();
      });
    });
  }
}

function triggerGlowPulse(remaining) {
  if (!el.glowPulses) return;
  const glowEls = el.glowPulses.querySelectorAll('.glow');
  if (glowEls.length === 0) return;
  const color = state.currentMode === 'work' ? 'var(--color-mode-work)' : 'var(--color-mode-break)';
  const target = glowEls[glowPulseIndex];
  target.style.setProperty('--glow-color', color);
  target.setAttribute('data-pulse-level', String(remaining));
  target.classList.add('glow--pulse');
  glowPulseIndex = (glowPulseIndex + 1) % glowEls.length;

  if (el.ripples) {
    const ns = 'http://www.w3.org/2000/svg';
    const ring = document.createElementNS(ns, 'svg');
    ring.setAttribute('class', 'ripple-ring');
    ring.setAttribute('viewBox', '0 0 100 100');
    ring.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    ring.style.setProperty('--ripple-color', color);
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '50');
    circle.setAttribute('cy', '50');
    circle.setAttribute('r', '49');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '0.25');
    circle.setAttribute('vector-effect', 'non-scaling-stroke');
    ring.appendChild(circle);
    ring.addEventListener('animationend', () => ring.remove());
    el.ripples.appendChild(ring);
  }
}

function triggerTransitionGlow() {
  if (el.glowPulses) {
    el.glowPulses.querySelectorAll('.glow.glow--pulse').forEach((g) => {
      g.style.setProperty('--glow-color', 'var(--color-transition-dim)');
    });
  }
  if (el.ripples) {
    const ns = 'http://www.w3.org/2000/svg';
    const ring = document.createElementNS(ns, 'svg');
    ring.setAttribute('class', 'ripple-ring ripple-ring--zero');
    ring.setAttribute('viewBox', '0 0 100 100');
    ring.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    ring.style.setProperty('--ripple-color', 'var(--color-transition-dim)');
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '50');
    circle.setAttribute('cy', '50');
    circle.setAttribute('r', '49');
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '0.25');
    circle.setAttribute('vector-effect', 'non-scaling-stroke');
    ring.appendChild(circle);
    ring.addEventListener('animationend', () => ring.remove());
    el.ripples.appendChild(ring);
  }
}

function tick() {
  const remaining = getTimeRemaining();
  if (remaining <= 0) return;
  setTimeRemaining(remaining - 1);
  const nowRemaining = getTimeRemaining();
  if (nowRemaining >= 1 && nowRemaining <= 4) {
    triggerGlowPulse(nowRemaining);
    playBeep({ frequency: 1046, duration: 0.12 });
  }
  if (nowRemaining <= 0) {
    if (state.currentMode === 'work') {
      state.workSegmentCompletedByTimer = true;
    } else if (state.currentMode === 'break') {
      if (state.pendingSkippedWork) {
        recordPendingSkippedWork(state.breakDuration);
      } else if (state.workSegmentCompletedByTimer) {
        recordCompletedCycle();
        state.workSegmentCompletedByTimer = false;
      }
    }
    triggerTransitionGlow();
    playDingDong();
    setTimeRemaining(getDuration(state.currentMode));
    state.currentMode = state.currentMode === 'work' ? 'break' : 'work';
  }
  saveState();
  render();
}

function setCurrentMode(mode) {
  if (state.isRunning) stop();
  state.currentMode = mode;
  saveState();
  render();
}

/** If in break, record cycle or skipped-work to log and clear flags. When paused and no break elapsed, omit break in entry. */
function flushBreakToLogIfElapsed() {
  if (state.currentMode !== 'break') return;
  const breakElapsed = state.breakDuration - state.breakRemainingSeconds;
  const omitBreak = !state.isRunning && breakElapsed <= 0;
  if (breakElapsed <= 0 && !omitBreak) return;
  if (!state.pendingSkippedWork && !state.workSegmentCompletedByTimer) return;
  if (state.pendingSkippedWork) {
    recordPendingSkippedWork(omitBreak ? 0 : breakElapsed, omitBreak);
  } else if (state.workSegmentCompletedByTimer) {
    recordCompletedCycle(omitBreak ? 0 : breakElapsed, omitBreak);
    state.workSegmentCompletedByTimer = false;
  }
}

function stop() {
  if (!state.isRunning) return;
  state.isRunning = false;
  if (state.intervalId !== null) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  saveState();
  render();
}

function start() {
  if (state.isRunning) return;
  ensureDayStarted();
  getAudioContext();
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  state.isRunning = true;
  state.intervalId = setInterval(tick, 1000);
  saveState();
  render();
}

function handlePlayPause() {
  if (state.isRunning) stop();
  else start();
}

function toggleMute() {
  state.muted = !state.muted;
  saveState();
  render();
}

function restart(mode) {
  stop();
  const segment = mode === 'break' ? 'break' : 'work';
  if (segment === 'break') {
    state.breakRemainingSeconds = getDuration('break');
  } else {
    state.workRemainingSeconds = getDuration('work');
  }
  saveState();
  render();
}

function skip() {
  if (state.currentMode === 'break') {
    flushBreakToLogIfElapsed();
  } else if (state.currentMode === 'work') {
    const workElapsed = state.workDuration - state.workRemainingSeconds;
    if (workElapsed >= 1) {
      if (state.workRemainingSeconds <= 1) {
        state.workSegmentCompletedByTimer = true;
      } else {
        state.pendingSkippedWork = {
          workElapsedSeconds: workElapsed,
          workDuration: state.workDuration,
        };
        state.workSegmentCompletedByTimer = false;
      }
    }
  }
  state.workRemainingSeconds = getDuration('work');
  state.breakRemainingSeconds = getDuration('break');
  state.currentMode = state.currentMode === 'work' ? 'break' : 'work';
  saveState();
  render();
}

function clearLog() {
  state.completedCycles = [];
  saveState();
  render();
}

/** Remove a single log entry by its index in the sorted list. Does not affect timer state. */
function removeLogEntry(sortedIndex) {
  const sorted = [...state.completedCycles].sort((a, b) => b.completedAt - a.completedAt);
  const entry = sorted[sortedIndex];
  if (!entry) return;
  state.completedCycles = state.completedCycles.filter((e) => e !== entry);
  saveState();
  render();
}

function applyPreset(workMinutes, breakMinutes) {
  stop();
  const workSec = workMinutes * 60;
  const breakSec = breakMinutes * 60;
  state.workRemainingSeconds = workSec;
  state.breakRemainingSeconds = breakSec;
  state.workDuration = workSec;
  state.breakDuration = breakSec;
  state.currentMode = 'work';
  saveState();
  render();
}

function init() {
  loadState();
  if (state.isRunning) {
    state.intervalId = setInterval(tick, 1000);
  }
  render();

  if (el.glowPulses) {
    el.glowPulses.querySelectorAll('.glow').forEach((g) => {
      g.addEventListener('animationend', () => {
        g.classList.remove('glow--pulse');
      });
    });
  }
  el.pauseBtn.addEventListener('click', handlePlayPause);
  if (el.muteBtn) el.muteBtn.addEventListener('click', toggleMute);
  if (el.dayLogClear) el.dayLogClear.addEventListener('click', clearLog);
  if (el.dayLogCycles) {
    el.dayLogCycles.addEventListener('click', (e) => {
      const btn = e.target.closest('.day-log__remove');
      if (!btn) return;
      const index = parseInt(btn.getAttribute('data-sorted-index'), 10);
      if (Number.isNaN(index)) return;
      const li = btn.closest('.day-log__cycle');
      if (!li) {
        removeLogEntry(index);
        return;
      }
      li.classList.add('day-log__cycle--removing');
      li.addEventListener('transitionend', () => {
        if (!logExpanded) collapsedVisibleCount = Math.max(0, collapsedVisibleCount - 1);
        removeLogEntry(index);
        if (!logExpanded && collapsedVisibleCount === 0 && state.completedCycles.length >= 1) {
          if (revealRemainingTimeoutId != null) clearTimeout(revealRemainingTimeoutId);
          revealRemainingTimeoutId = setTimeout(() => {
            revealRemainingTimeoutId = null;
            if (!el.dayLogViewAll || state.completedCycles.length === 0 || logExpanded) return;
            el.dayLogViewAll.classList.add('day-log__view-all--fade-out');
            setTimeout(() => {
              el.dayLogViewAll.hidden = true;
              el.dayLogViewAll.classList.remove('day-log__view-all--fade-out');
              requestAnimationFrame(() => {
                collapsedVisibleCount = Math.min(3, state.completedCycles.length);
                justRevealedRemainingEntries = true;
                render();
              });
            }, 300);
          }, 3000);
        }
      }, { once: true });
    });
  }
  if (el.dayLogViewAll) {
    el.dayLogViewAll.addEventListener('click', () => {
      if (revealRemainingTimeoutId != null) {
        clearTimeout(revealRemainingTimeoutId);
        revealRemainingTimeoutId = null;
      }
      logExpanded = true;
      render();
    });
  }
  if (el.dayLogHide) {
    el.dayLogHide.addEventListener('click', () => {
      if (revealRemainingTimeoutId != null) {
        clearTimeout(revealRemainingTimeoutId);
        revealRemainingTimeoutId = null;
      }
      logExpanded = false;
      const totalEntries = state.completedCycles.length;
      collapsedVisibleCount = Math.min(3, totalEntries);
      render();
    });
  }
  el.timer.addEventListener('click', (e) => {
    const restartBtn = e.target.closest('.timer__btn--restart');
    if (restartBtn) {
      const mode = restartBtn.getAttribute('data-mode');
      restart(mode === 'break' ? 'break' : 'work');
      return;
    }
    if (e.target.closest('.timer__btn--skip')) skip();
  });
  el.presets.addEventListener('click', (e) => {
    const btn = e.target.closest('.timer__btn--new-pomodoro');
    if (!btn) return;
    const work = parseInt(btn.dataset.work, 10);
    const breakMin = parseInt(btn.dataset.break, 10);
    if (!Number.isNaN(work) && !Number.isNaN(breakMin)) applyPreset(work, breakMin);
  });

  el.timeDisplayWork.addEventListener('blur', () => {
    const sec = parseTimeInput(el.timeDisplayWork.value);
    if (sec !== null) {
      state.workRemainingSeconds = sec;
      state.workDuration = sec;
    } else {
      el.timeDisplayWork.value = formatTime(state.workRemainingSeconds);
    }
    saveState();
    render();
  });
  el.timeDisplayWork.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.timeDisplayWork.blur();
  });

  el.timeDisplayBreak.addEventListener('blur', () => {
    const sec = parseTimeInput(el.timeDisplayBreak.value);
    if (sec !== null) {
      state.breakRemainingSeconds = sec;
      state.breakDuration = sec;
    } else {
      el.timeDisplayBreak.value = formatTime(state.breakRemainingSeconds);
    }
    saveState();
    render();
  });
  el.timeDisplayBreak.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.timeDisplayBreak.blur();
  });
}

init();