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
  timeDisplayWork: document.getElementById('time-display-work'),
  timeDisplayBreak: document.getElementById('time-display-break'),
  pauseBtn: document.getElementById('pause-btn'),
  presets: document.getElementById('presets'),
  progressWork: document.getElementById('progress-work'),
  progressBreak: document.getElementById('progress-break'),
  muteBtn: document.getElementById('mute-btn'),
  glowPulses: document.getElementById('glow-pulses'),
  ripples: document.getElementById('ripples'),
  dayLogSummary: document.getElementById('day-log-summary'),
  dayLogCycles: document.getElementById('day-log-cycles'),
  dayLogClear: document.getElementById('day-log-clear'),
  dayLogViewAll: document.getElementById('day-log-view-all'),
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

let glowPulseIndex = 0;

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
function recordCompletedCycle(breakElapsedSeconds) {
  ensureDayStarted();
  const breakTime = breakElapsedSeconds ?? state.breakDuration;
  state.completedCycles.push({
    completedAt: Date.now(),
    type: 'cycle',
    workDuration: state.workDuration,
    breakDuration: breakTime,
    intendedBreakDuration: state.breakDuration,
  });
}

/** Log the pending skipped-work entry (work was skipped, now break has finished or been skipped). */
function recordPendingSkippedWork(breakElapsedSeconds) {
  if (!state.pendingSkippedWork) return;
  ensureDayStarted();
  state.completedCycles.push({
    completedAt: Date.now(),
    type: 'skipped_work',
    workElapsedSeconds: state.pendingSkippedWork.workElapsedSeconds,
    workDuration: state.pendingSkippedWork.workDuration,
    breakElapsedSeconds,
    intendedBreakDuration: state.breakDuration,
  });
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
  if (document.activeElement !== el.timeDisplayWork) {
    el.timeDisplayWork.value = formatTime(state.workRemainingSeconds);
  }
  if (document.activeElement !== el.timeDisplayBreak) {
    el.timeDisplayBreak.value = formatTime(state.breakRemainingSeconds);
  }

  el.segmentWork.classList.toggle('timer__segment--active', state.currentMode === 'work');
  el.segmentBreak.classList.toggle('timer__segment--active', state.currentMode === 'break');
  el.segmentWork.setAttribute('aria-current', state.currentMode === 'work' ? 'true' : 'false');
  el.segmentBreak.setAttribute('aria-current', state.currentMode === 'break' ? 'true' : 'false');

  if (state.isRunning) {
    el.timerStatus.innerHTML = 'Pomodoro is <span class="timer__status-highlight">running</span>';
  } else {
    el.timerStatus.textContent = 'Pomodoro is paused';
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

  if (el.dayLogSummary && el.dayLogCycles) {
    const cyclesOnly = state.completedCycles.filter((e) => e.type !== 'skipped_work');
    const n = cyclesOnly.length;
    const totalEntries = state.completedCycles.length;
    if (n === 0) {
      el.dayLogSummary.textContent = 'No pomodoros completed yet.';
    } else {
      el.dayLogSummary.textContent = n === 1 ? '1 pomodoro completed' : `${n} pomodoros completed`;
    }
    if (el.dayLogClear) el.dayLogClear.hidden = totalEntries === 0;
    const sorted = [...state.completedCycles].sort((a, b) => b.completedAt - a.completedAt);
    const maxVisible = 5;
    const visibleEntries = logExpanded ? sorted : sorted.slice(0, maxVisible);
    el.dayLogCycles.innerHTML = visibleEntries
      .map((entry) => {
        if (entry.type === 'skipped_work') {
          const breakElapsed = entry.breakElapsedSeconds ?? 0;
          const breakShort = typeof entry.intendedBreakDuration === 'number' && breakElapsed < entry.intendedBreakDuration;
          const breakClass = breakShort ? 'day-log__dur day-log__dur--break day-log__dur--break-short' : 'day-log__dur day-log__dur--break';
          return `<li class="day-log__cycle"><span class="day-log__dur day-log__dur--work-skipped">${formatDuration(entry.workElapsedSeconds)}</span> + <span class="${breakClass}">${formatDuration(breakElapsed)}</span> <span class="day-log__sep">•</span> ${formatTimeOfDay(entry.completedAt)}</li>`;
        }
        const breakShort = typeof entry.intendedBreakDuration === 'number' && entry.breakDuration < entry.intendedBreakDuration;
        const breakClass = breakShort ? 'day-log__dur day-log__dur--break day-log__dur--break-short' : 'day-log__dur day-log__dur--break';
        return `<li class="day-log__cycle"><span class="day-log__dur day-log__dur--work">${formatDuration(entry.workDuration)}</span> + <span class="${breakClass}">${formatDuration(entry.breakDuration)}</span> <span class="day-log__sep">•</span> ${formatTimeOfDay(entry.completedAt)}</li>`;
      })
      .join('');
    if (el.dayLogViewAll) {
      if (totalEntries > maxVisible) {
        el.dayLogViewAll.hidden = false;
        el.dayLogViewAll.textContent = logExpanded ? 'show less' : 'view all';
        el.dayLogViewAll.setAttribute('aria-label', logExpanded ? 'Show fewer log entries' : `Show all ${totalEntries} log entries`);
      } else {
        el.dayLogViewAll.hidden = true;
      }
    }
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

/** If in break and any time elapsed, record cycle or skipped-work to log and clear flags. */
function flushBreakToLogIfElapsed() {
  if (state.currentMode !== 'break') return;
  const breakElapsed = state.breakDuration - state.breakRemainingSeconds;
  if (breakElapsed <= 0) return;
  if (state.pendingSkippedWork) {
    recordPendingSkippedWork(breakElapsed);
  } else if (state.workSegmentCompletedByTimer) {
    recordCompletedCycle(breakElapsed);
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

function restart() {
  stop();
  setTimeRemaining(getDuration(state.currentMode));
  saveState();
  render();
}

function skip() {
  if (state.currentMode === 'break') {
    flushBreakToLogIfElapsed();
  } else if (state.currentMode === 'work') {
    if (state.isRunning) {
      if (state.workRemainingSeconds <= 1) {
        state.workSegmentCompletedByTimer = true;
      } else {
        state.pendingSkippedWork = {
          workElapsedSeconds: state.workDuration - state.workRemainingSeconds,
          workDuration: state.workDuration,
        };
        state.workSegmentCompletedByTimer = false;
      }
    } else {
      const workElapsed = state.workDuration - state.workRemainingSeconds;
      if (workElapsed > 0) {
        state.pendingSkippedWork = {
          workElapsedSeconds: workElapsed,
          workDuration: state.workDuration,
        };
        state.workSegmentCompletedByTimer = false;
      }
    }
  }
  if (state.currentMode === 'work') {
    state.workRemainingSeconds = state.workDuration;
  } else {
    state.breakRemainingSeconds = state.breakDuration;
  }
  state.currentMode = state.currentMode === 'work' ? 'break' : 'work';
  saveState();
  render();
}

function clearLog() {
  state.completedCycles = [];
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
  if (el.dayLogViewAll) {
    el.dayLogViewAll.addEventListener('click', () => {
      logExpanded = !logExpanded;
      render();
    });
  }
  el.timer.addEventListener('click', (e) => {
    if (e.target.closest('.timer__btn--restart')) restart();
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