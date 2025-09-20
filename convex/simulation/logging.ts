import { CausalLink, SimulationLogEntry } from './types';

export class SimulationLogger {
  private logs: SimulationLogEntry[] = [];
  private causal: CausalLink[] = [];

  constructor(private enabled: { events: boolean; causal: boolean }) {}

  record(log: SimulationLogEntry) {
    if (!this.enabled.events) return;
    this.logs.push(log);
  }

  link(source: string, target: string, weight: number) {
    if (!this.enabled.causal) return;
    this.causal.push({ source, target, weight });
  }

  flush() {
    const entries = this.logs;
    const causal = this.causal;
    this.logs = [];
    this.causal = [];
    return { entries, causal };
  }
}

