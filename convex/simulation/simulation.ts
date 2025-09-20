import { AgentState, PlanRequest, PlanResponse, ScenarioConfig, ScenarioTask, SeasonName, SimulationState, SimulationStepResult } from './types';
import { SeasonalEnvironment } from './environment';
import { TaskPlanner, TaskExecution } from './tasks';
import { CognitionEngine, EmotionStimulus } from './cognition';
import { SocialNetwork } from './network';
import { SimulationLogger } from './logging';
import { LLMDecisionCore } from './llmAdapters';
import { SeededRandom } from './random';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function sampleNormal(rng: SeededRandom, mean: number, std: number) {
  const u1 = rng.next() || 1e-6;
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

function buildAgentId(index: number) {
  return `agent_${index + 1}`;
}

function initializeAgents(config: ScenarioConfig, rng: SeededRandom) {
  const agents: AgentState[] = [];
  const camps = ['Camp-A', 'Camp-B', 'Camp-C'];
  const campMembership: Record<string, string> = {};
  for (let i = 0; i < config.agentPopulation.size; i++) {
    const id = buildAgentId(i);
    const camp = camps[i % camps.length];
    campMembership[id] = camp;
    const skillset: Record<string, number> = {};
    Object.entries(config.agentPopulation.skillProfiles).forEach(([key, { mean, std }]) => {
      const raw = sampleNormal(rng, mean, std);
      skillset[key] = clamp(raw, 0, 1.2);
    });
    const alpha = clamp(sampleNormal(rng, config.agentPopulation.socialPreferences.alphaMean, config.agentPopulation.socialPreferences.alphaStd), 0, 2);
    const beta = clamp(sampleNormal(rng, config.agentPopulation.socialPreferences.betaMean, config.agentPopulation.socialPreferences.betaStd), 0, 2);
    const reputationWeight = clamp(
      sampleNormal(rng, config.agentPopulation.socialPreferences.reputationWeight, 0.1),
      0,
      1,
    );
    const normPenalty = clamp(sampleNormal(rng, config.agentPopulation.socialPreferences.normPenalty, 0.1), 0, 1);
    const preferences = {
      riskTolerance: clamp(sampleNormal(rng, 0.5, 0.2), 0, 1),
      normativeAlignment: clamp(sampleNormal(rng, 0.6, 0.2), 0, 1),
      socialGoalWeight: clamp(sampleNormal(rng, 0.55, 0.15), 0, 1),
      survivalGoalWeight: clamp(sampleNormal(rng, 0.7, 0.15), 0, 1),
      memoryFocus: clamp(sampleNormal(rng, 0.5, 0.2), 0, 1),
    };
    agents.push({
      id,
      name: `Forager-${i + 1}`,
      campId: camp,
      energy: config.defaults.dailyEnergyNeed * 1.2,
      hungerDebt: 0,
      emotion: {
        valence: config.cognition.emotion.baselineValence,
        arousal: config.cognition.emotion.baselineArousal,
        mood: config.cognition.emotion.baselineValence,
      },
      fehrSchmidt: {
        alpha,
        beta,
        reputationWeight,
        normPenalty,
      },
      reputation: 0.5,
      skillset,
      preferences,
      semanticMemory: {
        resourceExpectations: 1,
        normExpectation: 0.5,
      },
      socialMemory: [],
      episodicMemory: [],
      lastReflectionDay: -1,
      lastActions: [],
    });
  }
  return { agents, campMembership };
}

function deepCloneAgents(agents: AgentState[]): AgentState[] {
  return agents.map((agent) => ({
    ...agent,
    skillset: { ...agent.skillset },
    preferences: { ...agent.preferences },
    semanticMemory: { ...agent.semanticMemory },
    socialMemory: agent.socialMemory.map((entry) => ({ ...entry })),
    episodicMemory: agent.episodicMemory.map((entry) => ({ ...entry })),
    lastActions: [...agent.lastActions],
  }));
}

function orderTasksByPlan(plan: PlanResponse, tasks: ScenarioTask[]): ScenarioTask[] {
  const weights = new Map<string, number>();
  plan.plans.forEach((item, index) => {
    tasks.forEach((task) => {
      const normalized = item.intent.toLowerCase();
      if (normalized.includes(task.id) || normalized.includes(task.name)) {
        if (!weights.has(task.id)) {
          weights.set(task.id, index);
        }
      }
    });
  });
  return [...tasks].sort((a, b) => {
    const aw = weights.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bw = weights.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return aw - bw;
  });
}

export class CooperationSimulation {
  private config: ScenarioConfig;
  private environment: SeasonalEnvironment;
  private network: SocialNetwork;
  private planner: TaskPlanner;
  private cognition: CognitionEngine;
  private logger: SimulationLogger;
  private llm: LLMDecisionCore;
  private rng: SeededRandom;
  private agents: AgentState[];

  constructor(
    config: ScenarioConfig,
    environment: SeasonalEnvironment,
    network: SocialNetwork,
    planner: TaskPlanner,
    cognition: CognitionEngine,
    logger: SimulationLogger,
    llm: LLMDecisionCore,
    rng: SeededRandom,
    agents: AgentState[],
  ) {
    this.config = config;
    this.environment = environment;
    this.network = network;
    this.planner = planner;
    this.cognition = cognition;
    this.logger = logger;
    this.llm = llm;
    this.rng = rng;
    this.agents = agents;
  }

  static initialize(config: ScenarioConfig, seed: number = Date.now()): CooperationSimulation {
    const rng = new SeededRandom(seed);
    const environment = SeasonalEnvironment.initialize(config, rng);
    const { agents, campMembership } = initializeAgents(config, rng);
    const network = SocialNetwork.initialize(config, agents.map((agent) => agent.id), campMembership);
    const planner = new TaskPlanner(config);
    const cognition = new CognitionEngine(config);
    const logger = new SimulationLogger({ events: config.logging.eventLog, causal: config.logging.causalGraph });
    const llm = new LLMDecisionCore(config);
    return new CooperationSimulation(config, environment, network, planner, cognition, logger, llm, rng, agents);
  }

  static fromState(config: ScenarioConfig, state: SimulationState): CooperationSimulation {
    const rng = new SeededRandom(state.rngSeed);
    const environment = new SeasonalEnvironment(config, state.environment, rng);
    const network = new SocialNetwork(config, state.network);
    const planner = new TaskPlanner(config);
    const cognition = new CognitionEngine(config);
    const logger = new SimulationLogger({ events: config.logging.eventLog, causal: config.logging.causalGraph });
    const llm = new LLMDecisionCore(config);
    return new CooperationSimulation(config, environment, network, planner, cognition, logger, llm, rng, deepCloneAgents(state.agents));
  }

  serialize(): SimulationState {
    const nextSeed = Math.floor(this.rng.next() * 1_000_000_000);
    return {
      environment: this.environment.serialize(),
      agents: deepCloneAgents(this.agents),
      network: this.network.toState(),
      rngSeed: nextSeed,
      environmentRngSeed: nextSeed,
    };
  }

  private createPlanRequest(): PlanRequest {
    const envState = this.environment.serialize();
    const seasonName: SeasonName = this.config.seasons[envState.seasonIndex % this.config.seasons.length].name;
    return {
      day: envState.day,
      season: seasonName,
      environment: envState,
      agents: deepCloneAgents(this.agents),
      pendingTasks: this.config.tasks,
    };
  }

  private applyExecutions(executions: TaskExecution[], day: number) {
    const energyNeed = this.config.defaults.dailyEnergyNeed;
    const agentIndex = new Map(this.agents.map((agent) => [agent.id, agent]));
    this.network.applyDecay();
    executions.forEach((execution) => {
      const participants = execution.assignment.participants
        .map((id) => agentIndex.get(id))
        .filter((agent): agent is AgentState => Boolean(agent));
      if (!participants.length) return;
      const baseShare = execution.assignment.participants.length
        ? execution.assignment.reward / execution.assignment.participants.length
        : 0;
      participants.forEach((agent) => {
        const share = execution.rewards[agent.id] ?? 0;
        const cost = execution.energyCost[agent.id] ?? 0;
        agent.energy = Math.max(0, agent.energy + share - cost - energyNeed);
        if (agent.energy < energyNeed * 0.5) {
          agent.hungerDebt += energyNeed * 0.5 - agent.energy;
        }
        if (execution.assignment.injuries.includes(agent.id)) {
          agent.energy = Math.max(0, agent.energy - 0.2);
          const stimulus: EmotionStimulus = {
            goalAlignment: -0.6,
            normAlignment: -0.2,
            preferenceAlignment: -0.3,
            arousal: 0.6,
            summary: `Suffered injury during ${execution.assignment.taskId}.`,
            tags: ['injury', execution.assignment.taskId],
            impact: -0.7,
          };
          this.cognition.applyStimulus(agent, day, stimulus);
        }
        const fairness = baseShare === 0 ? 0 : (share - baseShare) / Math.max(baseShare, 0.001);
        const stimulus: EmotionStimulus = {
          goalAlignment: execution.assignment.outcome === 'success' ? 0.8 : -0.4,
          normAlignment: fairness >= -agent.fehrSchmidt.normPenalty ? 0.3 : -0.3,
          preferenceAlignment: share >= energyNeed ? 0.2 : -0.1,
          arousal: execution.assignment.outcome === 'success' ? 0.2 : 0.4,
          summary: `${execution.assignment.taskId} ${execution.assignment.outcome} with share ${share.toFixed(2)}.`,
          tags: ['task', execution.assignment.taskId],
          impact: execution.assignment.outcome === 'success' ? 0.5 : -0.2,
        };
        this.cognition.applyStimulus(agent, day, stimulus);
        agent.reputation = clamp(
          agent.reputation + (execution.assignment.outcome === 'success' ? 0.05 : -0.03),
          0,
          1,
        );
        participants.forEach((partner) => {
          if (partner.id === agent.id) return;
          this.cognition.registerInteraction(
            agent,
            partner.id,
            day,
            execution.assignment.outcome === 'success' ? 0.2 : -0.1,
            share,
            execution.rewards[partner.id] ?? 0,
            fairness,
          );
          this.network.reinforceInteraction(agent.id, partner.id, 0.2 + share * 0.05);
        });
        agent.lastActions = [execution.assignment.taskId];
      });
      if (this.config.logging.taskLog) {
        this.logger.record({
          day,
          type: 'task',
          summary: `${execution.assignment.taskId} ${execution.assignment.outcome}`,
          detail: JSON.stringify(execution),
        });
      }
    });
    this.agents.forEach((agent) => {
      const reflection = this.cognition.reflect(agent, day);
      if (reflection) {
        this.logger.record({ day, type: 'reflection', agentId: agent.id, summary: reflection, detail: reflection });
      }
    });
  }

  async stepDay(): Promise<SimulationStepResult> {
    const planRequest = this.createPlanRequest();
    const plan = await this.llm.plan(planRequest);
    const orderedTasks = orderTasksByPlan(plan, this.config.tasks);
    const envTick = this.environment.tick();
    const executions = this.planner.assignTasks(
      this.rng,
      this.agents,
      envTick.state.resourceLevel,
      orderedTasks,
    );
    this.applyExecutions(executions, envTick.state.day);
    const metrics = this.planner.evaluateCooperation(executions, this.agents);
    const networkStats = this.network.computeStats();
    metrics.networkAssortativity = networkStats.assortativity;
    metrics.reciprocity = networkStats.reciprocity;
    const logs = this.logger.flush();
    const nextSeed = Math.floor(this.rng.next() * 1_000_000_000);
    const newState: SimulationState = {
      environment: envTick.state,
      agents: deepCloneAgents(this.agents),
      network: this.network.toState(),
      rngSeed: nextSeed,
      environmentRngSeed: nextSeed,
    };
    return {
      newState,
      assignments: executions.map((execution) => execution.assignment),
      metrics,
      logs: logs.entries,
      causalGraph: logs.causal,
      networkStats,
    };
  }
}

