export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export interface ChatJSONOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  seed?: number;
  responseFormat?: 'json_object' | 'text';
}

export interface ChatJSONResponse {
  content: string;
  usage?: TokenUsage;
  raw: unknown;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

const DEFAULT_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini';
const DEFAULT_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.OPENAI_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;
  }
  return headers;
}

function logStructured(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data }));
}

export async function chatJSON(options: ChatJSONOptions): Promise<ChatJSONResponse> {
  const body: Record<string, unknown> = {
    model: options.model ?? DEFAULT_CHAT_MODEL,
    messages: options.messages,
    temperature: options.temperature ?? 0.15,
    top_p: options.top_p ?? undefined,
    max_tokens: options.maxTokens ?? undefined,
    response_format: options.responseFormat === 'text' ? undefined : { type: 'json_object' },
  };
  if (options.seed !== undefined) {
    body.seed = options.seed;
  }
  logStructured('configurator.llm.chat.start', {
    model: body.model,
    temperature: body.temperature,
    top_p: body.top_p,
    seed: body.seed,
  });
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    logStructured('configurator.llm.chat.error', {
      status: response.status,
      body: text,
    });
    throw new Error(`Chat completion failed with status ${response.status}: ${text}`);
  }
  const json = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM response missing content');
  }
  const usage: TokenUsage | undefined = json.usage
    ? {
        promptTokens: json.usage.prompt_tokens,
        completionTokens: json.usage.completion_tokens,
        totalTokens: json.usage.total_tokens,
      }
    : undefined;
  logStructured('configurator.llm.chat.success', {
    model: body.model,
    usage,
  });
  return { content, usage, raw: json };
}

export async function embeddings(input: string | string[], model = DEFAULT_EMBEDDING_MODEL): Promise<number[][]> {
  const payload = {
    model,
    input,
  };
  logStructured('configurator.llm.embedding.start', { model, items: Array.isArray(input) ? input.length : 1 });
  const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    logStructured('configurator.llm.embedding.error', {
      status: response.status,
      body: text,
    });
    throw new Error(`Embedding request failed with status ${response.status}: ${text}`);
  }
  const json = JSON.parse(text) as { data?: Array<{ embedding: number[] }> };
  const vectors = json.data?.map((item) => item.embedding);
  if (!vectors) {
    throw new Error('Embedding response missing data');
  }
  logStructured('configurator.llm.embedding.success', { model, vectors: vectors.length });
  return vectors;
}
