import { Scenario } from '../schema/Scenario';

export interface AiTownPlayerRecord {
  id: string;
  lastInput: number;
  position: { x: number; y: number };
  facing: { x: number; y: number };
  speed: number;
  human?: string;
}

export interface AiTownAgentRecord {
  id: string;
  playerId: string;
  toRemember?: string;
  lastConversation?: number;
  lastInviteAttempt?: number;
}

export interface PlayerDescriptionRecord {
  playerId: string;
  name: string;
  description: string;
  character: string;
}

export interface AgentDescriptionRecord {
  agentId: string;
  identity: string;
  plan: string;
}

export interface RelationshipMemoryPlan {
  ownerAgentId: string;
  ownerPlayerId: string;
  targetAgentId: string;
  targetPlayerId: string;
  description: string;
  strength?: number;
  note?: string;
}

export interface AgentSchedulePlan {
  agentId: string;
  schedule: Array<{ time: string; activity: string; location?: string }>;
}

export interface MapSummary {
  mapId: string;
  width: number;
  height: number;
  theme?: string;
}

export interface ScenarioApplicationPlan {
  world: {
    nextId: number;
    players: AiTownPlayerRecord[];
    agents: AiTownAgentRecord[];
  };
  playerDescriptions: PlayerDescriptionRecord[];
  agentDescriptions: AgentDescriptionRecord[];
  relationshipMemories: RelationshipMemoryPlan[];
  schedules: AgentSchedulePlan[];
  activities: NonNullable<Scenario['activities']>;
  map: MapSummary;
  scenario: Scenario;
  assignments: Array<{ scenarioAgentId: string; agentId: string; playerId: string; name: string }>;
}

export interface ScenarioToAiTownOptions {
  now?: number;
  characterPool?: string[];
  mapDimensions?: { width: number; height: number };
}

const DEFAULT_CHARACTERS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'];
const DEFAULT_MAP_DIMENSIONS = { width: 64, height: 48 };

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), 1 | x);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeSpawnPosition(
  index: number,
  total: number,
  width: number,
  height: number,
  random: () => number,
): { x: number; y: number } {
  const margin = 2;
  if (total === 1) {
    return { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  }
  const angle = (Math.PI * 2 * index) / total;
  const radius = Math.max(4, Math.min(width, height) / 3);
  const centerX = width / 2;
  const centerY = height / 2;
  const jitter = (random() - 0.5) * 2;
  const x = clamp(Math.round(centerX + radius * Math.cos(angle) + jitter), margin, width - margin);
  const y = clamp(Math.round(centerY + radius * Math.sin(angle) + jitter), margin, height - margin);
  return { x, y };
}

export function scenarioToAiTownPlan(
  scenario: Scenario,
  options: ScenarioToAiTownOptions = {},
): ScenarioApplicationPlan {
  const now = options.now ?? Date.now();
  const mapWidth = scenario.world.mapConfig?.width ?? options.mapDimensions?.width ?? DEFAULT_MAP_DIMENSIONS.width;
  const mapHeight = scenario.world.mapConfig?.height ?? options.mapDimensions?.height ?? DEFAULT_MAP_DIMENSIONS.height;
  const rngSeed = scenario.metadata.seed ?? options.now ?? 1;
  const random = mulberry32(rngSeed);

  const characters = options.characterPool ?? DEFAULT_CHARACTERS;
  const players: AiTownPlayerRecord[] = [];
  const agents: AiTownAgentRecord[] = [];
  const playerDescriptions: PlayerDescriptionRecord[] = [];
  const agentDescriptions: AgentDescriptionRecord[] = [];
  const schedules: AgentSchedulePlan[] = [];

  let nextIdCounter = 0;
  const idMap = new Map<string, { agentId: string; playerId: string; name: string }>();

  scenario.agents.forEach((agent, index) => {
    const playerId = `p:${nextIdCounter}`;
    nextIdCounter += 1;
    const agentId = `a:${nextIdCounter}`;
    nextIdCounter += 1;
    idMap.set(agent.id, { agentId, playerId, name: agent.name });

    const startPosition = agent.startPosition ?? computeSpawnPosition(index, scenario.agents.length, mapWidth, mapHeight, random);
    players.push({
      id: playerId,
      lastInput: now,
      position: startPosition,
      facing: { x: 0, y: 1 },
      speed: 0,
    });
    agents.push({
      id: agentId,
      playerId,
    });
    const character = characters[index % characters.length];
    playerDescriptions.push({
      playerId,
      name: agent.name,
      description: agent.memory.identity,
      character,
    });
    agentDescriptions.push({
      agentId,
      identity: agent.memory.identity,
      plan: agent.memory.plan,
    });
    schedules.push({ agentId, schedule: agent.schedule ?? [] });
  });

  const relationshipMemories: RelationshipMemoryPlan[] = [];
  scenario.agents.forEach((agent) => {
    const owner = idMap.get(agent.id);
    if (!owner) {
      return;
    }
    agent.memory.relationships.forEach((relationship) => {
      const target = idMap.get(relationship.targetId);
      if (!target) {
        return;
      }
      relationshipMemories.push({
        ownerAgentId: owner.agentId,
        ownerPlayerId: owner.playerId,
        targetAgentId: target.agentId,
        targetPlayerId: target.playerId,
        description: relationship.note ?? `${relationship.type} (${owner.name} → ${target.name})`,
        strength: relationship.strength,
        note: relationship.note,
      });
    });
  });

  return {
    world: {
      nextId: nextIdCounter,
      players,
      agents,
    },
    playerDescriptions,
    agentDescriptions,
    relationshipMemories,
    schedules,
    activities: scenario.activities ?? [],
    map: {
      mapId: scenario.world.mapId || 'default-town',
      width: mapWidth,
      height: mapHeight,
      theme: scenario.world.mapConfig?.theme,
    },
    scenario,
    assignments: Array.from(idMap.entries()).map(([scenarioAgentId, value]) => ({
      scenarioAgentId,
      agentId: value.agentId,
      playerId: value.playerId,
      name: value.name,
    })),
  };
}
