// Pomodoro Timer – MVP (both timers visible, auto-switch at zero)

import { getAudioContext, playBeep, playSegmentEndSound, playDingDong } from './audio.js';

// --- Constants ---
const WORK_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;
const STORAGE_KEY = 'pomodoro-state';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DURATION_SECONDS = 55 * 60;
const VISIBLE_LOG_ENTRIES_DEFAULT = 3;
const LOG_EXPAND_THRESHOLD = 4;

// --- DOM refs ---
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
  timerLiveValue: document.getElementById('timer-live-value'),
  timeInputError: document.getElementById('time-input-error'),
};

// --- State ---
let state = {
  workRemainingSeconds: WORK_SECONDS,
  breakRemainingSeconds: BREAK_SECONDS,
  workDuration: WORK_SECONDS,
  breakDuration: BREAK_SECONDS,
  currentMode: 'work',
  isRunning: false,
  intervalId: null,
  muted: false,
  /** When running, time of last save (for resync when tab becomes visible). */
  lastSavedAt: null,
  /** Current "day" starts when first timer runs; cleared after 24h */
  dayStartedAt: null,
  /** Completed work+break cycles this day: { completedAt, workDuration, breakDuration } */
  completedCycles: [],
  /** True when we entered break because work timer hit zero (so this break counts toward a completed cycle) */
  workSegmentCompletedByTimer: false,
  /** When work was skipped, store work elapsed/duration until break finishes or is skipped; then we log the incomplete entry */
  pendingSkippedWork: null,
};

// --- Log view state (expand/collapse, visible count, cache for re-render) ---
let logViewState = {
  expanded: false,
  collapsedVisibleCount: VISIBLE_LOG_ENTRIES_DEFAULT,
  revealRemainingTimeoutId: null,
  justRevealedRemainingEntries: false,
  lastRenderedLogKey: '',
  lastRenderedLogExpanded: false,
  lastRenderedVisibleCount: -1,
};

let glowPulseIndex = 0;
/** Previous mode so we can delay updating the newly active counter until after its scale-up transition. */
let lastCurrentMode = null;
/** Last minute value announced to live region. */
let lastAnnouncedMinute = null;

// --- Format helpers ---
/** Build a single day-log list item HTML string (cycle or skipped_work, with optional omitBreak). */
function buildDayLogEntryHtml(entry, index, cycleClass) {
  const timePart = `<span class="day-log__sep">•</span> ${formatTimeOfDay(entry.completedAt)}`;
  const removeBtn = `<button type="button" class="day-log__remove" data-sorted-index="${index}" aria-label="Remove entry"><svg class="day-log__remove-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`;
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
}

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

// --- State helpers ---
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

// --- Persistence ---
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
    state.lastSavedAt = Date.now();
    payload.lastSavedAt = state.lastSavedAt;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function isValidSavedState(data) {
  if (!data || typeof data !== 'object') return false;
  const numKeys = ['workRemainingSeconds', 'breakRemainingSeconds', 'workDuration', 'breakDuration'];
  if (!numKeys.every((k) => typeof data[k] === 'number')) return false;
  if (data.currentMode !== 'work' && data.currentMode !== 'break') return false;
  if (typeof data.isRunning !== 'boolean') return false;
  return true;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!isValidSavedState(data)) return;
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
      state.lastSavedAt = data.lastSavedAt;
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

// --- Render ---
function updateTimeDisplay(displayEl, seconds) {
  if (!displayEl || document.activeElement === displayEl) return;
  displayEl.value = formatTime(seconds);
}

/** Update the live region with current time when the minute value changes. */
function updateTimerLiveRegion() {
  const remaining = getTimeRemaining();
  const min = Math.floor(remaining / 60);
  if (lastAnnouncedMinute !== min && el.timerLiveValue) {
    lastAnnouncedMinute = min;
    el.timerLiveValue.textContent = formatTime(remaining);
  }
}

/** Update progress bar CSS variables from current state. */
function updateProgressBars() {
  const workDuration = getDuration('work');
  const breakDuration = getDuration('break');
  const workProgress = workDuration > 0 ? 1 - state.workRemainingSeconds / workDuration : 0;
  const breakProgress = breakDuration > 0 ? 1 - state.breakRemainingSeconds / breakDuration : 0;
  el.progressWork.style.setProperty('--progress', String(workProgress));
  el.progressBreak.style.setProperty('--progress', String(breakProgress));
}

