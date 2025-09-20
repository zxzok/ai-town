import { ScenarioConfig, EnvironmentState, HazardRates, ScenarioSeason } from './types';
import { SeededRandom } from './random';

export interface EnvironmentTickResult {
  state: EnvironmentState;
  season: ScenarioSeason;
}

function gammaSample(rng: SeededRandom, shape: number, scale: number): number {
  if (shape < 1) {
    const u = rng.next();
    return gammaSample(rng, shape + 1, scale) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      const u1 = rng.next();
      const u2 = rng.next();
      const r = Math.sqrt(-2 * Math.log(u1));
      const theta = 2 * Math.PI * u2;
      x = r * Math.cos(theta);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.next();
    if (u < 1 - 0.0331 * Math.pow(x, 4)) {
      return scale * d * v;
    }
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return scale * d * v;
    }
  }
}

function logGaussianSample(rng: SeededRandom, mean: number, variance: number) {
  const u1 = rng.next() || 1e-6;
  const u2 = rng.next();
  const standardNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const value = Math.exp(mean + Math.sqrt(variance) * standardNormal);
  return value;
}

function clampRisk(rate: number) {
  return Math.max(0, Math.min(1, rate));
}

export class SeasonalEnvironment {
  private config: ScenarioConfig;
  private rng: SeededRandom;
  private state: EnvironmentState;

  constructor(config: ScenarioConfig, state: EnvironmentState, rng: SeededRandom) {
    this.config = config;
    this.state = state;
    this.rng = rng;
  }

  static initialize(config: ScenarioConfig, seedOrRng: number | SeededRandom): SeasonalEnvironment {
    const rng = typeof seedOrRng === 'number' ? new SeededRandom(seedOrRng) : seedOrRng;
    const initialHazard = this.composeHazard(config, 0);
    const initialState: EnvironmentState = {
      day: 0,
      seasonIndex: 0,
      seasonDay: 0,
      resourceLevel: {
        plants: config.resources.basePlantRate,
        smallGame: config.resources.baseSmallGameRate,
        largeGame: config.resources.baseLargeGameRate,
      },
      climateShock: 0,
      riskModifier: initialHazard,
    };
    return new SeasonalEnvironment(config, initialState, rng);
  }

  static composeHazard(config: ScenarioConfig, seasonIndex: number): HazardRates {
    const season = config.seasons[seasonIndex % config.seasons.length];
    const seasonal = config.hazards.seasonal?.[season.name] ?? {};
    return {
      injury: clampRisk(config.hazards.base.injury + (seasonal.injury ?? 0)),
      hypothermia: clampRisk(config.hazards.base.hypothermia + (seasonal.hypothermia ?? 0)),
      predator: clampRisk(config.hazards.base.predator + (seasonal.predator ?? 0)),
    };
  }

  serialize(): EnvironmentState {
    return { ...this.state, resourceLevel: { ...this.state.resourceLevel }, riskModifier: { ...this.state.riskModifier } };
  }

  tick(): EnvironmentTickResult {
    const { timeline, resources, seasons } = this.config;
    const nextDay = this.state.day + 1;
    const seasonLength = timeline.seasonLengthDays;
    const seasonIndex = Math.floor(nextDay / seasonLength) % seasons.length;
    const seasonDay = nextDay % seasonLength;
    const season = seasons[seasonIndex];

    const gamma = gammaSample(this.rng, resources.poissonGamma.shape, resources.poissonGamma.scale);
    const climateShock = season.climateNoise
      ? this.rng.range(-season.climateNoise, season.climateNoise)
      : 0;
    const logGaussian = resources.logGaussian
      ? logGaussianSample(this.rng, resources.logGaussian.mean, resources.logGaussian.variance)
      : 1;

    const baseMultiplier = season.resourceMultiplier * Math.max(0.1, gamma + climateShock);
    const plants = resources.basePlantRate * baseMultiplier * logGaussian;
    const smallGame = resources.baseSmallGameRate * baseMultiplier * 0.8;
    const largeGameBase = resources.baseLargeGameRate * baseMultiplier;
    const seasonalBonus = resources.seasonalLargeGameBonus?.[season.name] ?? 0;
    const largeGame = largeGameBase + seasonalBonus;

    const riskModifier = SeasonalEnvironment.composeHazard(this.config, seasonIndex);

    this.state = {
      day: nextDay,
      seasonIndex,
      seasonDay,
      resourceLevel: {
        plants,
        smallGame,
        largeGame,
      },
      climateShock,
      riskModifier,
    };

    return {
      state: this.serialize(),
      season,
    };
  }
}

