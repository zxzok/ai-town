import { SeededRandom } from './random';
import {
  AgentState,
  DailyMetrics,
  ScenarioConfig,
  ScenarioTask,
  TaskAssignment,
} from './types';
import { fehrSchmidtUtility } from './cognition';

export interface TaskExecution {
  assignment: TaskAssignment;
  rewards: Record<string, number>;
  energyCost: Record<string, number>;
  successProbability: number;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function skillKey(task: ScenarioTask) {
  if (task.category === 'foraging') return 'gathering';
  if (task.category === 'public_good') return 'crafting';
  return 'hunting';
}

function computeShare(task: ScenarioTask, agents: AgentState[], totalReward: number): Record<string, number> {
  if (!agents.length || totalReward <= 0) {
    return Object.fromEntries(agents.map((a) => [a.id, 0]));
  }
  const result: Record<string, number> = {};
  const baseShare = totalReward / agents.length;
  switch (task.norm) {
    case 'equal_share': {
      agents.forEach((agent) => {
        result[agent.id] = baseShare;
      });
      break;
    }
    case 'proportional_skill': {
      const key = skillKey(task);
      const total = agents.reduce((acc, agent) => acc + (agent.skillset[key] ?? 0.5), 0);
      agents.forEach((agent) => {
        const weight = (agent.skillset[key] ?? 0.5) / (total || agents.length);
        result[agent.id] = totalReward * weight;
      });
      break;
    }
    case 'key_contributor_reward': {
      const key = skillKey(task);
      const sorted = [...agents].sort((a, b) => (b.skillset[key] ?? 0.5) - (a.skillset[key] ?? 0.5));
      const bonusPool = totalReward * 0.25;
      const basePool = totalReward - bonusPool;
      const elite = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 3)));
      const bonusShare = bonusPool / elite.length;
      agents.forEach((agent) => {
        const base = basePool / agents.length;
        const bonus = elite.includes(agent) ? bonusShare : 0;
        result[agent.id] = base + bonus;
      });
      break;
    }
    case 'collective_penalty':
    default: {
      agents.forEach((agent) => {
        result[agent.id] = 0;
      });
      break;
    }
  }
  return result;
}

function computeSuccessProbability(task: ScenarioTask, participants: AgentState[], resourceLevel: number) {
  const key = skillKey(task);
  const avgSkill = participants.reduce((acc, agent) => acc + (agent.skillset[key] ?? 0.5), 0) / (participants.length || 1);
  const participantBonus = 0.05 * Math.max(participants.length - task.minParticipants, 0);
  const skillBonus = 0.1 * (avgSkill - 0.5);
  const resourceBonus = resourceLevel > 0 ? 0.05 * Math.log(1 + resourceLevel) : -0.1;
  return clamp01(task.successProbability + participantBonus + skillBonus + resourceBonus);
}

function computeEnergyCost(task: ScenarioTask, participants: AgentState[]): Record<string, number> {
  const cost: Record<string, number> = {};
  const base = task.energyCost;
  participants.forEach((agent) => {
    const modifier = task.category === 'hunting' ? 1 + (1 - (agent.skillset.hunting ?? 0.5)) * 0.2 : 1;
    cost[agent.id] = base * modifier;
  });
  return cost;
}

export class TaskPlanner {
  constructor(private config: ScenarioConfig) {}

