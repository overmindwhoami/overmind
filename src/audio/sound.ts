import { RATE, damp } from '../../design-system/motion';

/**
 * Overmind's generative score. Same architecture as the reference (synthesized, no files, brightness tied to
 * spin velocity, panned UI sounds) with an original progression and instruments. Opt-in only: the toggle or the M key.
 */
const BPM = 78;
const STEP = 60 / BPM / 4;
const SWING = 0.12;
const LOOKAHEAD = 0.15;
const PROGRESSION = [
  { bass: 45, keys: [60, 64, 67, 71] }, // Am9 (no root)
  { bass: 41, keys: [57, 60, 64, 71] }, // Fmaj7#11
  { bass: 48, keys: [64, 67, 71, 74] }, // Cmaj9
  { bass: 40, keys: [62, 67, 71, 74] }, // Em7add11
];
const SHIMMER = [69, 72, 74, 76, 79, 81]; // A minor pentatonic
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

interface Graph { ctx: AudioContext; master: GainNode; music: GainNode; tone: BiquadFilterNode; effects: GainNode; noise: AudioBuffer }

export class Sound {
  enabled = false;
  private graph?: Graph;
  private rate = 0;
  private energy = 0;
  private next = 0;
  private step = 0;

  constructor(private button: HTMLButtonElement | null) {
    this.button?.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(!this.enabled); });
    document.addEventListener('visibilitychange', () => {
      const ctx = this.graph?.ctx;
      if (!ctx) return;
      if (document.hidden) void ctx.suspend(); else if (this.enabled) void ctx.resume();
    });
    this.render();
  }

  private build(): Graph {
    const ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    comp.ratio.value = 3; comp.threshold.value = -18; comp.connect(ctx.destination);
    const master = ctx.createGain(); master.gain.value = 0; master.connect(comp);
    const verb = ctx.createConvolver();
    const len = Math.round(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6; }
    verb.buffer = ir; verb.connect(master);
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 900; tone.Q.value = 0.4;
    const send = ctx.createGain(); send.gain.value = 0.28;
    tone.connect(master); tone.connect(send).connect(verb);
    const music = ctx.createGain(); music.gain.value = 0.6; music.connect(tone);
    const effects = ctx.createGain(); effects.connect(master);
    const fxSend = ctx.createGain(); fxSend.gain.value = 0.3; effects.connect(fxSend).connect(verb);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // air bed: very quiet filtered noise
    const bed = ctx.createBufferSource(); bed.buffer = noise; bed.loop = true;
    const bedFilter = ctx.createBiquadFilter(); bedFilter.type = 'bandpass'; bedFilter.frequency.value = 3200; bedFilter.Q.value = 0.5;
    const bedGain = ctx.createGain(); bedGain.gain.value = 0.018;
    bed.connect(bedFilter).connect(bedGain).connect(music); bed.start();
    return { ctx, master, music, tone, effects, noise };
  }

  private pad(note: number, at: number, length: number, gain: number) {
    const g = this.graph; if (!g) return;
    const env = g.ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.25);
    env.gain.setTargetAtTime(gain * 0.6, at + 0.25, 0.6);
    env.gain.setTargetAtTime(0, at + length, 0.4);
    env.connect(g.music);
    for (const [ratio, level, detune, type] of [[1, 1, -6, 'sine'], [1, 0.35, 7, 'triangle'], [3, 0.06, 0, 'sine']] as const) {
      const o = g.ctx.createOscillator(), l = g.ctx.createGain();
      o.type = type; o.frequency.value = hz(note) * ratio; o.detune.value = detune; l.gain.value = level;
      o.connect(l).connect(env); o.start(at); o.stop(at + length + 2);
    }
  }

  private bass(note: number, at: number, length: number) {
    const g = this.graph; if (!g) return;
    const o = g.ctx.createOscillator(), f = g.ctx.createBiquadFilter(), env = g.ctx.createGain();
    o.type = 'sine'; o.frequency.value = hz(note);
    f.type = 'lowpass'; f.frequency.value = 300;
    env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(0.28, at + 0.03); env.gain.setTargetAtTime(0, at + length, 0.12);
    o.connect(f).connect(env).connect(g.music); o.start(at); o.stop(at + length + 1);
  }

  private pulse(at: number, gain: number) {
    const g = this.graph; if (!g) return;
    const o = g.ctx.createOscillator(), env = g.ctx.createGain();
    o.frequency.setValueAtTime(90, at); o.frequency.exponentialRampToValueAtTime(45, at + 0.14);
    env.gain.setValueAtTime(gain, at); env.gain.exponentialRampToValueAtTime(1e-4, at + 0.36);
    o.connect(env).connect(g.music); o.start(at); o.stop(at + 0.4);
  }

  private hiss(at: number, frequency: number, gain: number, length: number, destination?: AudioNode, pan = 0) {
    const g = this.graph; if (!g) return;
    const s = g.ctx.createBufferSource(), f = g.ctx.createBiquadFilter(), env = g.ctx.createGain(), p = g.ctx.createStereoPanner();
    s.buffer = g.noise; f.type = 'bandpass'; f.frequency.value = frequency; f.Q.value = 1.2;
    env.gain.setValueAtTime(gain, at); env.gain.exponentialRampToValueAtTime(1e-4, at + length);
    p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(f).connect(env).connect(p).connect(destination ?? g.music); s.start(at, Math.random()); s.stop(at + length + 0.02);
  }

  private schedule(step: number, at: number) {
    const n = step % 16, bar = Math.floor(step / 16), chord = PROGRESSION[bar % PROGRESSION.length], beat = 60 / BPM;
    if (n === 0) { chord.keys.forEach((k, i) => this.pad(k, at + i * 0.02, beat * 3.6, 0.05)); this.bass(chord.bass, at, beat * 2); }
    if (n === 8) this.bass(chord.bass + 12, at, beat * 0.6);
    if (n === 0 || n === 8) this.pulse(at, 0.32);
    if (n === 4 || n === 12) this.hiss(at, 6500, 0.025, 0.05);
    if (n % 2 === 1 && this.energy > 0.5) this.hiss(at, 9000, 0.012 * this.energy, 0.03);
    if ((n === 3 || n === 7 || n === 11 || n === 14) && Math.random() < 0.22 + this.energy * 0.3) {
      const note = SHIMMER[Math.floor(Math.random() * SHIMMER.length)];
      this.pad(note + 12, at, beat * 0.5, 0.022);
    }
  }

  /** Call every frame. `rate` is |spin velocity| / idle spin. */
  update(dt: number, rate: number, volume: number) {
    this.rate += (Math.abs(rate) - this.rate) * damp(RATE.mechanism, dt);
    this.energy = clamp01(this.rate / 2.5);
    const g = this.graph;
    if (!g || !this.enabled) return;
    const now = g.ctx.currentTime, l = clamp01(this.rate);
    g.master.gain.setTargetAtTime(volume * 0.9, now, 0.15);
    g.music.gain.setTargetAtTime(0.55 + l * 0.3, now, 0.2);
    g.tone.frequency.setTargetAtTime(600 + l * 5000 + this.energy * 3000, now, 0.2);
    if (this.next < now - 0.25) { this.next = now + 0.05; this.step = Math.ceil(this.step / 16) * 16; }
    while (this.next < now + LOOKAHEAD) {
      this.schedule(this.step, this.next + (this.step % 2 === 1 ? STEP * SWING : 0));
      this.next += STEP;
      this.step++;
    }
  }

  private chime(notes: number[], pan: number, gain: number) {
    const g = this.graph; if (!g || !this.enabled) return;
    notes.forEach((m, i) => {
      const at = g.ctx.currentTime + i * 0.05, o = g.ctx.createOscillator(), env = g.ctx.createGain(), p = g.ctx.createStereoPanner();
      o.type = 'sine'; o.frequency.value = hz(m);
      env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(gain, at + 0.006); env.gain.exponentialRampToValueAtTime(1e-4, at + 0.4);
      p.pan.value = Math.max(-1, Math.min(1, pan));
      o.connect(env).connect(p).connect(g.effects); o.start(at); o.stop(at + 0.45);
    });
  }
  lock = (pan: number) => this.chime([81, 84, 88], pan, 0.04);
  tick = (pan: number) => { const g = this.graph; if (g && this.enabled) this.hiss(g.ctx.currentTime, 6000 + Math.random() * 2000, 0.03, 0.012, g.effects, pan); };
  select = (pan: number) => {
    const g = this.graph; if (!g || !this.enabled) return;
    const at = g.ctx.currentTime, o = g.ctx.createOscillator(), env = g.ctx.createGain();
    o.frequency.setValueAtTime(140, at); o.frequency.exponentialRampToValueAtTime(70, at + 0.18);
    env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(0.1, at + 0.006); env.gain.exponentialRampToValueAtTime(1e-4, at + 0.2);
    o.connect(env).connect(g.effects); o.start(at); o.stop(at + 0.22);
    this.hiss(at, 1600, 0.06, 0.06, g.effects, pan);
  };

  toggle(on: boolean) {
    this.graph ??= this.build();
    const { ctx, master } = this.graph;
    this.enabled = on;
    if (on) { void ctx.resume(); this.next = ctx.currentTime + 0.05; this.step = 0; }
    else master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    this.render();
  }

  private render() {
    if (!this.button) return;
    this.button.setAttribute('aria-label', this.enabled ? 'Turn sound off' : 'Turn sound on');
    this.button.setAttribute('aria-pressed', String(this.enabled));
  }
}
