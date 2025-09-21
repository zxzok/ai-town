import { action } from '../_generated/server';
import { v } from 'convex/values';
import { chatJSON } from './llm';
import {
  Scenario,
  ScenarioBrief,
  ScenarioBriefSchema,
  scenarioJsonSchema,
  validateScenario,
} from '../../src/configurator/schema/Scenario';
import {
  MODERATION_PROMPT,
  REPAIR_PROMPT,
  SYSTEM_SCENARIO_PLANNER,
  USER_SCENARIO_PLANNER,
  createSchemaExcerpt,
} from '../../src/configurator/prompts/templates';

const briefArgs = v.object({
  title: v.string(),
  description: v.string(),
  domain: v.optional(v.string()),
  language: v.optional(v.string()),
  numAgents: v.optional(v.number()),
  timeHorizon: v.optional(v.string()),
  guardrails: v.optional(
    v.object({
      avoidContent: v.optional(v.array(v.string())),
      mustInclude: v.optional(v.array(v.string())),
    }),
  ),
});

const llmOptions = v.object({
  chatModel: v.optional(v.string()),
  temperature: v.optional(v.number()),
  top_p: v.optional(v.number()),
  seed: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
});

export interface GenerateScenarioResult {
  scenario: Scenario;
  report: {
    moderation?: { decision: string; reason?: string };
    plannerUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    repairUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    issues?: string[];
    schemaExcerptLength: number;
    seed?: number;
  };
}

export const generateScenario = action({
  args: {
    brief: briefArgs,
    moderationEnabled: v.optional(v.boolean()),
    llm: v.optional(llmOptions),
    schemaExcerptLength: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<GenerateScenarioResult> => {
    const parsedBrief = ScenarioBriefSchema.safeParse(args.brief);
    if (!parsedBrief.success) {
      throw new Error(`Invalid brief: ${parsedBrief.error.issues.map((issue) => issue.message).join(', ')}`);
    }
    const brief: ScenarioBrief = parsedBrief.data;
    const schemaExcerpt = createSchemaExcerpt(
      scenarioJsonSchema,
      args.schemaExcerptLength ?? 2600,
    );

    const moderationRequired = args.moderationEnabled ?? process.env.MODERATION_ENABLED !== 'false';
    let moderationDecision: { decision: string; reason?: string } | undefined;
    if (moderationRequired) {
      const moderationResponse = await chatJSON({
        messages: [
          { role: 'system', content: MODERATION_PROMPT },
          {
            role: 'user',
            content: JSON.stringify(
              {
                title: brief.title,
                description: brief.description,
                domain: brief.domain ?? 'unspecified',
                guardrails: brief.guardrails,
              },
              null,
              2,
            ),
          },
        ],
        model: args.llm?.chatModel,
        temperature: 0,
        responseFormat: 'json_object',
      });
      try {
        const parsed = JSON.parse(moderationResponse.content) as {
          decision?: string;
          reason?: string;
        };
        moderationDecision = {
          decision: parsed.decision ?? moderationResponse.content.trim(),
          reason: parsed.reason,
        };
      } catch (error) {
        moderationDecision = { decision: moderationResponse.content.trim() };
      }
      if (moderationDecision.decision.toUpperCase().includes('BLOCK')) {
        throw new Error(`Brief blocked by moderation: ${moderationDecision.reason ?? 'unspecified'}`);
      }
    }

    const plannerResponse = await chatJSON({
      messages: [
        { role: 'system', content: SYSTEM_SCENARIO_PLANNER },
        { role: 'user', content: USER_SCENARIO_PLANNER(brief, schemaExcerpt) },
      ],
      model: args.llm?.chatModel,
      temperature: args.llm?.temperature,
      top_p: args.llm?.top_p,
      maxTokens: args.llm?.maxTokens,
      seed: args.llm?.seed,
    });

    let rawScenario: unknown;
    try {
      rawScenario = JSON.parse(plannerResponse.content);
    } catch (error) {
      throw new Error(`Planner did not return valid JSON: ${(error as Error).message}`);
    }

    const validation = validateScenario(rawScenario);
    if (validation.ok) {
      return {
        scenario: validation.data,
        report: {
          moderation: moderationDecision,
          plannerUsage: plannerResponse.usage,
          schemaExcerptLength: schemaExcerpt.length,
          seed: validation.data.llm?.seed ?? args.llm?.seed,
        },
      };
    }

    const repairResponse = await chatJSON({
      messages: [
        { role: 'system', content: REPAIR_PROMPT },
        {
          role: 'user',
          content: JSON.stringify(
            {
              errors: validation.issues,
              scenario: rawScenario,
            },
            null,
            2,
          ),
        },
      ],
      model: args.llm?.chatModel,
      temperature: 0,
      maxTokens: args.llm?.maxTokens,
    });

    let repairedScenarioRaw: unknown;
    try {
      repairedScenarioRaw = JSON.parse(repairResponse.content);
    } catch (error) {
      throw new Error(`Repair step returned invalid JSON: ${(error as Error).message}`);
    }

    const repairedValidation = validateScenario(repairedScenarioRaw);
    if (!repairedValidation.ok) {
      const errors = repairedValidation.issues.map((issue) => issue.message).join('; ');
      throw new Error(`Scenario invalid after repair: ${errors}`);
    }

    return {
      scenario: repairedValidation.data,
      report: {
        moderation: moderationDecision,
        plannerUsage: plannerResponse.usage,
        repairUsage: repairResponse.usage,
        issues: validation.issues.map((issue) => issue.message),
        schemaExcerptLength: schemaExcerpt.length,
        seed: repairedValidation.data.llm?.seed ?? args.llm?.seed,
      },
    };
  },
});
