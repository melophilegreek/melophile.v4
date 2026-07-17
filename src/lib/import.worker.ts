/// <reference lib="webworker" />
import { extractMeta } from './metadataParser';

// Each request carries an opaque `id` (the index of the file in the original
// import batch) so the main thread can match responses back up even though
// they may resolve out of order across a pool of several workers.
export interface WorkerRequest { id: number; file: File }
export interface WorkerResponse { id: number; meta: Awaited<ReturnType<typeof extractMeta>> }

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, file } = e.data;
  const meta = await extractMeta(file);
  const response: WorkerResponse = { id, meta };
  // Transfer the art buffer instead of copying it back across the thread
  // boundary — it's the only large payload here.
  const transfer = meta.artData ? [meta.artData] : [];
  (self as unknown as Worker).postMessage(response, transfer);
};
