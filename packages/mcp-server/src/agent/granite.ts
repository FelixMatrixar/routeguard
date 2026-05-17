/**
 * Granite client — node-llama-cpp wrapper for IBM Granite 3.3 2B Instruct.
 *
 * Model path: ~/.routeguard/models/granite-3.3-2b-instruct-Q4_K_M.gguf
 * Loaded once per process; fresh context per call to prevent reasoning bleed.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const MODEL_PATH = join(
  homedir(),
  '.routeguard',
  'models',
  'granite-3.3-2b-instruct-Q4_K_M.gguf'
);

export function isModelReady(): boolean {
  return existsSync(MODEL_PATH);
}

export interface ThinkParams {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

// Lazily-loaded model reference — weights loaded once per process
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedModel: any | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedLlama: any | null = null;

async function getModel() {
  if (cachedModel && cachedLlama) return { llama: cachedLlama, model: cachedModel };

  // Dynamic import — node-llama-cpp is an optional dependency.
  // If it's not installed the MCP server still runs; ai_analyze_route
  // returns { modelReady: false } instead of throwing.
  const { getLlama } = await import('node-llama-cpp');
  cachedLlama = await getLlama();
  cachedModel = await cachedLlama.loadModel({ modelPath: MODEL_PATH });
  return { llama: cachedLlama, model: cachedModel };
}

/**
 * Sends a single-turn prompt to Granite 3.3 2B.
 *
 * Each call creates a fresh context so reasoning from one route cannot
 * bleed into the next. The model weights are reused (loaded once).
 */
export async function think(params: ThinkParams): Promise<string> {
  const { model } = await getModel();
  const context = await model.createContext({ contextSize: 8192 });

  const { LlamaChatSession } = await import('node-llama-cpp');
  const session = new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt: params.systemPrompt,
  });

  const response = await session.prompt(params.userPrompt, {
    maxTokens: params.maxTokens,
    temperature: 0.1,
  });

  await context.dispose();
  return response;
}
