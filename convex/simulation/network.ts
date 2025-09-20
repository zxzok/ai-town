import { NetworkEdge, NetworkState, ScenarioConfig } from './types';

function makeKey(source: string, target: string) {
  return `${source}|${target}`;
}

export interface NetworkStats {
  reciprocity: number;
  assortativity: number;
  clustering: number;
}

export class SocialNetwork {
  private edges: Map<string, NetworkEdge> = new Map();
  private forgetFactor: number;
  private campMembership: Record<string, string>;
  private config: ScenarioConfig;

  constructor(config: ScenarioConfig, initial?: NetworkState) {
    this.config = config;
    this.forgetFactor = initial?.forgetFactor ?? config.network.decay;
    this.campMembership = initial?.campMembership ?? {};
    if (initial?.edges) {
      initial.edges.forEach((edge) => {
        this.edges.set(makeKey(edge.source, edge.target), { ...edge });
      });
    }
  }

  static initialize(config: ScenarioConfig, agentIds: string[], campMembership: Record<string, string>) {
    const state: NetworkState = {
      edges: [],
      forgetFactor: config.network.decay,
      campMembership,
    };
    return new SocialNetwork(config, state);
  }

  toState(): NetworkState {
    return {
      edges: [...this.edges.values()].map((edge) => ({ ...edge })),
      forgetFactor: this.forgetFactor,
      campMembership: { ...this.campMembership },
    };
  }

  applyDecay() {
    const decay = 1 - this.forgetFactor;
    [...this.edges.entries()].forEach(([key, edge]) => {
      const newWeight = edge.weight * decay;
      if (newWeight < 0.01) {
        this.edges.delete(key);
      } else {
        edge.weight = newWeight;
        this.edges.set(key, edge);
      }
    });
  }

  reinforceInteraction(source: string, target: string, delta: number) {
    const key = makeKey(source, target);
    const existing = this.edges.get(key);
    const updated: NetworkEdge = existing
      ? { ...existing, weight: existing.weight + delta }
      : { source, target, weight: delta };
    this.edges.set(key, updated);
  }

  computeStats(): NetworkStats {
    const adjacency = new Map<string, Set<string>>();
    let reciprocalCount = 0;
    let totalEdges = 0;
    this.edges.forEach((edge) => {
      totalEdges += 1;
      if (!adjacency.has(edge.source)) {
        adjacency.set(edge.source, new Set());
      }
      adjacency.get(edge.source)!.add(edge.target);
      if (this.edges.has(makeKey(edge.target, edge.source))) {
        reciprocalCount += 1;
      }
    });
    const reciprocity = totalEdges ? reciprocalCount / totalEdges : 0;

    let sameCamp = 0;
    let knownCampEdges = 0;
    this.edges.forEach((edge) => {
      const sourceCamp = this.campMembership[edge.source];
      const targetCamp = this.campMembership[edge.target];
      if (sourceCamp && targetCamp) {
        knownCampEdges += 1;
        if (sourceCamp === targetCamp) {
          sameCamp += 1;
        }
      }
    });
    const assortativity = knownCampEdges ? sameCamp / knownCampEdges : 0.5;

    let triads = 0;
    let closedTriads = 0;
    adjacency.forEach((neighbors, node) => {
      const arr = [...neighbors];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          triads += 1;
          const ni = adjacency.get(arr[i]);
          if (ni && ni.has(arr[j])) {
            closedTriads += 1;
          }
        }
      }
    });
    const clustering = triads ? closedTriads / triads : 0;

    return { reciprocity, assortativity, clustering };
  }

  mergeCampMembership(membership: Record<string, string>) {
    this.campMembership = { ...this.campMembership, ...membership };
  }
}

