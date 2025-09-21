import { MutationCtx } from '../_generated/server';
import { Doc, Id } from '../_generated/dataModel';
import { Scenario } from '../../src/configurator/schema/Scenario';

export interface SnapshotRecord extends Doc<'configuratorScenarioSnapshots'> {}

export async function recordScenarioSnapshot(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  scenario: Scenario,
  appliedAt: number,
): Promise<string> {
  const existing = await ctx.db
    .query('configuratorScenarioSnapshots')
    .withIndex('byWorld', (q) => q.eq('worldId', worldId))
    .collect();
  const baseName = scenario.metadata.name;
  const seed = scenario.metadata.seed ?? null;
  let versionSuffix = 0;
  for (const snapshot of existing) {
    if (snapshot.scenarioName.startsWith(baseName) && (snapshot.scenarioSeed ?? null) === seed) {
      versionSuffix += 1;
    }
  }
  const appliedName = versionSuffix > 0 ? `${baseName}-v${versionSuffix + 1}` : baseName;
  const storedScenario = {
    ...scenario,
    metadata: { ...scenario.metadata, name: appliedName },
  };

  await ctx.db.insert('configuratorScenarioSnapshots', {
    worldId,
    scenarioName: appliedName,
    scenarioDescription: scenario.metadata.description,
    scenarioLocale: scenario.metadata.locale,
    scenarioVersion: scenario.metadata.version,
    scenarioSeed: scenario.metadata.seed,
    scenarioJson: JSON.stringify(storedScenario, null, 2),
    appliedAt,
  });
  return appliedName;
}

export async function loadLatestSnapshot(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
): Promise<SnapshotRecord | null> {
  const snapshots = await ctx.db
    .query('configuratorScenarioSnapshots')
    .withIndex('byWorld', (q) => q.eq('worldId', worldId))
    .collect();
  if (!snapshots.length) {
    return null;
  }
  return snapshots.reduce((latest, current) => (current.appliedAt > latest.appliedAt ? current : latest), snapshots[0]);
}

export async function clearSnapshots(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const snapshots = await ctx.db
    .query('configuratorScenarioSnapshots')
    .withIndex('byWorld', (q) => q.eq('worldId', worldId))
    .collect();
  for (const snapshot of snapshots) {
    await ctx.db.delete(snapshot._id);
  }
}
