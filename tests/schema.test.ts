import { SCENARIO_SCHEMA_VERSION, Scenario, validateScenario } from '../src/configurator/schema/Scenario';

describe('Scenario schema validation', () => {
  const baseScenario: Scenario = {
    metadata: {
      name: 'Test Scenario',
      description: 'Validation baseline',
      locale: 'en',
      version: SCENARIO_SCHEMA_VERSION,
    },
    world: {
      mapId: 'default-town',
      rules: ['Be kind'],
      startTime: '08:00',
    },
    agents: [
      {
        id: 'agent-a',
        name: 'Alex',
        role: 'researcher',
        traits: ['curious'],
        languages: ['en'],
        startPosition: { x: 5, y: 5 },
        sprite: { kind: 'placeholder' },
        memory: {
          identity: 'Alex studies social dynamics.',
          plan: 'Interview local residents about town history.',
          relationships: [
            { targetId: 'agent-b', type: 'colleague', strength: 0.5, note: 'Project partner' },
          ],
          knowledge: ['Collects oral histories'],
        },
        schedule: [],
        constraints: { must: [], mustNot: [] },
      },
      {
        id: 'agent-b',
        name: 'Bianca',
        role: 'librarian',
        traits: ['helpful'],
        languages: ['en'],
        sprite: { kind: 'placeholder' },
        memory: {
          identity: 'Bianca curates the town archives.',
          plan: 'Share documents with Alex.',
          relationships: [{ targetId: 'agent-a', type: 'colleague', strength: 0.5 }],
          knowledge: [],
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

  it('accepts a canonical scenario', () => {
    const result = validateScenario(baseScenario);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata.version).toBe(SCENARIO_SCHEMA_VERSION);
      expect(result.data.agents).toHaveLength(2);
      expect(result.data.agents[0].memory.relationships[0].targetId).toBe('agent-b');
    }
  });

  it('fills defaults when optional fields are missing', () => {
    const raw = {
      metadata: { name: 'Defaulted Scenario', description: 'Missing locale' },
      world: { mapId: 'default-town' },
      agents: [
        {
          id: 'agent-a',
          name: 'Ada',
          memory: {
            identity: 'Ada',
            plan: 'Explore the market',
            relationships: [{ targetId: 'agent-b', type: 'friend' }],
          },
        },
        {
          id: 'agent-b',
          name: 'Ben',
          memory: {
            identity: 'Ben',
            plan: 'Meet Ada',
            relationships: [{ targetId: 'agent-a', type: 'friend' }],
          },
        },
      ],
    } as unknown;
    const result = validateScenario(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.metadata.locale).toBe('zh-CN');
      expect(result.data.metadata.version).toBe(SCENARIO_SCHEMA_VERSION);
      expect(result.data.agents[0].memory.knowledge).toEqual([]);
    }
  });

  it('flags irreparable relationship mismatches', () => {
    const raw: Scenario = {
      ...baseScenario,
      agents: [
        {
          ...baseScenario.agents[0],
          memory: {
            ...baseScenario.agents[0].memory,
            relationships: [{ targetId: 'ghost', type: 'ally' }],
          },
        },
        baseScenario.agents[1],
      ],
    };
    const result = validateScenario(raw);
    expect(result.ok).toBe(false);
    expect(result.repaired).toBeUndefined();
  });
});
