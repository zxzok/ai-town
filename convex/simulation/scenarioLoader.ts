import hadza from '../../data/scenarios/hadza.json';
import island from '../../data/scenarios/island_survival.json';
import { ScenarioConfig, SeasonName } from './types';

const registry: Record<string, ScenarioConfig> = {
  [hadza.name]: hadza as ScenarioConfig,
  [island.name]: island as ScenarioConfig,
};

const validSeasons: SeasonName[] = ['spring', 'summer', 'autumn', 'winter'];

function assertScenario(config: ScenarioConfig) {
  if (!config.name || !config.displayName) {
    throw new Error('Scenario config must include name and displayName');
  }
  if (!config.timeline.dailyMicroInteractions?.length) {
    throw new Error('Scenario must specify micro interactions for each day');
  }
  config.seasons.forEach((season) => {
    if (!validSeasons.includes(season.name)) {
      throw new Error(`Invalid season ${season.name} in scenario ${config.name}`);
    }
  });
  if (!config.tasks.length) {
    throw new Error(`Scenario ${config.name} must define at least one task`);
  }
}

Object.values(registry).forEach(assertScenario);

export function listScenarioConfigs(): ScenarioConfig[] {
  return Object.values(registry).map((config) => ({ ...config }));
}

export function getScenarioConfig(name: string): ScenarioConfig {
  const config = registry[name];
  if (!config) {
    throw new Error(`Scenario ${name} not found`);
  }
  return { ...config };
}

export function mergeScenarioConfig(
  name: string,
  overrides: Partial<ScenarioConfig>,
): ScenarioConfig {
  const base = getScenarioConfig(name);
  const merged = {
    ...base,
    ...overrides,
    map: { ...base.map, ...(overrides.map ?? {}) },
    timeline: { ...base.timeline, ...(overrides.timeline ?? {}) },
    resources: { ...base.resources, ...(overrides.resources ?? {}) },
    hazards: {
      ...base.hazards,
      ...(overrides.hazards ?? {}),
      seasonal: {
        ...(base.hazards.seasonal ?? {}),
        ...(overrides.hazards?.seasonal ?? {}),
      },
    },
    cognition: { ...base.cognition, ...(overrides.cognition ?? {}) },
    network: { ...base.network, ...(overrides.network ?? {}) },
    logging: { ...base.logging, ...(overrides.logging ?? {}) },
    llm: { ...base.llm, ...(overrides.llm ?? {}) },
    defaults: { ...base.defaults, ...(overrides.defaults ?? {}) },
  };
  if (overrides.seasons) {
    merged.seasons = overrides.seasons;
  }
  if (overrides.tasks) {
    merged.tasks = overrides.tasks;
  }
  if (overrides.agentPopulation) {
    merged.agentPopulation = {
      ...base.agentPopulation,
      ...overrides.agentPopulation,
      ageDistribution: {
        ...base.agentPopulation.ageDistribution,
        ...(overrides.agentPopulation.ageDistribution ?? {}),
      },
      skillProfiles: {
        ...base.agentPopulation.skillProfiles,
        ...(overrides.agentPopulation.skillProfiles ?? {}),
      },
      socialPreferences: {
        ...base.agentPopulation.socialPreferences,
        ...(overrides.agentPopulation.socialPreferences ?? {}),
      },
    };
  }
  return merged;
}