/** Apply segment control visibility (classes and button .hidden). Shared by full render and tick-only path. */
function applySegmentControlVisibility() {
  const workElapsed = state.workDuration - state.workRemainingSeconds;
  const breakElapsed = state.breakDuration - state.breakRemainingSeconds;
  const hideWorkControls = state.currentMode === 'work' && !state.isRunning && workElapsed < 1;
  const hideBreakControls = state.currentMode === 'break' && breakElapsed < 1 && state.isRunning;
  const hideBreakRestartBtn = state.currentMode === 'break' && breakElapsed < 1;
  el.segmentWork.classList.toggle('timer__segment--controls-hidden', hideWorkControls);
  el.segmentBreak.classList.toggle('timer__segment--controls-hidden', hideBreakControls);
  el.segmentBreak.classList.toggle('timer__segment--break-restart-hidden', hideBreakRestartBtn);
  if (el.restartWorkBtn) el.restartWorkBtn.hidden = hideWorkControls;
  if (el.skipWorkBtn) el.skipWorkBtn.hidden = hideWorkControls;
  if (el.restartBreakBtn) el.restartBreakBtn.hidden = hideBreakRestartBtn;
  if (el.skipBreakBtn) {
    el.skipBreakBtn.hidden = hideBreakControls;
    const showSkipIcon = !hideBreakControls && state.currentMode === 'break' && !state.isRunning && breakElapsed < 1;
    el.skipBreakBtn.classList.toggle('timer__btn--break-skip-icon', showSkipIcon);
    if (!el.skipBreakBtn.hidden) el.skipBreakBtn.setAttribute('aria-label', 'Complete break and continue');
  }
}

/** Lightweight update for tick: time displays, progress bars, and segment control visibility. Use when log and mode are unchanged. */
function renderTimeAndProgressOnly() {
  updateTimeDisplay(el.timeDisplayWork, state.workRemainingSeconds);
  updateTimeDisplay(el.timeDisplayBreak, state.breakRemainingSeconds);
  updateTimerLiveRegion();
  updateProgressBars();
  applySegmentControlVisibility();
}

function renderTimerUI() {
  el.segmentWork.classList.toggle('timer__segment--active', state.currentMode === 'work');
  el.segmentBreak.classList.toggle('timer__segment--active', state.currentMode === 'break');
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
  el.pauseBtn.setAttribute('aria-pressed', state.isRunning ? 'true' : 'false');
  el.pauseBtn.setAttribute('data-state', state.isRunning ? 'running' : 'stopped');

  if (el.muteBtn) {
    el.muteBtn.setAttribute('aria-label', state.muted ? 'Unmute countdown sounds' : 'Mute countdown sounds');
    el.muteBtn.setAttribute('data-muted', state.muted ? 'true' : 'false');
  }

  updateProgressBars();
  applySegmentControlVisibility();
}

