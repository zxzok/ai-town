import { Scenario } from '../schema/Scenario';
import { generatePlaceholderSprite } from './placeholder';

export type AssetProviderName = 'none' | 'placeholder' | 'replicate' | 'fal';

export interface GeneratedSpriteAsset {
  agentId: string;
  spriteId: string;
  ref: string;
  provider: AssetProviderName;
  prompt?: string;
}

export interface AssetPipelineResult {
  scenario: Scenario;
  provider: AssetProviderName;
  generated: GeneratedSpriteAsset[];
  warnings: string[];
}

function readEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  return undefined;
}

function cloneScenario<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function normalizeProvider(value: string | undefined): AssetProviderName {
  switch ((value ?? 'placeholder').toLowerCase()) {
    case 'none':
    case 'placeholder':
    case 'replicate':
    case 'fal':
      return value!.toLowerCase() as AssetProviderName;
    default:
      return 'placeholder';
  }
}

function ensureSpritesArray(scenario: Scenario): Scenario {
  if (!scenario.assets) {
    scenario.assets = { sprites: [] };
    return scenario;
  }
  if (!scenario.assets.sprites) {
    scenario.assets.sprites = [];
  }
  return scenario;
}

function handlePlaceholder(
  scenario: Scenario,
  agentIndex: number,
  warnings: string[],
  provider: AssetProviderName,
): GeneratedSpriteAsset | null {
  const agent = scenario.agents[agentIndex];
  const sprite = agent.sprite ?? { kind: 'placeholder' as const };
  if (sprite.kind !== 'placeholder') {
    return null;
  }
  const requestedProvider = provider;
  let resolvedProvider: AssetProviderName = requestedProvider;
  let ref: string;
  let spriteId: string;
  let prompt = sprite.prompt;

  if (requestedProvider === 'none') {
    return null;
  }

  if (requestedProvider === 'placeholder') {
    const generated = generatePlaceholderSprite(agent.id, agent.name);
    ref = generated.dataUrl;
    spriteId = generated.id;
    prompt = prompt ?? generated.prompt;
  } else {
    const keyEnv = requestedProvider === 'replicate' ? 'REPLICATE_API_TOKEN' : 'FAL_KEY';
    const key = readEnv(keyEnv);
    warnings.push(
      key
        ? `Asset provider '${requestedProvider}' is not implemented yet. Placeholder sprites used.`
        : `Asset provider '${requestedProvider}' missing ${keyEnv}; falling back to placeholder sprites.`,
    );
    const generated = generatePlaceholderSprite(agent.id, agent.name);
    ref = generated.dataUrl;
    spriteId = generated.id;
    prompt = prompt ?? generated.prompt;
    resolvedProvider = 'placeholder';
  }

  agent.sprite = { kind: 'placeholder', ref, prompt };
  const assets = ensureSpritesArray(scenario).assets!.sprites!;
  const existingIndex = assets.findIndex((entry) => entry.id === spriteId);
  if (existingIndex >= 0) {
    assets[existingIndex] = { id: spriteId, ref, prompt };
  } else {
    assets.push({ id: spriteId, ref, prompt });
  }

  return {
    agentId: agent.id,
    spriteId,
    ref,
    provider: resolvedProvider,
    prompt,
  };
}

export async function applyAssetPipeline(rawScenario: Scenario): Promise<AssetPipelineResult> {
  const provider = normalizeProvider(readEnv('ASSET_PROVIDER'));
  if (provider === 'none') {
    return { scenario: rawScenario, provider, generated: [], warnings: [] };
  }
  const scenario = cloneScenario(rawScenario);
  const warnings: string[] = [];
  const generated: GeneratedSpriteAsset[] = [];

  scenario.agents.forEach((_agent, index) => {
    const asset = handlePlaceholder(scenario, index, warnings, provider);
    if (asset) {
      generated.push(asset);
    }
  });

  return { scenario, provider: generated.length ? generated[0].provider : provider, generated, warnings };
}
