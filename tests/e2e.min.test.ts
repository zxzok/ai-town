import { applyScenarioInternal } from '../convex/configurator/actions.applyScenario';
import { Scenario } from '../src/configurator/schema/Scenario';
import type { Id } from '../convex/_generated/dataModel';

class MockDatabase {
  private tables = new Map<string, Map<string, any>>();
  private idLookup = new Map<string, { table: string; doc: any }>();
  private counter = 0;

  constructor(initial: Record<string, any[]>) {
    for (const [table, docs] of Object.entries(initial)) {
      const map = this.ensureTable(table);
      for (const doc of docs) {
        const id = doc._id ?? `${table}_${++this.counter}`;
        const stored = { ...doc, _id: id };
        map.set(id, stored);
        this.idLookup.set(id, { table, doc: stored });
      }
    }
  }

  ensureTable(table: string): Map<string, any> {
    if (!this.tables.has(table)) {
      this.tables.set(table, new Map());
    }
    return this.tables.get(table)!;
  }

  getTable(table: string): any[] {
    return Array.from(this.ensureTable(table).values());
  }

  async insert(table: string, value: Record<string, unknown>) {
    const map = this.ensureTable(table);
    const id = `${table}_${++this.counter}`;
    const doc = { ...value, _id: id };
    map.set(id, doc);
    this.idLookup.set(id, { table, doc });
    return id;
  }

  async patch(id: string, value: Record<string, unknown>) {
    const entry = this.idLookup.get(id);
    if (!entry) {
      throw new Error(`Unknown document ${id}`);
    }
    Object.assign(entry.doc, value);
  }

  async delete(id: string) {
    const entry = this.idLookup.get(id);
    if (!entry) {
      return;
    }
    const tableMap = this.tables.get(entry.table);
    tableMap?.delete(id);
    this.idLookup.delete(id);
  }

  async get(id: string) {
    return this.idLookup.get(id)?.doc ?? null;
  }

  query(table: string) {
    return new MockQuery(this, table);
  }
}

class MockQuery {
  constructor(
    private readonly db: MockDatabase,
    private readonly table: string,
    private readonly filters: Array<(doc: any) => boolean> = [],
  ) {}

  private apply(doc: any) {
    return this.filters.every((filter) => filter(doc));
  }

  withIndex(_name: string, builder: (q: { eq(field: string, value: any): void }) => void) {
    let field: string | null = null;
    let value: any;
    builder({
      eq: (f: string, v: any) => {
        field = f;
        value = v;
      },
    });
    if (!field) {
      return new MockQuery(this.db, this.table, this.filters);
    }
    return new MockQuery(this.db, this.table, [...this.filters, (doc) => doc[field!] === value]);
  }

  filter(builder: (q: { field(name: string): string; eq(field: string, value: any): void }) => void) {
    let field: string | null = null;
    let value: any;
    builder({
      field: (name: string) => name,
      eq: (f: string, v: any) => {
        field = f;
        value = v;
      },
    });
    if (!field) {
      return new MockQuery(this.db, this.table, this.filters);
    }
    return new MockQuery(this.db, this.table, [...this.filters, (doc) => doc[field!] === value]);
  }

  collect() {
    return this.db.getTable(this.table).filter((doc) => this.apply(doc));
  }

  first() {
    return this.collect()[0] ?? null;
  }

  unique() {
    const results = this.collect();
    if (results.length === 0) {
      return null;
    }
    if (results.length > 1) {
      throw new Error('Expected unique result');
    }
    return results[0];
  }
}