  assignTasks(
    rng: SeededRandom,
    agents: AgentState[],
    resourceAvailability: { plants: number; smallGame: number; largeGame: number },
    taskSequence?: ScenarioTask[],
  ): TaskExecution[] {
    const shuffled = [...agents];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const availableAgents = new Set(shuffled.map((agent) => agent.id));
    const executions: TaskExecution[] = [];
    const resourceByTask: Record<string, number> = {
      foraging: resourceAvailability.plants,
      hunting: resourceAvailability.smallGame + resourceAvailability.largeGame,
      public_good: resourceAvailability.plants,
    };
    const tasks = taskSequence ?? this.config.tasks;
    tasks.forEach((task) => {
      const need = Math.min(task.recommendedParticipants, availableAgents.size);
      if (need < task.minParticipants) {
        return;
      }
      const participants: AgentState[] = [];
      shuffled.forEach((agent) => {
        if (participants.length >= need) return;
        if (!availableAgents.has(agent.id)) return;
        if (task.category === 'hunting' && (agent.skillset.hunting ?? 0.5) < 0.3) {
          return;
        }
        participants.push(agent);
        availableAgents.delete(agent.id);
      });
      if (participants.length < task.minParticipants) {
        // return unassigned agents
        participants.forEach((agent) => availableAgents.add(agent.id));
        return;
      }
      const resourceLevel = resourceByTask[task.category] ?? 1;
      const successProbability = computeSuccessProbability(task, participants, resourceLevel);
      const success = rng.next() < successProbability;
      const rewardPerParticipant = task.yieldPerParticipant ?? task.yieldPerParticipantOnSuccess ?? 0;
      const totalReward = success
        ? rewardPerParticipant * (task.yieldPerParticipant ? participants.length : 1)
        : 0;
      const rewards = computeShare(task, participants, totalReward);
      const energyCost = computeEnergyCost(task, participants);
      const injuries: string[] = [];
      const riskMultiplier = task.injuryRiskMultiplier;
      participants.forEach((agent) => {
        const risk = clamp01(riskMultiplier * this.config.hazards.base.injury);
        if (rng.next() < risk * (success ? 0.7 : 1.1)) {
          injuries.push(agent.id);
        }
      });
      executions.push({
        assignment: {
          taskId: task.id,
          participants: participants.map((a) => a.id),
          outcome: success ? 'success' : 'failure',
          reward: totalReward,
          injuries,
          notes: success ? 'coordinated effort succeeded' : 'insufficient payoff',
        },
        rewards,
        energyCost,
        successProbability,
      });
    });
    // idle agents default to camp maintenance if nothing else
    if (availableAgents.size) {
      const maintenance = tasks.find((task) => task.id === 'camp_maintenance') ??
        this.config.tasks.find((task) => task.id === 'camp_maintenance');
      if (maintenance) {
        const participants = shuffled.filter((agent) => availableAgents.has(agent.id));
        const rewards = computeShare(maintenance, participants, 0);
        const energyCost = computeEnergyCost(maintenance, participants);
        executions.push({
          assignment: {
            taskId: maintenance.id,
            participants: participants.map((a) => a.id),
            outcome: 'success',
            reward: 0,
            injuries: [],
            notes: 'fallback maintenance duty',
          },
          rewards,
          energyCost,
          successProbability: 1,
        });
      }
    }
    return executions;
  }

  evaluateCooperation(executions: TaskExecution[], agents: AgentState[]): DailyMetrics {
    const cooperativeAssignments = executions.filter((exec) => exec.assignment.participants.length > 1).length;
    const cooperationRate = executions.length ? cooperativeAssignments / executions.length : 0;
    let energyBalance = 0;
    const inequalitySamples: number[] = [];
    let riskIncidents = 0;
    executions.forEach((exec) => {
      Object.entries(exec.rewards).forEach(([agentId, reward]) => {
        const agent = agents.find((a) => a.id === agentId);
        if (!agent) return;
        const utility = fehrSchmidtUtility(
          reward,
          Object.entries(exec.rewards)
            .filter(([id]) => id !== agentId)
            .map(([, share]) => share),
          agent.fehrSchmidt.alpha,
          agent.fehrSchmidt.beta,
        );
        inequalitySamples.push(utility);
      });
      Object.values(exec.energyCost).forEach((cost) => {
        energyBalance -= cost;
      });
      energyBalance += exec.assignment.reward;
      riskIncidents += exec.assignment.injuries.length;
    });
    const inequalityIndex = inequalitySamples.length
      ? inequalitySamples.reduce((acc, value) => acc + value, 0) / inequalitySamples.length
      : 0;
    return {
      cooperationRate,
      energyBalance,
      riskIncidents,
      inequalityIndex,
      networkAssortativity: 0,
      reciprocity: 0,
    };
  }
}

