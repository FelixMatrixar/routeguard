"use strict";
/**
 * Granite client — node-llama-cpp wrapper for IBM Granite 3.3 2B Instruct.
 *
 * Model path: ~/.routeguard/models/granite-3.3-2b-instruct-Q4_K_M.gguf
 * Loaded once per process; fresh context per call to prevent reasoning bleed.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODEL_PATH = void 0;
exports.isModelReady = isModelReady;
exports.think = think;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
exports.MODEL_PATH = (0, path_1.join)((0, os_1.homedir)(), '.routeguard', 'models', 'granite-3.3-2b-instruct-Q4_K_M.gguf');
function isModelReady() {
    return (0, fs_1.existsSync)(exports.MODEL_PATH);
}
// Lazily-loaded model reference — weights loaded once per process
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedModel = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedLlama = null;
async function getModel() {
    if (cachedModel && cachedLlama)
        return { llama: cachedLlama, model: cachedModel };
    // Dynamic import — node-llama-cpp is an optional dependency.
    // If it's not installed the MCP server still runs; ai_analyze_route
    // returns { modelReady: false } instead of throwing.
    const { getLlama } = await Promise.resolve().then(() => __importStar(require('node-llama-cpp')));
    cachedLlama = await getLlama();
    cachedModel = await cachedLlama.loadModel({ modelPath: exports.MODEL_PATH });
    return { llama: cachedLlama, model: cachedModel };
}
/**
 * Sends a single-turn prompt to Granite 3.3 2B.
 *
 * Each call creates a fresh context so reasoning from one route cannot
 * bleed into the next. The model weights are reused (loaded once).
 */
async function think(params) {
    const { model } = await getModel();
    const context = await model.createContext({ contextSize: 8192 });
    const { LlamaChatSession } = await Promise.resolve().then(() => __importStar(require('node-llama-cpp')));
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
