/**
 * Adaptive pixel ratio. Same steps as the reference (0.75 → min(DPR, 2) in 0.25 increments, 1 s cooldown,
 * failed ratios blocked for 20 s), but judged against the display's measured refresh interval and the batch
 * median. The reference compared against the single fastest frame ever seen, which jitter can make unreachable,
 * leaving retina screens stuck at 1.0 (see docs/reference-bizarro/06-runtime.md §6.8).
 */
export class Resolution {
  ratio: number;
  private time = 0;
  private cooldown = 3;
  private settled = 0;
  private batch: number[] = [];
  private history: number[] = [];
  private failures = new Map<number, number>();

  constructor(public maximum: number, public minimum = 0.75, start = 1) {
    this.minimum = Math.min(minimum, maximum);
    this.ratio = Math.min(start, maximum);
  }

  /** Returns true when the ratio changed and the renderer must be resized. */
  update(dt: number, targetFps: number): boolean {
    if (dt <= 0) return false;
    this.time += dt;
    this.history.push(dt);
    if (this.history.length > 120) this.history.shift();
    const sorted = [...this.history].sort((a, b) => a - b);
    const refresh = sorted[Math.floor(sorted.length * 0.1)] ?? dt;
    const budget = Math.max(refresh, 1 / targetFps);
    if (this.cooldown > 0) { this.cooldown -= dt; this.batch = []; return false; }
    this.batch.push(dt);
    if (this.batch.length < 30) return false;
    const median = this.batch.sort((a, b) => a - b)[15];
    this.batch = [];
    if (median > budget * 1.15 && this.ratio > this.minimum) {
      this.failures.set(this.ratio, this.time);
      return this.change(Math.max(this.minimum, this.ratio - 0.25));
    }
    this.settled = median < budget * 1.05 ? this.settled + median * 30 : 0;
    const next = Math.min(this.maximum, this.ratio + 0.25);
    const failedAt = this.failures.get(next);
    return this.settled > 2 && next > this.ratio && (failedAt === undefined || this.time - failedAt > 20) ? this.change(next) : false;
  }

  private change(r: number) {
    this.ratio = r;
    this.settled = 0;
    this.cooldown = 1;
    this.history = [];
    return true;
  }
}
