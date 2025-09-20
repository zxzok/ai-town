import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const hadzaTables = {
  hadzaRuns: defineTable({
    scenario: v.string(),
    status: v.union(v.literal('running'), v.literal('paused'), v.literal('completed')),
    startedAt: v.number(),
    currentDay: v.number(),
    state: v.string(),
  }).index('status', ['status']),
  hadzaEvents: defineTable({
    runId: v.id('hadzaRuns'),
    day: v.number(),
    agentId: v.optional(v.string()),
    eventType: v.string(),
    summary: v.string(),
    detail: v.string(),
    createdAt: v.number(),
  }).index('runDay', ['runId', 'day']),
  hadzaDailyMetrics: defineTable({
    runId: v.id('hadzaRuns'),
    day: v.number(),
    cooperationRate: v.number(),
    energyBalance: v.number(),
    riskIncidents: v.number(),
    inequalityIndex: v.number(),
    networkAssortativity: v.number(),
    reciprocity: v.number(),
  }).index('runDay', ['runId', 'day']),
  hadzaNetworkSnapshots: defineTable({
    runId: v.id('hadzaRuns'),
    day: v.number(),
    stats: v.object({
      reciprocity: v.number(),
      assortativity: v.number(),
      clustering: v.number(),
    }),
    edges: v.string(),
  }).index('runDay', ['runId', 'day']),
};

