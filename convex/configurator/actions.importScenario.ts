import { mutation } from '../_generated/server';
import { v } from 'convex/values';
import { validateScenario, Scenario } from '../../src/configurator/schema/Scenario';
import { applyScenarioInternal } from './actions.applyScenario';
import { getWorldContext } from './world';

export const importScenario = mutation({
  args: {
    scenario: v.any(),
    worldId: v.optional(v.id('worlds')),
    resetFirst: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const validation = validateScenario(args.scenario);
    let scenario: Scenario;
    let repaired = false;
    let issues: string[] = [];
    if (validation.ok) {
      scenario = validation.data;
    } else if (validation.repaired) {
      scenario = validation.repaired;
      repaired = true;
      issues = validation.issues.map((issue) => issue.message);
    } else {
      throw new Error(`Scenario failed validation: ${validation.issues.map((issue) => issue.message).join('; ')}`);
    }

    const { world } = await getWorldContext(ctx, args.worldId);
    const result = await applyScenarioInternal(ctx, scenario, world._id, args.resetFirst ?? true);
    return {
      worldId: world._id,
      repaired,
      issues,
      ...result,
    };
  },
});
