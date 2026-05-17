import { createWriteStream, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

export const MODEL_URL =
  'https://huggingface.co/ibm-granite/granite-3.3-2b-instruct-GGUF' +
  '/resolve/main/granite-3.3-2b-instruct-Q4_K_M.gguf';

export const MODEL_DIR  = join(homedir(), '.routeguard', 'models');
export const MODEL_PATH = join(MODEL_DIR, 'granite-3.3-2b-instruct-Q4_K_M.gguf');
const MODEL_TMP = MODEL_PATH + '.part';

export type ProgressCallback = (received: number, total: number) => void;

export function isModelPresent(): boolean {
  return existsSync(MODEL_PATH);
}

export function modelSize(): number {
  if (!isModelPresent()) return 0;
  return statSync(MODEL_PATH).size;
}

export async function downloadModel(onProgress: ProgressCallback): Promise<void> {
  mkdirSync(MODEL_DIR, { recursive: true });

  // Resume support: check how much we already have in the .part file
  let resumeFrom = 0;
  if (existsSync(MODEL_TMP)) {
    resumeFrom = statSync(MODEL_TMP).size;
  }

  const headers: Record<string, string> = {};
  if (resumeFrom > 0) {
    headers['Range'] = `bytes=${resumeFrom}-`;
  }

  const response = await fetch(MODEL_URL, { headers });

  if (!response.ok && response.status !== 206) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? Number(contentLength) + resumeFrom : 0;
  let received = resumeFrom;

  if (!response.body) throw new Error('No response body from HuggingFace');

  const writer = createWriteStream(MODEL_TMP, { flags: resumeFrom > 0 ? 'a' : 'w' });

  // Stream chunks, report progress
  const nodeStream = Readable.fromWeb(
    response.body as Parameters<typeof Readable.fromWeb>[0]
  );

  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (total > 0) onProgress(received, total);
  });

  await pipeline(nodeStream, writer);

  // Verify size if Content-Length was given
  if (total > 0) {
    const actualSize = statSync(MODEL_TMP).size;
    if (actualSize < total * 0.99) {
      throw new Error(
        `Download incomplete: expected ~${fmtBytes(total)}, got ${fmtBytes(actualSize)}. ` +
        `Run 'routeguard setup' again to resume.`
      );
    }
  }

  // Atomic rename: only replace on completion
  if (existsSync(MODEL_PATH)) unlinkSync(MODEL_PATH);
  renameSync(MODEL_TMP, MODEL_PATH);
}

export function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${bytes} B`;
}