function renderDayLog() {
  if (!el.dayLogCycles) return;
    const wasLogExpanded = logViewState.lastRenderedLogExpanded;
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
    const prevEntryCount = logViewState.lastRenderedLogKey ? logViewState.lastRenderedLogKey.split(',').length : 0;
    if (sorted.length > prevEntryCount) {
      if (prevEntryCount <= VISIBLE_LOG_ENTRIES_DEFAULT && sorted.length >= LOG_EXPAND_THRESHOLD) {
        logViewState.expanded = false;
        logViewState.collapsedVisibleCount = VISIBLE_LOG_ENTRIES_DEFAULT;
      } else if (!logViewState.expanded) {
        const addedCount = sorted.length - prevEntryCount;
        logViewState.collapsedVisibleCount = Math.min(VISIBLE_LOG_ENTRIES_DEFAULT, logViewState.collapsedVisibleCount + addedCount);
      }
    }
    if (sorted.length >= LOG_EXPAND_THRESHOLD && !logViewState.expanded) {
      logViewState.collapsedVisibleCount = Math.min(logViewState.collapsedVisibleCount, VISIBLE_LOG_ENTRIES_DEFAULT);
    }
    if (sorted.length < LOG_EXPAND_THRESHOLD && logViewState.expanded) {
      logViewState.expanded = false;
      logViewState.collapsedVisibleCount = Math.min(VISIBLE_LOG_ENTRIES_DEFAULT, sorted.length);
    }
    const visibleCount = logViewState.expanded ? sorted.length : Math.min(logViewState.collapsedVisibleCount, sorted.length);
    const visibleEntries = sorted.slice(0, visibleCount);
    const logViewChanged = logKey !== logViewState.lastRenderedLogKey || logViewState.expanded !== logViewState.lastRenderedLogExpanded || visibleCount !== logViewState.lastRenderedVisibleCount;
    if (logViewChanged) {
      const prevCount = logViewState.lastRenderedLogKey ? logViewState.lastRenderedLogKey.split(',').length : 0;
      logViewState.lastRenderedLogKey = logKey;
      logViewState.lastRenderedLogExpanded = logViewState.expanded;
      logViewState.lastRenderedVisibleCount = visibleCount;
      const isNewEntry = sorted.length > prevCount;
      const animateNewEntry = isNewEntry && (prevCount < VISIBLE_LOG_ENTRIES_DEFAULT || logViewState.expanded || visibleCount !== VISIBLE_LOG_ENTRIES_DEFAULT);
      const useFadeInForNew = isNewEntry && !animateNewEntry && (!logViewState.expanded || totalEntries <= VISIBLE_LOG_ENTRIES_DEFAULT);
      const isFirstEntryReplacingSummary = isNewEntry && prevCount === 0;
      el.dayLogCycles.innerHTML = visibleEntries
        .map((entry, i) => {
          let cycleClass = 'day-log__cycle';
          if (i === 0 && isFirstEntryReplacingSummary) cycleClass += ' day-log__cycle--push-up';
          else if (i === 0 && animateNewEntry) cycleClass += ' day-log__cycle--new';
          else if (i === 0 && useFadeInForNew) cycleClass += ' day-log__cycle--fade-in';
          return buildDayLogEntryHtml(entry, i, cycleClass);
        })
        .join('');
      if (logViewState.justRevealedRemainingEntries) {
        logViewState.justRevealedRemainingEntries = false;
        Array.from(el.dayLogCycles.children).forEach((li) => {
          li.classList.add('day-log__cycle--fade-in');
          li.addEventListener('animationend', () => li.classList.remove('day-log__cycle--fade-in'), { once: true });
        });
      } else if (isFirstEntryReplacingSummary && el.dayLogCycles.firstElementChild) {
        const firstLi = el.dayLogCycles.firstElementChild;
        firstLi.addEventListener('animationend', () => firstLi.classList.remove('day-log__cycle--push-up'), { once: true });
      } else if (animateNewEntry && el.dayLogCycles.firstElementChild) {
        const firstLi = el.dayLogCycles.firstElementChild;
        firstLi.addEventListener('animationend', () => firstLi.classList.remove('day-log__cycle--new'), { once: true });
      } else if (useFadeInForNew && el.dayLogCycles.firstElementChild) {
        const firstLi = el.dayLogCycles.firstElementChild;
        firstLi.addEventListener('animationend', () => firstLi.classList.remove('day-log__cycle--fade-in'), { once: true });
      }
    }
    const showShowAll = !logViewState.expanded && totalEntries > visibleCount;
    const showHide = logViewState.expanded && totalEntries >= LOG_EXPAND_THRESHOLD;
    if (el.dayLogViewAll) {
      if (showShowAll) {
        const chevronDown = '<svg class="day-log__view-all-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
        const hiddenCount = totalEntries - visibleCount;
        el.dayLogViewAll.innerHTML = `${chevronDown} more (${hiddenCount})`;
        el.dayLogViewAll.setAttribute('aria-label', `Show ${hiddenCount} more log entries`);
        const wasHidden = el.dayLogViewAll.hidden;
        el.dayLogViewAll.hidden = false;
        if (wasHidden && !wasLogExpanded) {
          el.dayLogViewAll.classList.add('day-log__view-all--fade-in');
          el.dayLogViewAll.addEventListener('animationend', () => {
            el.dayLogViewAll.classList.remove('day-log__view-all--fade-in');
          }, { once: true });
        }
      } else {
        el.dayLogViewAll.hidden = true;
      }
    }
    if (el.dayLogHide) {
      el.dayLogHide.hidden = !showHide;
    }
    if (el.dayLogClear) el.dayLogClear.hidden = !showHide;
    if (el.dayLog) {
      el.dayLog.classList.toggle('day-log--has-entries', totalEntries > 0);
      el.dayLog.classList.toggle('day-log--expanded', logViewState.expanded);
      el.dayLog.classList.toggle('day-log--entries-4-plus', totalEntries >= LOG_EXPAND_THRESHOLD);
    }
  }

