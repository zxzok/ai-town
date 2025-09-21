import { mutation, MutationCtx } from '../_generated/server';
import { v } from 'convex/values';
import { Id } from '../_generated/dataModel';
import { validateScenario, Scenario } from '../../src/configurator/schema/Scenario';
import { scenarioToAiTownPlan } from '../../src/configurator/mapping/aiTownAdapter';
import { applyAssetPipeline } from '../../src/configurator/assets';
import { getWorldContext } from './world';
import { wipeWorld } from './actions.resetWorld';
import { getMapData } from './maps';
import { recordScenarioSnapshot } from './snapshots';
import { EMBEDDING_DIMENSION } from '../util/llm';

function zeroVector(): number[] {
  return new Array(EMBEDDING_DIMENSION).fill(0);
}

async function insertRelationshipMemories(ctx: MutationCtx, plan: ReturnType<typeof scenarioToAiTownPlan>) {
  const now = Date.now();
  for (const relationship of plan.relationshipMemories) {
    const embeddingId = await ctx.db.insert('memoryEmbeddings', {
      playerId: relationship.ownerPlayerId,
      embedding: zeroVector(),
    });
    const importance = relationship.strength !== undefined ? Math.max(0, Math.min(1, Math.abs(relationship.strength))) : 0.5;
    await ctx.db.insert('memories', {
      playerId: relationship.ownerPlayerId,
      description: relationship.description,
      embeddingId,
      importance,
      lastAccess: now,
      data: { type: 'relationship', playerId: relationship.targetPlayerId },
    });
  }

  const assignmentMap = new Map(plan.assignments.map((assignment) => [assignment.scenarioAgentId, assignment]));
  for (const agent of plan.scenario.agents) {
    const assignment = assignmentMap.get(agent.id);
    if (!assignment || !agent.memory.knowledge) {
      continue;
    }
    for (const knowledge of agent.memory.knowledge) {
      const embeddingId = await ctx.db.insert('memoryEmbeddings', {
        playerId: assignment.playerId,
        embedding: zeroVector(),
      });
      await ctx.db.insert('memories', {
        playerId: assignment.playerId,
        description: knowledge,
        embeddingId,
        importance: 0.25,
        lastAccess: now,
        data: { type: 'reflection', relatedMemoryIds: [] },
      });
    }
  }
}

async function insertDescriptions(ctx: MutationCtx, plan: ReturnType<typeof scenarioToAiTownPlan>, worldId: any) {
  for (const desc of plan.playerDescriptions) {
    await ctx.db.insert('playerDescriptions', {
      worldId,
      playerId: desc.playerId,
      name: desc.name,
      description: desc.description,
      character: desc.character,
    });
  }
  for (const desc of plan.agentDescriptions) {
    await ctx.db.insert('agentDescriptions', {
      worldId,
      agentId: desc.agentId,
      identity: desc.identity,
      plan: desc.plan,
    });
  }
}

export async function applyScenarioInternal(
  ctx: MutationCtx,
  scenario: Scenario,
  worldId: Id<'worlds'>,
  resetFirst: boolean,
) {
  if (resetFirst) {
    await wipeWorld(ctx, worldId);
  }

  const assetResult = await applyAssetPipeline(scenario);
  const scenarioWithAssets = assetResult.scenario;

  const mapData = getMapData(scenarioWithAssets.world.mapId || 'default-town');
  const plan = scenarioToAiTownPlan(scenarioWithAssets, {
    now: Date.now(),
    mapDimensions: { width: mapData.width, height: mapData.height },
  });

  await ctx.db.patch(worldId, {
    nextId: plan.world.nextId,
    players: plan.world.players,
    agents: plan.world.agents,
    conversations: [],
    historicalLocations: [],
  });

  const existingMaps = await ctx.db
    .query('maps')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .collect();
  for (const existing of existingMaps) {
    await ctx.db.delete(existing._id);
  }

  await ctx.db.insert('maps', {
    worldId,
    width: mapData.width,
    height: mapData.height,
    tileSetUrl: mapData.tileSetUrl,
    tileSetDimX: mapData.tileSetDimX,
    tileSetDimY: mapData.tileSetDimY,
    tileDim: mapData.tileDim,
    bgTiles: mapData.bgTiles,
    objectTiles: mapData.objectTiles,
    animatedSprites: mapData.animatedSprites,
  });

  await insertDescriptions(ctx, plan, worldId);
  await insertRelationshipMemories(ctx, plan);

  const appliedName = await recordScenarioSnapshot(ctx, worldId, scenarioWithAssets, Date.now());

  if (assetResult.warnings.length) {
    console.log(
      JSON.stringify({
        event: 'configurator.assets.warnings',
        warnings: assetResult.warnings,
        provider: assetResult.provider,
      }),
    );
  }

  return {
    scenarioName: appliedName,
    assignments: plan.assignments,
    map: plan.map,
    assetProvider: assetResult.provider,
    assetWarnings: assetResult.warnings,
    generatedAssets: assetResult.generated,
  };
}

export const applyScenario = mutation({
  args: {
    scenario: v.any(),
    worldId: v.optional(v.id('worlds')),
    resetFirst: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const validation = validateScenario(args.scenario);
    if (!validation.ok) {
      throw new Error(`Scenario failed validation: ${validation.issues.map((issue) => issue.message).join('; ')}`);
    }
    const scenario = validation.data;
    const { world } = await getWorldContext(ctx, args.worldId);
    const result = await applyScenarioInternal(ctx, scenario, world._id, args.resetFirst ?? true);
    return {
      worldId: world._id,
      ...result,
    };
  },
});
