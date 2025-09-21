import { mutation, MutationCtx } from '../_generated/server';
import { v } from 'convex/values';
import { Id } from '../_generated/dataModel';
import { getWorldContext } from './world';
import { clearSnapshots } from './snapshots';

export async function wipeWorld(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const { world } = await getWorldContext(ctx, worldId);
  const id = world._id;
  const playerIds = world.players.map((player) => player.id);

  await ctx.db.patch(id, {
    nextId: 0,
    players: [],
    agents: [],
    conversations: [],
    historicalLocations: [],
  });

  const mapDoc = await ctx.db
    .query('maps')
    .withIndex('worldId', (q) => q.eq('worldId', id))
    .first();
  if (mapDoc) {
    await ctx.db.delete(mapDoc._id);
  }

  const playerDescriptions = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', id))
    .collect();
  for (const record of playerDescriptions) {
    await ctx.db.delete(record._id);
  }

  const agentDescriptions = await ctx.db
    .query('agentDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', id))
    .collect();
  for (const record of agentDescriptions) {
    await ctx.db.delete(record._id);
  }

  const archivedPlayers = await ctx.db
    .query('archivedPlayers')
    .withIndex('worldId', (q) => q.eq('worldId', id))
    .collect();
  for (const record of archivedPlayers) {
    await ctx.db.delete(record._id);
  }

  const archivedAgents = await ctx.db
    .query('archivedAgents')
    .withIndex('worldId', (q) => q.eq('worldId', id))
    .collect();
  for (const record of archivedAgents) {
    await ctx.db.delete(record._id);
  }

  const archivedConversations = await ctx.db
    .query('archivedConversations')
    .withIndex('worldId', (q) => q.eq('worldId', id))
    .collect();
  for (const record of archivedConversations) {
    await ctx.db.delete(record._id);
  }

  const participation = await ctx.db
    .query('participatedTogether')
    .filter((q) => q.eq(q.field('worldId'), id))
    .collect();
  for (const record of participation) {
    await ctx.db.delete(record._id);
  }

  const messages = await ctx.db
    .query('messages')
    .withIndex('conversationId', (q) => q.eq('worldId', id))
    .collect();
  for (const message of messages) {
    await ctx.db.delete(message._id);
  }

  for (const playerId of playerIds) {
    const memories = await ctx.db
      .query('memories')
      .withIndex('playerId', (q) => q.eq('playerId', playerId))
      .collect();
    for (const memory of memories) {
      await ctx.db.delete(memory._id);
    }
    const embeddings = await ctx.db
      .query('memoryEmbeddings')
      .filter((q) => q.eq(q.field('playerId'), playerId))
      .collect();
    for (const embedding of embeddings) {
      await ctx.db.delete(embedding._id);
    }
  }

  await clearSnapshots(ctx, id);

  return id;
}

export const resetWorld = mutation({
  args: { worldId: v.optional(v.id('worlds')) },
  handler: async (ctx, args) => {
    const { world } = await getWorldContext(ctx, args.worldId);
    const worldId = await wipeWorld(ctx, world._id);
    return { worldId };
  },
});
