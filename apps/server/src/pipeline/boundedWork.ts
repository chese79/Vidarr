// Bound subprocess-heavy source collection independently of provider HTTP limits.
export class BoundedWorkQueue {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw Error('Invalid concurrency');
  }
  run<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        Promise.resolve().then(work).then(resolve, reject).finally(() => {
          this.active--;
          this.waiting.shift()?.();
        });
      };
      if (this.active < this.concurrency) start(); else this.waiting.push(start);
    });
  }
}
