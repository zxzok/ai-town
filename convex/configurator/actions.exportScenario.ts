import { mutation } from '../_generated/server';
import { v } from 'convex/values';
import {
  Scenario,
  SCENARIO_SCHEMA_VERSION,
  validateScenario,
} from '../../src/configurator/schema/Scenario';
import { getWorldContext } from './world';
import { loadLatestSnapshot } from './snapshots';
import { getMapData } from './maps';
import { Doc } from '../_generated/dataModel';

function buildFallbackScenario(
  world: any,
  playerDescriptions: Array<{ playerId: string; name: string; description: string }>,
  agentDescriptions: Array<{ agentId: string; identity: string; plan: string }>,
  mapDoc: Doc<'maps'> | null,
): Scenario {
  const agents = playerDescriptions.map((desc) => {
    const player = world.players.find((p: any) => p.id === desc.playerId);
    const worldAgent = world.agents.find((a: any) => a.playerId === desc.playerId);
    const agentDescription = worldAgent
      ? agentDescriptions.find((ad) => ad.agentId === worldAgent.id)
      : undefined;
    return {
      id: `agent-${desc.playerId}`,
      name: desc.name,
      role: undefined,
      traits: [],
      languages: [],
      startPosition: player ? { x: player.position.x, y: player.position.y } : undefined,
      sprite: { kind: 'placeholder' as const },
      memory: {
        identity: agentDescription?.identity ?? desc.description,
        plan: agentDescription?.plan ?? 'Explore the town',
        relationships: [],
        knowledge: [],
      },
      schedule: [],
      constraints: { must: [], mustNot: [] },
    };
  });

  const map = mapDoc
    ? {
        width: mapDoc.width,
        height: mapDoc.height,
        tileSetUrl: mapDoc.tileSetUrl,
        tileSetDimX: mapDoc.tileSetDimX,
        tileSetDimY: mapDoc.tileSetDimY,
        tileDim: mapDoc.tileDim,
        bgTiles: mapDoc.bgTiles,
        objectTiles: mapDoc.objectTiles,
        animatedSprites: mapDoc.animatedSprites,
      }
    : getMapData(world.mapId ?? 'default-town');
  return {
    metadata: {
      name: 'Snapshot Scenario',
      description: 'Exported from current world state',
      locale: 'en',
      version: SCENARIO_SCHEMA_VERSION,
    },
    world: {
      mapId: world.mapId ?? 'default-town',
      mapConfig: { width: map.width, height: map.height },
      startTime: undefined,
      rules: [],
    },
    agents,
    activities: [],
    assets: undefined,
    llm: {},
    moderation: { enabled: true },
    metrics: { trackNetwork: false, trackMessageStats: false },
  };
}

function updateScenarioPositions(scenario: Scenario, world: any, playerDescriptions: Array<{ playerId: string; name: string }>) {
  const playerByName = new Map(playerDescriptions.map((desc) => [desc.name, desc]));
  scenario.agents = scenario.agents.map((agent) => {
    const desc = playerByName.get(agent.name);
    if (!desc) {
      return agent;
    }
    const player = world.players.find((p: any) => p.id === desc.playerId);
    if (!player) {
      return agent;
    }
    return {
      ...agent,
      startPosition: { x: player.position.x, y: player.position.y },
    };
  });
}

export const exportScenario = mutation({
  args: { worldId: v.optional(v.id('worlds')) },
  handler: async (ctx, args) => {
    const { world } = await getWorldContext(ctx, args.worldId);
    const worldId = world._id;

    const playerDescriptions = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .collect();
    const agentDescriptions = await ctx.db
      .query('agentDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .collect();
    const mapDoc = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .first();

    const latestSnapshot = await loadLatestSnapshot(ctx, worldId);
    let scenario: Scenario;
    if (latestSnapshot) {
      scenario = JSON.parse(latestSnapshot.scenarioJson) as Scenario;
    } else {
      scenario = buildFallbackScenario(world, playerDescriptions, agentDescriptions, mapDoc);
    }

    updateScenarioPositions(
      scenario,
      world,
      playerDescriptions.map((desc) => ({ playerId: desc.playerId, name: desc.name })),
    );

    const validation = validateScenario(scenario);
    if (!validation.ok) {
      throw new Error('Failed to export scenario: stored snapshot is invalid');
    }

    return {
      scenario: validation.data,
      snapshotTimestamp: latestSnapshot?.appliedAt ?? null,
    };
  },
});
