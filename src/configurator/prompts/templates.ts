import { ScenarioBrief } from '../schema/Scenario';

export const SYSTEM_SCENARIO_PLANNER =
  '“You are a simulation planner for a multi‑agent town. Produce a strictly valid JSON object of type ‘Scenario’ that matches the provided JSON Schema. Keep identities and plans concise but specific. Ensure:\n- agents[].id are unique, kebab‑case;\n- relationships reference existing ids and are plausible (create symmetric ties when appropriate);\n- mapId references an existing map name if possible (‘default-town’ as fallback);\n- language fields match the requested locale;\n- activities have realistic triggers and participant ids;\n- no unsafe/illegal instructions.\nReturn ONLY JSON.”';

export const REPAIR_PROMPT =
  '“Given a Scenario JSON and the following validation errors, return a corrected JSON that strictly conforms to the schema while preserving the scenario’s intent. Return JSON only.”';

export const MODERATION_PROMPT =
  '“Classify the user brief as ALLOW or BLOCK per standard safety policy. If BLOCK, give a minimal reason code.”';

function formatArray(value: string[] | undefined): string {
  return JSON.stringify(value ?? []);
}

export function USER_SCENARIO_PLANNER(brief: ScenarioBrief, schemaExcerpt: string): string {
  return (
    '“Locale: ' +
    `${brief.language ?? 'zh-CN'}\n` +
    `Agents requested: ${brief.numAgents ?? 10}\n` +
    `Domain: ${brief.domain ?? 'town'}\n` +
    `Title: ${brief.title}\n` +
    `Description: ${brief.description}\n` +
    `Must include: ${formatArray(brief.guardrails?.mustInclude)}\n` +
    `Must avoid: ${formatArray(brief.guardrails?.avoidContent)}\n` +
    'Here is the JSON Schema excerpt (authoritative):\n' +
    `${schemaExcerpt}\n` +
    'Return ONLY a JSON object of type Scenario.”'
  );
}

export function createSchemaExcerpt(schema: unknown, maxLength = 2800): string {
  const json = JSON.stringify(schema, null, 2);
  if (json.length <= maxLength) {
    return json;
  }
  return json.slice(0, maxLength - 5) + '\n...';
}
