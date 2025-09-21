import { z, ZodIssue } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

export const SCENARIO_SCHEMA_VERSION = '1.0.0';

const GuardrailSchema = z
  .object({
    avoidContent: z.array(z.string()).default([]),
    mustInclude: z.array(z.string()).default([]),
  })
  .default({ avoidContent: [], mustInclude: [] });

export const ScenarioBriefSchema = z.object({
  title: z.string().nonempty('A title is required'),
  description: z.string().nonempty('A description is required'),
  domain: z.enum(['campus', 'town', 'office', 'hospital', 'market', 'custom']).optional(),
  language: z.string().optional(),
  numAgents: z.number().int().min(1).max(40).optional(),
  timeHorizon: z.enum(['short', 'day', 'week']).optional(),
  guardrails: GuardrailSchema.optional(),
});

const RelationshipSchema = z
  .object({
    targetId: z.string().nonempty('Relationship requires a target'),
    type: z.string().nonempty('Relationship requires a type'),
    strength: z.number().min(-1).max(1).optional(),
    note: z.string().optional(),
  })
  .default({ type: '', targetId: '' });

const MemorySchema = z.object({
  identity: z.string().nonempty('Identity is required'),
  plan: z.string().nonempty('Plan is required'),
  relationships: z.array(RelationshipSchema).default([]),
  knowledge: z.array(z.string()).optional(),
});

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const SpriteSchema = z.object({
  kind: z.enum(['placeholder', 'assetRef']),
  ref: z.string().optional(),
  prompt: z.string().optional(),
});

const ScheduleItemSchema = z.object({
  time: z.string().nonempty(),
  activity: z.string().nonempty(),
  location: z.string().optional(),
});

const ConstraintSchema = z.object({
  mustNot: z.array(z.string()).default([]).optional(),
  must: z.array(z.string()).default([]).optional(),
});

const AgentSchema = z.object({
  id: z.string().nonempty(),
  name: z.string().nonempty(),
  role: z.string().optional(),
  traits: z.array(z.string()).default([]).optional(),
  languages: z.array(z.string()).default([]).optional(),
  startPosition: PositionSchema.optional(),
  sprite: SpriteSchema.optional(),
  memory: MemorySchema,
  schedule: z.array(ScheduleItemSchema).default([]).optional(),
  constraints: ConstraintSchema.optional(),
});

const ActivitySchema = z.object({
  id: z.string().nonempty(),
  name: z.string().nonempty(),
  trigger: z.enum(['time', 'proximity', 'broadcast']),
  details: z.string().nonempty(),
  participants: z.array(z.string()).default([]).optional(),
});

const AssetsSchema = z
  .object({
    sprites: z
      .array(
        z.object({
          id: z.string().nonempty(),
          prompt: z.string().optional(),
          ref: z.string().optional(),
        }),
      )
      .default([])
      .optional(),
    tileset: z.string().optional(),
    music: z.array(z.string()).default([]).optional(),
  })
  .optional();

const WorldSchema = z.object({
  mapId: z.string().nonempty(),
  mapConfig: z
    .object({
      width: z.number().int().min(1).optional(),
      height: z.number().int().min(1).optional(),
      theme: z.string().optional(),
    })
    .optional(),
  startTime: z.string().optional(),
  rules: z.array(z.string()).default([]).optional(),
});

const LlmSchema = z
  .object({
    chatModel: z.string().optional(),
    embeddingModel: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    seed: z.number().optional(),
    maxTokens: z.number().int().min(1).optional(),
  })
  .default({});

const ModerationSchema = z
  .object({
    enabled: z.boolean(),
    policyNotes: z.string().optional(),
  })
  .default({ enabled: true });

const MetricsSchema = z
  .object({
    trackNetwork: z.boolean().optional(),
    trackMessageStats: z.boolean().optional(),
  })
  .default({})
  .optional();

const ScenarioSchemaBase = z.object({
  metadata: z
    .object({
      name: z.string().nonempty(),
      description: z.string().nonempty(),
      locale: z.string().default('zh-CN'),
      seed: z.number().optional(),
      version: z.string().default(SCENARIO_SCHEMA_VERSION),
    })
    .default({ name: 'Unnamed Scenario', description: '', locale: 'zh-CN', version: SCENARIO_SCHEMA_VERSION }),
  world: WorldSchema,
  agents: z.array(AgentSchema).min(1),
  activities: z.array(ActivitySchema).default([]).optional(),
  assets: AssetsSchema,
  llm: LlmSchema.optional(),
  moderation: ModerationSchema.optional(),
  metrics: MetricsSchema,
});

export type ScenarioBrief = z.infer<typeof ScenarioBriefSchema>;
export type Scenario = z.infer<typeof ScenarioSchemaBase>;

