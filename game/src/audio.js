// Sound, synthesized with WebAudio only: no audio files, no network. A shared noise
// buffer and a few oscillator envelopes cover shots, reloads, hits, explosions,
// plant beeps and round stings. Everything is a no-op until the first user gesture
// creates the context, so headless captures stay silent and safe.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      const length = ctx.sampleRate;
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
      return false;
    }
    return true;
  }

  function noise(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + duration);
  }

  function tone(freq, duration, gainValue, type = 'sine', slideTo = 0) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + duration);
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    shot(kind) {
      if (!ensure()) return;
      if (kind === 'sniper') {
        noise(0.28, 900, 0.9);
        tone(140, 0.22, 0.5, 'sawtooth', 50);
      } else if (kind === 'pistol') {
        noise(0.09, 1800, 0.55);
        tone(220, 0.08, 0.3, 'square', 90);
      } else if (kind === 'smg') {
        noise(0.07, 2200, 0.45);
      } else {
        noise(0.12, 1500, 0.65);
        tone(180, 0.1, 0.35, 'sawtooth', 70);
      }
    },
    enemyShot(dist) {
      if (!ensure()) return;
      const gain = Math.max(0.08, 0.5 - dist * 0.008);
      noise(0.1, 1200, gain);
    },
    dryClick() {
      if (!ensure()) return;
      tone(900, 0.04, 0.25, 'square');
    },
    reload() {
      if (!ensure()) return;
      tone(500, 0.05, 0.2, 'square');
      setTimeout(() => tone(650, 0.05, 0.2, 'square'), 220);
      setTimeout(() => tone(800, 0.05, 0.2, 'square'), 480);
    },
    hit(killed) {
      if (!ensure()) return;
      tone(killed ? 1320 : 990, 0.07, 0.3, 'sine');
      if (killed) setTimeout(() => tone(1760, 0.09, 0.3, 'sine'), 70);
    },
    hurt() {
      if (!ensure()) return;
      tone(110, 0.18, 0.5, 'sawtooth', 60);
    },
    explosion() {
      if (!ensure()) return;
      noise(1.1, 320, 1.0);
      tone(70, 0.9, 0.8, 'sine', 28);
    },
    beep() {
      if (!ensure()) return;
      tone(1180, 0.09, 0.3, 'sine');
    },
    plant() {
      if (!ensure()) return;
      tone(880, 0.12, 0.3, 'sine');
      setTimeout(() => tone(880, 0.12, 0.3, 'sine'), 160);
    },
    roundWin() {
      if (!ensure()) return;
      [523, 659, 784].forEach((freq, i) => setTimeout(() => tone(freq, 0.22, 0.3, 'triangle'), i * 130));
    },
    roundLose() {
      if (!ensure()) return;
      [392, 330, 262].forEach((freq, i) => setTimeout(() => tone(freq, 0.25, 0.3, 'triangle'), i * 140));
    },
    click() {
      if (!ensure()) return;
      tone(700, 0.04, 0.2, 'sine');
    },
    throwWhoosh() {
      if (!ensure()) return;
      noise(0.25, 900, 0.3, 'bandpass');
    },
    step() {
      if (!ensure()) return;
      noise(0.06, 420, 0.13);
    },
  };
}
