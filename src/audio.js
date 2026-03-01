// Pomodoro Timer – audio (beeps, ding-dong). Mute is checked by caller (main.js).

let audioContext = null;

export function getAudioContext() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  return audioContext;
}

export function playBeep(options = {}) {
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

export function playSegmentEndSound() {
  playBeep({ frequency: 440, duration: 1.15 });
}

export function playDingDong() {
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