function updateTimeDisplays() {
  updateTimeDisplay(el.timeDisplayWork, state.workRemainingSeconds);
  updateTimeDisplay(el.timeDisplayBreak, state.breakRemainingSeconds);
  updateTimerLiveRegion();

  const modeJustChanged = lastCurrentMode != null && lastCurrentMode !== state.currentMode;
  lastCurrentMode = state.currentMode;
  if (modeJustChanged) lastAnnouncedMinute = null;

  const COUNTER_TRANSITION_MS = 520;

  if (modeJustChanged) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (state.currentMode === 'work') updateTimeDisplay(el.timeDisplayBreak, state.breakRemainingSeconds);
        else updateTimeDisplay(el.timeDisplayWork, state.workRemainingSeconds);
      });
    });
    setTimeout(() => {
      if (state.currentMode === 'work') updateTimeDisplay(el.timeDisplayWork, state.workRemainingSeconds);
      else updateTimeDisplay(el.timeDisplayBreak, state.breakRemainingSeconds);
    }, COUNTER_TRANSITION_MS);
  } else {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        updateTimeDisplay(el.timeDisplayWork, state.workRemainingSeconds);
        updateTimeDisplay(el.timeDisplayBreak, state.breakRemainingSeconds);
      });
    });
  }
}

function render() {
  renderTimerUI();
  renderDayLog();
  updateTimeDisplays();
}

// --- Effects ---
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

// --- Timer logic ---
function tick() {
  const remaining = getTimeRemaining();
  if (remaining <= 0) return;
  setTimeRemaining(remaining - 1);
  const nowRemaining = getTimeRemaining();
  if (nowRemaining >= 1 && nowRemaining <= 4) {
    triggerGlowPulse(nowRemaining);
    if (!state.muted) playBeep({ frequency: 1046, duration: 0.12 });
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
    if (!state.muted) playDingDong();
    setTimeRemaining(getDuration(state.currentMode));
    state.currentMode = state.currentMode === 'work' ? 'break' : 'work';
  }
  saveState();
  if (nowRemaining <= 0) {
    render();
  } else {
    renderTimeAndProgressOnly();
  }
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
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  state.isRunning = true;
  state.intervalId = setInterval(tick, 1000);
  saveState();
  render();
}

// --- Actions ---
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
  if (el.dayLog) el.dayLog.focus();
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

// --- Init ---
function resyncTimerFromElapsed() {
  if (!state.isRunning || state.intervalId == null || state.lastSavedAt == null) return;
  const elapsed = Math.floor((Date.now() - state.lastSavedAt) / 1000);
  if (elapsed <= 0) return;
  const remaining = getTimeRemaining();
  const newRemaining = Math.max(0, remaining - elapsed);
  setTimeRemaining(newRemaining);
  state.lastSavedAt = Date.now();
  if (newRemaining <= 0) {
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
    if (!state.muted) playDingDong();
    setTimeRemaining(getDuration(state.currentMode));
    state.currentMode = state.currentMode === 'work' ? 'break' : 'work';
  }
  saveState();
  render();
  clearInterval(state.intervalId);
  state.intervalId = setInterval(tick, 1000);
}

