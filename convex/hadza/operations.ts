import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery, mutation, query } from '../_generated/server';
import { internal } from '../_generated/api';
import { getScenarioConfig } from '../simulation/scenarioLoader';
import { CooperationSimulation } from '../simulation/simulation';
import { SimulationState } from '../simulation/types';

const hadzaInternal = internal as any;

export const startSimulationRun = mutation({
  args: {
    scenario: v.string(),
    seed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const config = getScenarioConfig(args.scenario);
    const simulation = CooperationSimulation.initialize(config, args.seed ?? Date.now());
    const state = simulation.serialize();
    const runId = await ctx.db.insert('hadzaRuns', {
      scenario: config.name,
      status: 'running',
      startedAt: Date.now(),
      currentDay: state.environment.day,
      state: JSON.stringify(state),
    });
    return runId;
  },
});

export const loadRun = internalQuery({
  args: { runId: v.id('hadzaRuns') },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error(`Run ${args.runId} not found`);
    return run;
  },
});

export const persistStep = internalMutation({
  args: {
    runId: v.id('hadzaRuns'),
    state: v.string(),
    day: v.number(),
    metrics: v.object({
      cooperationRate: v.number(),
      energyBalance: v.number(),
      riskIncidents: v.number(),
      inequalityIndex: v.number(),
      networkAssortativity: v.number(),
      reciprocity: v.number(),
    }),
    logs: v.array(
      v.object({
        day: v.number(),
        agentId: v.optional(v.string()),
        type: v.string(),
        summary: v.string(),
        detail: v.string(),
      }),
    ),
    networkStats: v.object({ reciprocity: v.number(), assortativity: v.number(), clustering: v.number() }),
    edges: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, { state: args.state, currentDay: args.day });
    await ctx.db.insert('hadzaDailyMetrics', {
      runId: args.runId,
      day: args.day,
      cooperationRate: args.metrics.cooperationRate,
      energyBalance: args.metrics.energyBalance,
      riskIncidents: args.metrics.riskIncidents,
      inequalityIndex: args.metrics.inequalityIndex,
      networkAssortativity: args.metrics.networkAssortativity,
      reciprocity: args.metrics.reciprocity,
    });
    for (const log of args.logs) {
      await ctx.db.insert('hadzaEvents', {
        runId: args.runId,
        day: log.day,
        agentId: log.agentId,
        eventType: log.type,
        summary: log.summary,
        detail: log.detail,
        createdAt: Date.now(),
      });
    }
    await ctx.db.insert('hadzaNetworkSnapshots', {
      runId: args.runId,
      day: args.day,
      stats: args.networkStats,
      edges: args.edges,
    });
  },
});

export const advanceSimulationRun = internalAction({
  args: { runId: v.id('hadzaRuns') },
  handler: async (ctx, args) => {
    const run = await ctx.runQuery(hadzaInternal.hadza.loadRun, { runId: args.runId });
    if (run.status !== 'running') {
      return { day: run.currentDay, metrics: null };
    }
    const config = getScenarioConfig(run.scenario);
    const parsed = JSON.parse(run.state) as SimulationState;
    const simulation = CooperationSimulation.fromState(config, parsed);
    const step = await simulation.stepDay();
    await ctx.runMutation(hadzaInternal.hadza.persistStep, {
      runId: args.runId,
      state: JSON.stringify(step.newState),
      day: step.newState.environment.day,
      metrics: step.metrics,
      logs: step.logs,
      networkStats: step.networkStats ?? {
        reciprocity: step.metrics.reciprocity,
        assortativity: step.metrics.networkAssortativity,
        clustering: 0,
      },
      edges: JSON.stringify(step.newState.network.edges),
    });
    return {
      day: step.newState.environment.day,
      metrics: step.metrics,
    };
  },
});

export const getSimulationRun = query({
  args: { runId: v.id('hadzaRuns') },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const state = JSON.parse(run.state) as SimulationState;
    return {
      ...run,
      state,
    };
  },
});

export const listSimulationRuns = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query('hadzaRuns').collect();
    return runs.map((run) => ({
      _id: run._id,
      scenario: run.scenario,
      status: run.status,
      startedAt: run.startedAt,
      currentDay: run.currentDay,
    }));
  },
});

