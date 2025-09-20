import { ScenarioConfig, PlanRequest, PlanResponse, ProviderName } from './types';

async function safeFetch(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`LLM request failed with ${res.status}`);
  }
  return res;
}

interface Adapter {
  provider: ProviderName | string;
  isEnabled(): boolean;
  generatePlan(request: PlanRequest, prompt: string): Promise<PlanResponse>;
}

class OpenAIResponsesAdapter implements Adapter {
  provider: ProviderName = 'openai-responses';

  isEnabled(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async generatePlan(request: PlanRequest, prompt: string): Promise<PlanResponse> {
    const res = await safeFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_RESPONSES_MODEL ?? 'gpt-4o-mini',
        input: prompt,
        temperature: 0.4,
        max_output_tokens: 500,
      }),
    });
    const json = (await res.json()) as { output_text?: string };
    const text = json.output_text ?? '';
    return {
      plans: [{ agentId: 'group', intent: text.slice(0, 2000), rationale: 'llm_plan' }],
      usage: { provider: this.provider },
    };
  }
}

class BedrockConverseAdapter implements Adapter {
  provider: ProviderName = 'bedrock-converse';

  isEnabled(): boolean {
    return Boolean(process.env.BEDROCK_CONVERSE_URL && process.env.BEDROCK_CONVERSE_MODEL);
  }

  async generatePlan(request: PlanRequest, prompt: string): Promise<PlanResponse> {
    const endpoint = process.env.BEDROCK_CONVERSE_URL!;
    const res = await safeFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: process.env.BEDROCK_CONVERSE_AUTH ?? '',
      },
      body: JSON.stringify({
        modelId: process.env.BEDROCK_CONVERSE_MODEL,
        inputText: prompt,
      }),
    });
    const json = (await res.json()) as { outputText?: string };
    return {
      plans: [
        {
          agentId: 'group',
          intent: json.outputText ?? '',
          rationale: 'bedrock_plan',
        },
      ],
      usage: { provider: this.provider },
    };
  }
}

class OllamaAdapter implements Adapter {
  provider: ProviderName = 'ollama';

  isEnabled(): boolean {
    return Boolean(process.env.OLLAMA_HOST);
  }

  async generatePlan(request: PlanRequest, prompt: string): Promise<PlanResponse> {
    const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
    const res = await safeFetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_PLAN_MODEL ?? 'llama3',
        prompt,
        options: { temperature: 0.4 },
      }),
    });
    const text = await res.text();
    return {
      plans: [
        {
          agentId: 'group',
          intent: text,
          rationale: 'ollama_plan',
        },
      ],
      usage: { provider: this.provider },
    };
  }
}

function heuristicPlan(request: PlanRequest, prompt: string): PlanResponse {
  const intents = request.pendingTasks.map((task) => ({
    agentId: task.id,
    intent: `allocate ${task.recommendedParticipants} participants to ${task.name}`,
    rationale: 'heuristic_allocation',
  }));
  if (!intents.length) {
    intents.push({ agentId: 'none', intent: 'rest and monitor resources', rationale: 'idle_day' });
  }
  return {
    plans: intents,
    usage: { provider: 'heuristic' },
  };
}

function buildPrompt(config: ScenarioConfig, request: PlanRequest): string {
  const season = config.seasons.find((season) => season.name === request.season);
  const summary = `Day ${request.day} in ${config.displayName}. Current season: ${season?.name}.`;
  const resourceSummary = `Resources -> plants: ${request.environment.resourceLevel.plants.toFixed(
    2,
  )}, small game: ${request.environment.resourceLevel.smallGame.toFixed(
    2,
  )}, large game: ${request.environment.resourceLevel.largeGame.toFixed(2)}.`;
  const tasks = request.pendingTasks
    .map((task) => `${task.name}: success ${task.successProbability ?? task.successProbability} with norm ${task.norm}`)
    .join('\n');
  return [summary, resourceSummary, 'Available tasks:', tasks, config.llm.planTemplate].join('\n');
}

export class LLMDecisionCore {
  private adapters: Adapter[];
  private config: ScenarioConfig;

  constructor(config: ScenarioConfig) {
    this.config = config;
    this.adapters = [new OpenAIResponsesAdapter(), new BedrockConverseAdapter(), new OllamaAdapter()];
  }

  async plan(request: PlanRequest): Promise<PlanResponse> {
    const prompt = buildPrompt(this.config, request);
    for (const adapter of this.adapters) {
      if (!adapter.isEnabled()) continue;
      try {
        return await adapter.generatePlan(request, prompt);
      } catch (error) {
        console.warn(`LLM provider ${adapter.provider} failed:`, error);
      }
    }
    return heuristicPlan(request, prompt);
  }
}

