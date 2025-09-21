import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { agentTables } from './agent/schema';
import { aiTownTables } from './aiTown/schema';
import { conversationId, playerId } from './aiTown/ids';
import { engineTables } from './engine/schema';
import { hadzaTables } from './hadza/schema';

export default defineSchema({
  configuratorScenarioSnapshots: defineTable({
    worldId: v.id('worlds'),
    scenarioName: v.string(),
    scenarioDescription: v.string(),
    scenarioLocale: v.string(),
    scenarioVersion: v.string(),
    scenarioSeed: v.optional(v.number()),
    scenarioJson: v.string(),
    appliedAt: v.number(),
  }).index('byWorld', ['worldId']),

  music: defineTable({
    storageId: v.string(),
    type: v.union(v.literal('background'), v.literal('player')),
  }),

  messages: defineTable({
    conversationId,
    messageUuid: v.string(),
    author: playerId,
    text: v.string(),
    worldId: v.optional(v.id('worlds')),
  })
    .index('conversationId', ['worldId', 'conversationId'])
    .index('messageUuid', ['conversationId', 'messageUuid']),

  ...agentTables,
  ...aiTownTables,
  ...engineTables,
  ...hadzaTables,
});
