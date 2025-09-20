import {
  AgentState,
  EmotionState,
  ScenarioConfig,
  SocialMemoryEntry,
  EpisodicMemoryEntry,
} from './types';

export interface EmotionStimulus {
  goalAlignment: number;
  normAlignment: number;
  preferenceAlignment: number;
  arousal: number;
  summary: string;
  tags: string[];
  impact: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function updateEmotion(current: EmotionState, stimulus: EmotionStimulus, decay: number): EmotionState {
  const valenceDelta = 0.6 * stimulus.goalAlignment + 0.3 * stimulus.normAlignment + 0.1 * stimulus.preferenceAlignment;
  const arousalDelta = stimulus.arousal;
  const moodDelta = 0.5 * valenceDelta + 0.2 * arousalDelta;
  return {
    valence: clamp(current.valence * (1 - decay) + valenceDelta, -1, 1),
    arousal: clamp(current.arousal * (1 - decay) + arousalDelta, 0, 1.5),
    mood: clamp(current.mood * (1 - decay / 2) + moodDelta, -1, 1),
  };
}

function updateSocialMemory(
  memory: SocialMemoryEntry[],
  partnerId: string,
  day: number,
  reciprocityDelta: number,
  resourcesGiven: number,
  resourcesReceived: number,
  sentiment: number,
  window: number,
): SocialMemoryEntry[] {
  const filtered = memory.filter((entry) => day - entry.lastInteractionDay <= window && entry.partnerId !== partnerId);
  const existing = memory.find((entry) => entry.partnerId === partnerId);
  const newEntry: SocialMemoryEntry = {
    partnerId,
    lastInteractionDay: day,
    reciprocity: clamp((existing?.reciprocity ?? 0) * 0.6 + reciprocityDelta, -1, 1),
    resourcesGiven: (existing?.resourcesGiven ?? 0) + resourcesGiven,
    resourcesReceived: (existing?.resourcesReceived ?? 0) + resourcesReceived,
    sentiment: clamp((existing?.sentiment ?? 0) * 0.5 + sentiment, -1, 1),
  };
  return [newEntry, ...filtered];
}

export class CognitionEngine {
  constructor(private config: ScenarioConfig) {}

  appraiseTaskOutcome(
    agent: AgentState,
    params: {
      goalAlignment: number;
      normAlignment: number;
      preferenceAlignment: number;
      arousal: number;
      summary: string;
      tags: string[];
      impact: number;
    },
  ): EmotionStimulus {
    return {
      goalAlignment: params.goalAlignment,
      normAlignment: params.normAlignment,
      preferenceAlignment: params.preferenceAlignment,
      arousal: params.arousal,
      summary: params.summary,
      tags: params.tags,
      impact: params.impact,
    };
  }

  applyStimulus(agent: AgentState, day: number, stimulus: EmotionStimulus) {
    const decay = this.config.cognition.emotion.decay;
    agent.emotion = updateEmotion(agent.emotion, stimulus, decay);
    const episodicEntry: EpisodicMemoryEntry = {
      day,
      summary: stimulus.summary,
      tags: stimulus.tags,
      impact: stimulus.impact,
    };
    const horizon = this.config.cognition.episodicWindowDays;
    agent.episodicMemory = [episodicEntry, ...agent.episodicMemory.filter((entry) => day - entry.day <= horizon)];
  }

  registerInteraction(
    agent: AgentState,
    partnerId: string,
    day: number,
    reciprocityDelta: number,
    resourcesGiven: number,
    resourcesReceived: number,
    sentiment: number,
  ) {
    agent.socialMemory = updateSocialMemory(
      agent.socialMemory,
      partnerId,
      day,
      reciprocityDelta,
      resourcesGiven,
      resourcesReceived,
      sentiment,
      this.config.cognition.socialMemoryHorizonDays,
    );
  }

  reflect(agent: AgentState, day: number): string | undefined {
    if (day - agent.lastReflectionDay < this.config.cognition.reflectionIntervalDays) {
      return undefined;
    }
    agent.lastReflectionDay = day;
    const recent = agent.episodicMemory.slice(0, 3);
    const positive = recent.filter((e) => e.impact > 0).length;
    const negative = recent.filter((e) => e.impact < 0).length;
    const tone = positive >= negative ? 'optimistic' : 'concerned';
    const summary = `Reflecting on ${recent.length} key events, mood is ${tone} with valence ${agent.emotion.valence.toFixed(
      2,
    )}.`;
    return summary;
  }
}

export function fehrSchmidtUtility(
  ownShare: number,
  othersShares: number[],
  alpha: number,
  beta: number,
): number {
  const avgOthers = othersShares.length
    ? othersShares.reduce((acc, share) => acc + Math.max(share - ownShare, 0), 0) / othersShares.length
    : 0;
  const avgAdvantage = othersShares.length
    ? othersShares.reduce((acc, share) => acc + Math.max(ownShare - share, 0), 0) / othersShares.length
    : 0;
  return ownShare - alpha * avgOthers - beta * avgAdvantage;
}

