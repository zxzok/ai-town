import { Id } from '../_generated/dataModel';

export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter';

export interface ScenarioSeason {
  name: SeasonName;
  resourceMultiplier: number;
  climateNoise: number;
  notes?: string;
}

export interface ScenarioResources {
  basePlantRate: number;
  baseSmallGameRate: number;
  baseLargeGameRate: number;
  poissonGamma: {
    shape: number;
    scale: number;
  };
  logGaussian?: {
    mean: number;
    variance: number;
  };
  seasonalLargeGameBonus?: Partial<Record<SeasonName, number>>;
}

export interface HazardRates {
  injury: number;
  hypothermia: number;
  predator: number;
}

export interface ScenarioHazards {
  base: HazardRates;
  seasonal?: Partial<Record<SeasonName, Partial<HazardRates>>>;
}

export type TaskNormRule =
  | 'equal_share'
  | 'proportional_skill'
  | 'key_contributor_reward'
  | 'collective_penalty';

export interface ScenarioTask {
  id: string;
  name: string;
  category: 'foraging' | 'hunting' | 'public_good';
  successProbability: number;
  yieldPerParticipant?: number;
  yieldPerParticipantOnSuccess?: number;
  energyCost: number;
  injuryRiskMultiplier: number;
  minParticipants: number;
  recommendedParticipants: number;
  roles?: string[];
  norm: TaskNormRule;
}

export interface ScenarioAgentPopulation {
  size: number;
  genderRatio: number;
  ageDistribution: {
    min: number;
    max: number;
    mean: number;
  };
  skillProfiles: Record<string, { mean: number; std: number }>;
  socialPreferences: {
    alphaMean: number;
    alphaStd: number;
    betaMean: number;
    betaStd: number;
    reputationWeight: number;
    normPenalty: number;
  };
}

export interface ScenarioCognition {
  semanticMemoryWeight: number;
  socialMemoryHorizonDays: number;
  episodicWindowDays: number;
  reflectionIntervalDays: number;
  emotion: {
    decay: number;
    baselineValence: number;
    baselineArousal: number;
  };
  timeDiscount: number;
}

export interface ScenarioNetwork {
  decay: number;
  gossipWeight: number;
  geographicDecay: number;
  assortativityPreference: number;
  triadicClosureWeight: number;
  reciprocityWeight: number;
}

export interface ScenarioLogging {
  eventLog: boolean;
  taskLog: boolean;
  networkLog: boolean;
  causalGraph: boolean;
}

export interface ScenarioLLM {
  defaultProvider: 'openai-responses' | 'bedrock-converse' | 'ollama' | string;
  planTemplate: string;
}

export interface ScenarioConfig {
  name: string;
  displayName: string;
  description: string;
  map: {
    widthKm: number;
    heightKm: number;
  };
  timeline: {
    seasonLengthDays: number;
    dayDurationHours: number;
    dailyMicroInteractions: string[];
  };
  seasons: ScenarioSeason[];
  resources: ScenarioResources;
  hazards: ScenarioHazards;
  tasks: ScenarioTask[];
  agentPopulation: ScenarioAgentPopulation;
  cognition: ScenarioCognition;
  network: ScenarioNetwork;
  logging: ScenarioLogging;
  llm: ScenarioLLM;
  defaults: {
    dailyEnergyNeed: number;
  };
}

export interface EmotionState {
  valence: number;
  arousal: number;
  mood: number;
}

export interface SocialMemoryEntry {
  partnerId: string;
  lastInteractionDay: number;
  reciprocity: number;
  resourcesGiven: number;
  resourcesReceived: number;
  sentiment: number;
}

export interface EpisodicMemoryEntry {
  day: number;
  summary: string;
  tags: string[];
  impact: number;
}

export interface SemanticMemory {
  resourceExpectations: number;
  normExpectation: number;
}

export interface AgentPreferences {
  riskTolerance: number;
  normativeAlignment: number;
  socialGoalWeight: number;
  survivalGoalWeight: number;
  memoryFocus: number;
}

export interface AgentState {
  id: string;
  name: string;
  campId: string;
  energy: number;
  hungerDebt: number;
  emotion: EmotionState;
  fehrSchmidt: {
    alpha: number;
    beta: number;
    reputationWeight: number;
    normPenalty: number;
  };
  reputation: number;
  skillset: Record<string, number>;
  preferences: AgentPreferences;
  semanticMemory: SemanticMemory;
  socialMemory: SocialMemoryEntry[];
  episodicMemory: EpisodicMemoryEntry[];
  lastReflectionDay: number;
  lastActions: string[];
}

export interface EnvironmentState {
  day: number;
  seasonIndex: number;
  seasonDay: number;
  resourceLevel: {
    plants: number;
    smallGame: number;
    largeGame: number;
  };
  climateShock: number;
  riskModifier: HazardRates;
}

export interface NetworkEdge {
  source: string;
  target: string;
  weight: number;
}

export interface NetworkState {
  edges: NetworkEdge[];
  forgetFactor: number;
  campMembership: Record<string, string>;
}

export interface TaskAssignment {
  taskId: string;
  participants: string[];
  outcome: 'success' | 'failure';
  reward: number;
  injuries: string[];
  notes?: string;
}

export interface DailyMetrics {
  cooperationRate: number;
  energyBalance: number;
  riskIncidents: number;
  inequalityIndex: number;
  networkAssortativity: number;
  reciprocity: number;
}

export interface SimulationLogEntry {
  day: number;
  agentId?: string;
  type: 'task' | 'interaction' | 'emotion' | 'reflection' | 'allocation';
  summary: string;
  detail: string;
}

export interface CausalLink {
  source: string;
  target: string;
  weight: number;
}

export interface SimulationStepResult {
  newState: SimulationState;
  assignments: TaskAssignment[];
  metrics: DailyMetrics;
  logs: SimulationLogEntry[];
  causalGraph: CausalLink[];
  networkStats?: {
    reciprocity: number;
    assortativity: number;
    clustering: number;
  };
}

export interface SimulationState {
  environment: EnvironmentState;
  agents: AgentState[];
  network: NetworkState;
  rngSeed: number;
  environmentRngSeed: number;
}

export interface PersistedRunState {
  scenarioName: string;
  currentDay: number;
  stateJson: string;
  runId: Id<'hadzaRuns'>;
}

export type ProviderName = 'openai-responses' | 'bedrock-converse' | 'ollama';

export interface PlanRequest {
  day: number;
  season: SeasonName;
  environment: EnvironmentState;
  agents: AgentState[];
  pendingTasks: ScenarioTask[];
}

export interface PlanResponse {
  plans: Array<{
    agentId: string;
    intent: string;
    rationale: string;
  }>;
  usage: {
    provider: ProviderName | string;
    latencyMs?: number;
  };
}

