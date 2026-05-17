/**
 * Granite client — node-llama-cpp wrapper for IBM Granite 3.3 2B Instruct.
 *
 * Model path: ~/.routeguard/models/granite-3.3-2b-instruct-Q4_K_M.gguf
 * Loaded once per process; fresh context per call to prevent reasoning bleed.
 */
export declare const MODEL_PATH: string;
export declare function isModelReady(): boolean;
export interface ThinkParams {
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
}
/**
 * Sends a single-turn prompt to Granite 3.3 2B.
 *
 * Each call creates a fresh context so reasoning from one route cannot
 * bleed into the next. The model weights are reused (loaded once).
 */
export declare function think(params: ThinkParams): Promise<string>;
