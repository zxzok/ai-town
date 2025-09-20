export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next() {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  integer(max: number) {
    return Math.floor(this.next() * max);
  }

  range(min: number, max: number) {
    return min + (max - min) * this.next();
  }

  pick<T>(items: T[]): T {
    if (!items.length) {
      throw new Error('Cannot pick from empty list');
    }
    return items[this.integer(items.length)];
  }
}