describe('applyScenarioInternal integration', () => {
  const worldId = 'worlds_1' as Id<'worlds'>;
  const scenario: Scenario = {
    metadata: {
      name: 'Integration Test',
      description: 'Minimal integration scenario',
      locale: 'en',
      version: '1.0.0',
    },
    world: { mapId: 'default-town', rules: ['No running'], startTime: '07:30' },
    agents: [
      {
        id: 'alpha',
        name: 'Alpha',
        traits: ['curious'],
        languages: ['en'],
        sprite: { kind: 'placeholder' },
        memory: {
          identity: 'Alpha investigates mysteries.',
          plan: 'Meet Beta at cafe.',
          relationships: [
            { targetId: 'beta', type: 'friend', strength: 0.8 },
            { targetId: 'gamma', type: 'teammate', strength: 0.4 },
          ],
          knowledge: ['Knows secret path'],
        },
        schedule: [],
        constraints: { must: [], mustNot: [] },
      },
      {
        id: 'beta',
        name: 'Beta',
        traits: ['strategic'],
        languages: ['en'],
        sprite: { kind: 'placeholder' },
        memory: {
          identity: 'Beta coordinates plans.',
          plan: 'Share updates with Alpha.',
          relationships: [
            { targetId: 'alpha', type: 'friend', strength: 0.8 },
            { targetId: 'gamma', type: 'teammate', strength: 0.6 },
          ],
          knowledge: [],
        },
        schedule: [],
        constraints: { must: [], mustNot: [] },
      },
      {
        id: 'gamma',
        name: 'Gamma',
        traits: ['observant'],
        languages: ['en'],
        sprite: { kind: 'placeholder' },
        memory: {
          identity: 'Gamma scouts the plaza.',
          plan: 'Report findings to the team.',
          relationships: [
            { targetId: 'alpha', type: 'teammate', strength: 0.4 },
            { targetId: 'beta', type: 'teammate', strength: 0.6 },
          ],
          knowledge: ['Has map of plaza'],
        },
        schedule: [],
        constraints: { must: [], mustNot: [] },
      },
    ],
    activities: [],
    assets: { sprites: [] },
    llm: {},
    moderation: { enabled: true },
    metrics: { trackNetwork: false, trackMessageStats: false },
  };

  const previousProvider = process.env.ASSET_PROVIDER;

  beforeAll(() => {
    process.env.ASSET_PROVIDER = 'placeholder';
  });

  afterAll(() => {
    if (previousProvider === undefined) {
      delete process.env.ASSET_PROVIDER;
    } else {
      process.env.ASSET_PROVIDER = previousProvider;
    }
  });

  it('applies scenario, creates memories and snapshot', async () => {
    const now = Date.now();
    const db = new MockDatabase({
      worlds: [
        {
          _id: worldId,
          nextId: 0,
          players: [],
          agents: [],
          conversations: [],
          historicalLocations: [],
        },
      ],
      worldStatus: [
        {
          _id: 'worldStatus_1',
          worldId,
          isDefault: true,
          engineId: 'engines_1',
          lastViewed: now,
          status: 'running',
        },
      ],
      maps: [],
      playerDescriptions: [],
      agentDescriptions: [],
      archivedPlayers: [],
      archivedAgents: [],
      archivedConversations: [],
      participatedTogether: [],
      messages: [],
      memories: [],
      memoryEmbeddings: [],
      configuratorScenarioSnapshots: [],
    });
    const ctx = { db } as unknown as Parameters<typeof applyScenarioInternal>[0];

    const result = await applyScenarioInternal(ctx, scenario, worldId, true);

    expect(result.scenarioName).toContain('Integration Test');
    expect(result.generatedAssets.length).toBe(3);
    expect(result.assetProvider).toBe('placeholder');

    const worldDoc = await db.get(worldId as string);
    expect(worldDoc.players).toHaveLength(3);
    expect(worldDoc.agents).toHaveLength(3);

    const memories = db.getTable('memories');
    expect(memories.length).toBeGreaterThanOrEqual(6); // relationships + knowledge
    const memoryEmbeddings = db.getTable('memoryEmbeddings');
    expect(memoryEmbeddings.length).toBe(memories.length);

    const snapshots = db.getTable('configuratorScenarioSnapshots');
    expect(snapshots).toHaveLength(1);
    expect(JSON.parse(snapshots[0].scenarioJson).metadata.name).toBe(result.scenarioName);

    const playerDescriptions = db.getTable('playerDescriptions');
    expect(playerDescriptions).toHaveLength(3);
  });
});