const ScenarioSchema = ScenarioSchemaBase.superRefine((scenario, ctx) => {
  const idSet = new Set<string>();
  scenario.agents.forEach((agent, index) => {
    if (idSet.has(agent.id)) {
      ctx.addIssue({
        path: ['agents', index, 'id'],
        message: `Duplicate agent id: ${agent.id}`,
      });
    }
    idSet.add(agent.id);
  });
  scenario.agents.forEach((agent, agentIndex) => {
    const seen = new Set<string>();
    agent.memory.relationships.forEach((relationship, relIndex) => {
      if (relationship.targetId === agent.id) {
        ctx.addIssue({
          path: ['agents', agentIndex, 'memory', 'relationships', relIndex, 'targetId'],
          message: 'Agents cannot target themselves',
        });
      }
      if (!idSet.has(relationship.targetId)) {
        ctx.addIssue({
          path: ['agents', agentIndex, 'memory', 'relationships', relIndex, 'targetId'],
          message: `Unknown targetId ${relationship.targetId}`,
        });
      }
      if (seen.has(relationship.targetId)) {
        ctx.addIssue({
          path: ['agents', agentIndex, 'memory', 'relationships', relIndex, 'targetId'],
          message: 'Duplicate relationship for same target',
        });
      }
      seen.add(relationship.targetId);
    });
  });
  const agentMap = new Map(scenario.agents.map((agent) => [agent.id, agent]));
  scenario.agents.forEach((agent, agentIndex) => {
    agent.memory.relationships.forEach((relationship, relIndex) => {
      const counterpart = agentMap.get(relationship.targetId);
      if (!counterpart) {
        return;
      }
      const reciprocal = counterpart.memory.relationships.find((rel) => rel.targetId === agent.id);
      if (!reciprocal) {
        ctx.addIssue({
          path: ['agents', agentIndex, 'memory', 'relationships', relIndex],
          message: `Relationship to ${relationship.targetId} is missing a reciprocal entry`,
        });
      }
    });
  });
  scenario.activities?.forEach((activity, idx) => {
    activity.participants?.forEach((participant, participantIndex) => {
      if (!idSet.has(participant)) {
        ctx.addIssue({
          path: ['activities', idx, 'participants', participantIndex],
          message: `Unknown participant id ${participant}`,
        });
      }
    });
  });
});

export const scenarioJsonSchema = zodToJsonSchema(ScenarioSchema, { name: 'Scenario' });

export type ScenarioValidationResult =
  | { ok: true; data: Scenario }
  | { ok: false; issues: ZodIssue[]; repaired?: Scenario };

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function sanitizeRelationships(scenario: Scenario): Scenario {
  const agentIds = new Set(scenario.agents.map((agent) => agent.id));
  scenario.agents.forEach((agent) => {
    agent.memory.relationships = agent.memory.relationships.filter((relationship) =>
      agentIds.has(relationship.targetId),
    );
  });
  return scenario;
}

function attemptRepair(raw: unknown, _issues: ZodIssue[]): Scenario | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const draft = cloneValue(raw) as Record<string, unknown>;
  if (!draft.metadata || typeof draft.metadata !== 'object') {
    draft.metadata = { name: 'Repaired Scenario', description: 'Auto-repaired scenario' };
  }
  const metadata = draft.metadata as Record<string, unknown>;
  if (!metadata.version) {
    metadata.version = SCENARIO_SCHEMA_VERSION;
  }
  if (!metadata.locale) {
    metadata.locale = 'zh-CN';
  }
  if (!Array.isArray(draft.agents)) {
    return undefined;
  }
  for (const agent of draft.agents as Record<string, unknown>[]) {
    if (!agent.memory || typeof agent.memory !== 'object') {
      agent.memory = { identity: 'Unknown', plan: 'Repair placeholder', relationships: [] };
    }
    const memory = agent.memory as Record<string, unknown>;
    if (!Array.isArray(memory.relationships)) {
      memory.relationships = [];
    }
  }
  const reparsed = ScenarioSchema.safeParse(draft);
  if (reparsed.success) {
    return sanitizeRelationships(reparsed.data);
  }
  return undefined;
}

function canonicalizeScenario(value: Scenario): Scenario {
  const canonical = cloneValue(value);
  canonical.metadata.version = canonical.metadata.version || SCENARIO_SCHEMA_VERSION;
  canonical.metadata.locale = canonical.metadata.locale || 'zh-CN';
  canonical.agents = canonical.agents.map((agent) => ({
    ...agent,
    traits: agent.traits ?? [],
    languages: agent.languages ?? [],
    schedule: agent.schedule ?? [],
    memory: {
      ...agent.memory,
      relationships: agent.memory.relationships ?? [],
      knowledge: agent.memory.knowledge ?? [],
    },
    constraints: agent.constraints
      ? {
          must: agent.constraints.must ?? [],
          mustNot: agent.constraints.mustNot ?? [],
        }
      : { must: [], mustNot: [] },
  }));
  canonical.world.rules = canonical.world.rules ?? [];
  if (canonical.activities) {
    canonical.activities = canonical.activities.map((activity) => ({
      ...activity,
      participants: activity.participants ?? [],
    }));
  }
  return sanitizeRelationships(canonical);
}

export function validateScenario(raw: unknown): ScenarioValidationResult {
  const parsed = ScenarioSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, data: canonicalizeScenario(parsed.data) };
  }
  const repaired = attemptRepair(raw, parsed.error.issues);
  if (repaired) {
    return { ok: false, issues: parsed.error.issues, repaired };
  }
  return { ok: false, issues: parsed.error.issues };
}

export { ScenarioSchema };
