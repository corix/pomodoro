// Pomodoro Timer – MVP (both timers visible, auto-switch at zero)

const WORK_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;

const el = {
  timer: document.querySelector('.timer'),
  timerStatus: document.getElementById('timer-status'),
  segmentWork: document.getElementById('segment-work'),
  segmentBreak: document.getElementById('segment-break'),
  timeDisplayWork: document.getElementById('time-display-work'),
  timeDisplayBreak: document.getElementById('time-display-break'),
  pauseBtn: document.getElementById('pause-btn'),
  presets: document.getElementById('presets'),
};

let state = {
  workRemainingSeconds: WORK_SECONDS,
  breakRemainingSeconds: BREAK_SECONDS,
  workDuration: WORK_SECONDS,
  breakDuration: BREAK_SECONDS,
  activeMode: 'work',
  isRunning: false,
  intervalId: null,
};

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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

function getActiveRemaining() {
  return state.activeMode === 'work' ? state.workRemainingSeconds : state.breakRemainingSeconds;
}

function setActiveRemaining(seconds) {
  if (state.activeMode === 'work') {
    state.workRemainingSeconds = seconds;
  } else {
    state.breakRemainingSeconds = seconds;
  }
}

function getSegmentDuration(mode) {
  return mode === 'work' ? state.workDuration : state.breakDuration;
}

function render() {
  if (document.activeElement !== el.timeDisplayWork) {
    el.timeDisplayWork.value = formatTime(state.workRemainingSeconds);
  }
  if (document.activeElement !== el.timeDisplayBreak) {
    el.timeDisplayBreak.value = formatTime(state.breakRemainingSeconds);
  }

  el.segmentWork.classList.toggle('timer__segment--active', state.activeMode === 'work');
  el.segmentBreak.classList.toggle('timer__segment--active', state.activeMode === 'break');
  el.segmentWork.setAttribute('aria-current', state.activeMode === 'work' ? 'true' : 'false');
  el.segmentBreak.setAttribute('aria-current', state.activeMode === 'break' ? 'true' : 'false');

  if (state.isRunning) {
    el.timerStatus.innerHTML = 'Pomodoro is <span class="timer__status-highlight">running</span>';
  } else {
    el.timerStatus.textContent = 'Pomodoro is paused';
  }
  el.pauseBtn.setAttribute('aria-label', state.isRunning ? 'Stop timer' : 'Start timer');
  el.pauseBtn.setAttribute('data-state', state.isRunning ? 'running' : 'stopped');
}

function tick() {
  const current = getActiveRemaining();
  if (current <= 0) return;
  setActiveRemaining(current - 1);
  if (getActiveRemaining() <= 0) {
    setActiveRemaining(getSegmentDuration(state.activeMode));
    state.activeMode = state.activeMode === 'work' ? 'break' : 'work';
  }
  render();
}

function setActiveMode(mode) {
  if (state.isRunning) pause();
  state.activeMode = mode;
  render();
}

function pause() {
  if (!state.isRunning) return;
  state.isRunning = false;
  if (state.intervalId !== null) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  render();
}

function start() {
  if (state.isRunning) return;
  state.isRunning = true;
  state.intervalId = setInterval(tick, 1000);
  render();
}

function togglePause() {
  if (state.isRunning) pause();
  else start();
}

function restart() {
  pause();
  setActiveRemaining(getSegmentDuration(state.activeMode));
  render();
}

function skip() {
  if (state.activeMode === 'work') {
    state.workRemainingSeconds = state.workDuration;
  } else {
    state.breakRemainingSeconds = state.breakDuration;
  }
  state.activeMode = state.activeMode === 'work' ? 'break' : 'work';
  render();
}

function newPomodoroPreset(workMinutes, breakMinutes) {
  pause();
  const workSec = workMinutes * 60;
  const breakSec = breakMinutes * 60;
  state.workRemainingSeconds = workSec;
  state.breakRemainingSeconds = breakSec;
  state.workDuration = workSec;
  state.breakDuration = breakSec;
  state.activeMode = 'work';
  render();
}

function init() {
  render();

  el.pauseBtn.addEventListener('click', togglePause);
  el.timer.addEventListener('click', (e) => {
    if (e.target.closest('.timer__btn--restart')) restart();
    if (e.target.closest('.timer__btn--skip')) skip();
  });
  el.presets.addEventListener('click', (e) => {
    const btn = e.target.closest('.timer__btn--new-pomodoro');
    if (!btn) return;
    const work = parseInt(btn.dataset.work, 10);
    const breakMin = parseInt(btn.dataset.break, 10);
    if (!Number.isNaN(work) && !Number.isNaN(breakMin)) newPomodoroPreset(work, breakMin);
  });

  el.timeDisplayWork.addEventListener('blur', () => {
    const sec = parseTimeInput(el.timeDisplayWork.value);
    if (sec !== null) {
      state.workRemainingSeconds = sec;
      state.workDuration = sec;
    } else {
      el.timeDisplayWork.value = formatTime(state.workRemainingSeconds);
    }
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
    render();
  });
  el.timeDisplayBreak.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.timeDisplayBreak.blur();
  });
}

init();