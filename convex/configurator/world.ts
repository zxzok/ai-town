import { MutationCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';

export interface WorldContext {
  world: Doc<'worlds'>;
  worldStatus: Doc<'worldStatus'>;
}

export async function getWorldContext(ctx: MutationCtx, worldId?: Id<'worlds'>): Promise<WorldContext> {
  if (worldId) {
    const world = await ctx.db.get(worldId);
    if (!world) {
      throw new Error(`World ${worldId} not found`);
    }
    const worldStatus = await ctx.db
      .query('worldStatus')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .unique();
    if (!worldStatus) {
      throw new Error(`World status for ${worldId} not found`);
    }
    return { world, worldStatus };
  }

  const worldStatus = await ctx.db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  if (!worldStatus) {
    throw new Error('Default world not configured.');
  }
  const world = await ctx.db.get(worldStatus.worldId);
  if (!world) {
    throw new Error(`World ${worldStatus.worldId} not found`);
  }
  return { world, worldStatus };
}