function init() {
  loadState();
  if (state.isRunning) {
    state.intervalId = setInterval(tick, 1000);
  }
  render();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resyncTimerFromElapsed();
  });

  // Glow pulse animation cleanup
  if (el.glowPulses) {
    el.glowPulses.querySelectorAll('.glow').forEach((g) => {
      g.addEventListener('animationend', () => {
        g.classList.remove('glow--pulse');
      });
    });
  }
  // Pause / mute
  if (el.pauseBtn) el.pauseBtn.addEventListener('click', handlePlayPause);
  if (el.muteBtn) el.muteBtn.addEventListener('click', toggleMute);
  // Day log: clear, view-all, hide, remove-entry
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
        if (!logViewState.expanded) logViewState.collapsedVisibleCount = Math.max(0, logViewState.collapsedVisibleCount - 1);
        removeLogEntry(index);
        if (!logViewState.expanded && logViewState.collapsedVisibleCount === 0 && state.completedCycles.length >= 1) {
          if (logViewState.revealRemainingTimeoutId != null) clearTimeout(logViewState.revealRemainingTimeoutId);
          logViewState.revealRemainingTimeoutId = setTimeout(() => {
            logViewState.revealRemainingTimeoutId = null;
            if (!el.dayLogViewAll || state.completedCycles.length === 0 || logViewState.expanded) return;
            el.dayLogViewAll.classList.add('day-log__view-all--fade-out');
            setTimeout(() => {
              el.dayLogViewAll.hidden = true;
              el.dayLogViewAll.classList.remove('day-log__view-all--fade-out');
              requestAnimationFrame(() => {
                logViewState.collapsedVisibleCount = Math.min(VISIBLE_LOG_ENTRIES_DEFAULT, state.completedCycles.length);
                logViewState.justRevealedRemainingEntries = true;
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
      if (logViewState.revealRemainingTimeoutId != null) {
        clearTimeout(logViewState.revealRemainingTimeoutId);
        logViewState.revealRemainingTimeoutId = null;
      }
      logViewState.expanded = true;
      render();
    });
  }
  if (el.dayLogHide) {
    el.dayLogHide.addEventListener('click', () => {
      if (logViewState.revealRemainingTimeoutId != null) {
        clearTimeout(logViewState.revealRemainingTimeoutId);
        logViewState.revealRemainingTimeoutId = null;
      }
      logViewState.expanded = false;
      const totalEntries = state.completedCycles.length;
      logViewState.collapsedVisibleCount = Math.min(VISIBLE_LOG_ENTRIES_DEFAULT, totalEntries);
      render();
      if (el.dayLogViewAll && !el.dayLogViewAll.hidden) el.dayLogViewAll.focus();
      else if (el.dayLog) el.dayLog.focus();
    });
  }
  // Timer: restart, skip
  if (el.timer) {
    el.timer.addEventListener('click', (e) => {
      const restartBtn = e.target.closest('.timer__btn--restart');
      if (restartBtn) {
        const mode = restartBtn.getAttribute('data-mode');
        restart(mode === 'break' ? 'break' : 'work');
        return;
      }
      if (e.target.closest('.timer__btn--skip')) skip();
    });
  }
  // Presets (25/5, 50/10)
  if (el.presets) {
    el.presets.addEventListener('click', (e) => {
      const btn = e.target.closest('.timer__btn--new-pomodoro');
      if (!btn) return;
      const work = parseInt(btn.dataset.work, 10);
      const breakMin = parseInt(btn.dataset.break, 10);
      if (!Number.isNaN(work) && !Number.isNaN(breakMin)) applyPreset(work, breakMin);
    });
  }

  // Time inputs (work / break)
  const TIME_INPUT_ERROR_MSG = 'Invalid time. Use format like 25:00 or 25 minutes.';
  function clearTimeInputError() {
    if (el.timeInputError) el.timeInputError.textContent = '';
    if (el.timeDisplayWork) {
      el.timeDisplayWork.removeAttribute('aria-invalid');
      el.timeDisplayWork.removeAttribute('aria-describedby');
    }
    if (el.timeDisplayBreak) {
      el.timeDisplayBreak.removeAttribute('aria-invalid');
      el.timeDisplayBreak.removeAttribute('aria-describedby');
    }
  }
  function setTimeInputError(input) {
    if (!el.timeInputError) return;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', 'time-input-error');
    el.timeInputError.textContent = TIME_INPUT_ERROR_MSG;
  }
  if (el.timeDisplayWork) {
    el.timeDisplayWork.addEventListener('focus', clearTimeInputError);
    el.timeDisplayWork.addEventListener('blur', () => {
      const sec = parseTimeInput(el.timeDisplayWork.value);
      if (sec !== null) {
        clearTimeInputError();
        state.workRemainingSeconds = sec;
        state.workDuration = sec;
      } else {
        el.timeDisplayWork.value = formatTime(state.workRemainingSeconds);
        setTimeInputError(el.timeDisplayWork);
      }
      saveState();
      render();
    });
    el.timeDisplayWork.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.timeDisplayWork.blur();
    });
  }
  if (el.timeDisplayBreak) {
    el.timeDisplayBreak.addEventListener('focus', clearTimeInputError);
    el.timeDisplayBreak.addEventListener('blur', () => {
      const sec = parseTimeInput(el.timeDisplayBreak.value);
      if (sec !== null) {
        clearTimeInputError();
        state.breakRemainingSeconds = sec;
        state.breakDuration = sec;
      } else {
        el.timeDisplayBreak.value = formatTime(state.breakRemainingSeconds);
        setTimeInputError(el.timeDisplayBreak);
      }
      saveState();
      render();
    });
    el.timeDisplayBreak.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.timeDisplayBreak.blur();
    });
  }
}

init();