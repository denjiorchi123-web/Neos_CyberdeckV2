"use client";

// ─── Pure-JS WAV synthesis ────────────────────────────────────────────────────
// Generates audio entirely with Math.sin — no AudioContext, no user gesture
// required. Used for the incoming ringtone and call-ended chime.

function buildWavBlob(
  genSample: (i: number, sampleRate: number) => number,
  durationSec: number,
  sampleRate = 22050,
): Blob {
  const n = Math.floor(sampleRate * durationSec);
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const pcm = new Int16Array(buf, 44);

  const w4 = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };

  w4(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true);
  w4(8, "WAVE"); w4(12, "fmt ");
  dv.setUint32(16, 16, true);             // fmt chunk size
  dv.setUint16(20, 1, true);              // PCM
  dv.setUint16(22, 1, true);              // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate
  dv.setUint16(32, 2, true);              // block align
  dv.setUint16(34, 16, true);             // 16-bit
  w4(36, "data"); dv.setUint32(40, n * 2, true);

  for (let i = 0; i < n; i++) {
    pcm[i] = Math.round(Math.max(-1, Math.min(1, genSample(i, sampleRate))) * 32767);
  }
  return new Blob([buf], { type: "audio/wav" });
}

// Ring burst: two overlapping high-pitched tones (880+960 Hz) with 40 ms fade-out.
// Intentionally different from the outgoing CallTone (440+480 Hz) so the two sides
// never hear the same sound.
function makeRingBurst(): Blob {
  return buildWavBlob((i, sr) => {
    const t = i / sr;
    const duration = 0.4;
    const env = Math.min(1, (duration - t) / 0.04);
    return ((Math.sin(2 * Math.PI * 880 * t) + Math.sin(2 * Math.PI * 960 * t)) / 2) * env * 0.35;
  }, 0.4);
}

// Call-ended chime: frequency sweeps 440 → 260 Hz over 0.5 s with fade-out
function makeCallEndedChime(): Blob {
  const duration = 0.5;
  let phase = 0;
  return buildWavBlob((i, sr) => {
    const progress = i / (sr * duration);
    const freq = 440 - progress * 180;
    phase += (2 * Math.PI * freq) / sr;
    const env = Math.max(0, 1 - progress * 1.1);
    return Math.sin(phase) * env * 0.4;
  }, duration);
}

// Lazy blob URL cache — created once on first use
let _ringBurstUrl: string | null = null;
let _callEndedUrl: string | null = null;

function getRingBurstUrl(): string {
  if (!_ringBurstUrl && typeof window !== "undefined") {
    _ringBurstUrl = URL.createObjectURL(makeRingBurst());
  }
  return _ringBurstUrl ?? "";
}

function getCallEndedUrl(): string {
  if (!_callEndedUrl && typeof window !== "undefined") {
    _callEndedUrl = URL.createObjectURL(makeCallEndedChime());
  }
  return _callEndedUrl ?? "";
}

// ─── IncomingRingtone ─────────────────────────────────────────────────────────
// HTML Audio + synthesized WAV blob — no AudioContext, no user gesture needed.
// Pattern: ring 0.4 s → gap 0.2 s → ring 0.4 s → silence 2 s → repeat.

export class IncomingRingtone {
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  play() {
    if (this.active || typeof window === "undefined") return;
    this.active = true;
    this.step1();
  }

  stop() {
    this.active = false;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }

  private burst(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.active) { resolve(); return; }
      const url = getRingBurstUrl();
      if (!url) { resolve(); return; }
      const a = new Audio(url);
      a.onended = () => resolve();
      a.onerror = () => resolve();
      a.play().catch(() => resolve());
    });
  }

  private step1() {
    if (!this.active) return;
    this.burst().then(() => {
      if (!this.active) return;
      this.timer = setTimeout(() => {
        if (!this.active) return;
        this.burst().then(() => {
          if (!this.active) return;
          this.timer = setTimeout(() => this.step1(), 2000);
        });
      }, 200);
    });
  }
}

// ─── CallTone (outgoing ringback) ─────────────────────────────────────────────
// Uses Web Audio API — safe because the caller clicked a button (user gesture)
// moments before MediaRoom mounted. Pattern: 1 s tone → 4 s silence → repeat.

export class CallTone {
  private audioCtx: AudioContext | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  play() {
    if (this.active || typeof window === "undefined") return;
    this.active = true;
    this.start();
  }

  stop() {
    this.active = false;
    if (this.loopTimer !== null) { clearTimeout(this.loopTimer); this.loopTimer = null; }
    try { this.audioCtx?.close(); } catch { /* noop */ }
    this.audioCtx = null;
  }

  private async start() {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AC();
      if (this.audioCtx.state === "suspended") await this.audioCtx.resume();
      this.tick();
    } catch (err) {
      console.warn("[CyberDeck:CallTone] AudioContext failed:", err);
    }
  }

  private tick() {
    if (!this.active || !this.audioCtx) return;
    const ctx = this.audioCtx;
    this.tone(ctx, [440, 480], 1.0).then(() => {
      if (!this.active) return;
      this.loopTimer = setTimeout(() => this.tick(), 4000);
    });
  }

  private tone(ctx: AudioContext, freqs: number[], duration: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.active) { resolve(); return; }
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration - 0.02);
      gain.connect(ctx.destination);
      freqs.forEach((freq) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
      });
      setTimeout(resolve, duration * 1000);
    });
  }
}

// ─── Call-ended chime ─────────────────────────────────────────────────────────
// One-shot descending tone played when the call ends.

export function playCallEndedSound(): void {
  if (typeof window === "undefined") return;
  try {
    const url = getCallEndedUrl();
    if (!url) return;
    const a = new Audio(url);
    a.volume = 0.55;
    a.play().catch(() => {});
  } catch { /* noop */ }
}
