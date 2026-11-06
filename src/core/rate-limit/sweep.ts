export const DEFAULT_SWEEP_WINDOW_MS = 300_000;

/** Times are supplied by a monotonic clock in milliseconds. */
export class SweepDetector {
  private readonly lists = new Map<string, { remaining: Set<string>; listedAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  onList(sandboxId: string, names: readonly string[]): void {
    if (names.length === 0) {
      this.lists.delete(sandboxId);
      return;
    }
    this.lists.set(sandboxId, { remaining: new Set(names), listedAt: this.now() });
  }

  onGet(sandboxId: string, name: string): { alert: boolean } {
    const list = this.lists.get(sandboxId);
    if (list === undefined) return { alert: false };
    if (this.now() - list.listedAt > this.windowMs) {
      this.lists.delete(sandboxId);
      return { alert: false };
    }
    list.remaining.delete(name);
    if (list.remaining.size > 0) return { alert: false };
    this.lists.delete(sandboxId);
    return { alert: true };
  }
}
