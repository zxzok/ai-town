import { scenarioToAiTownPlan } from '../src/configurator/mapping/aiTownAdapter';
import { Scenario } from '../src/configurator/schema/Scenario';

describe('scenarioToAiTownPlan', () => {
  const scenario: Scenario = {
    metadata: {
      name: 'Mapping Scenario',
      description: 'Test mapping conversion',
      locale: 'en',
      version: '1.0.0',
    },
    world: { mapId: 'default-town', rules: [], startTime: '09:00' },
    agents: [
      {
        id: 'scout-one',
        name: 'Scout One',
        traits: ['observant'],
        languages: ['en'],
        sprite: { kind: 'placeholder' },
        memory: {
          identity: 'Patrols the perimeter.',
          plan: 'Meet teammate at plaza.',
          relationships: [{ targetId: 'scout-two', type: 'partner', strength: 0.7 }],
          knowledge: ['Knows map shortcuts'],
        },
        schedule: [{ time: '10:00', activity: 'Check plaza' }],
        constraints: { must: [], mustNot: [] },
      },
      {
        id: 'scout-two',
        name: 'Scout Two',
        traits: ['strategic'],
        languages: ['en'],
        sprite: { kind: 'placeholder' },
        memory: {
          identity: 'Coordinates patrol routes.',
          plan: 'Sync with Scout One.',
          relationships: [{ targetId: 'scout-one', type: 'partner', strength: 0.7 }],
          knowledge: [],
        },
        schedule: [{ time: '10:00', activity: 'Meet Scout One' }],
        constraints: { must: [], mustNot: [] },
      },
    ],
    activities: [],
    assets: { sprites: [] },
    llm: {},
    moderation: { enabled: true },
    metrics: { trackNetwork: false, trackMessageStats: false },
  };

  it('creates consistent assignments and relationship mappings', () => {
    const plan = scenarioToAiTownPlan(scenario, { now: 0, mapDimensions: { width: 32, height: 32 } });
    expect(plan.world.players).toHaveLength(2);
    expect(plan.world.agents).toHaveLength(2);
    expect(plan.assignments).toHaveLength(2);

    const playerIds = new Set(plan.world.players.map((player) => player.id));
    for (const assignment of plan.assignments) {
      expect(playerIds.has(assignment.playerId)).toBe(true);
    }

    expect(plan.relationshipMemories).toHaveLength(2);
    expect(plan.relationshipMemories[0].ownerPlayerId).not.toBe(plan.relationshipMemories[0].targetPlayerId);
  });

  it('generates spawn positions within bounds', () => {
    const plan = scenarioToAiTownPlan(scenario, { now: 0, mapDimensions: { width: 16, height: 12 } });
    for (const player of plan.world.players) {
      expect(player.position.x).toBeGreaterThanOrEqual(0);
      expect(player.position.x).toBeLessThanOrEqual(16);
      expect(player.position.y).toBeGreaterThanOrEqual(0);
      expect(player.position.y).toBeLessThanOrEqual(12);
    }
  });
});
