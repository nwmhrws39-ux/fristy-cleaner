/** Worker-thread entry: runs one scan and streams throttled progress to the main process. */
import { parentPort } from 'node:worker_threads';
import { CancelledError, ScanEngine, type EngineState, type EngineTask } from './engine';

if (!parentPort) throw new Error('scanner.worker must run in a worker thread');
const port = parentPort;

let paused = false;
let cancelled = false;
let resumeWaiters: (() => void)[] = [];
let lastProgress = 0;
let pausedAt = 0;
let pausedTotal = 0;
const startedAt = Date.now();

const elapsed = () => Date.now() - startedAt - pausedTotal - (paused ? Date.now() - pausedAt : 0);

function send(state: EngineState, force = false) {
  const now = Date.now();
  if (!force && now - lastProgress < 150) return;
  lastProgress = now;
  port.postMessage({ type: 'progress', state: { ...state }, paused, elapsedMs: elapsed() });
}

port.on('message', (msg: { type: string; task?: EngineTask }) => {
  if (msg.type === 'start' && msg.task) void run(msg.task);
  if (msg.type === 'pause' && !paused) {
    paused = true;
    pausedAt = Date.now();
    port.postMessage({ type: 'paused', paused: true, elapsedMs: elapsed() });
  }
  if (msg.type === 'resume' && paused) {
    paused = false;
    pausedTotal += Date.now() - pausedAt;
    resumeWaiters.forEach((r) => r());
    resumeWaiters = [];
    port.postMessage({ type: 'paused', paused: false, elapsedMs: elapsed() });
  }
  if (msg.type === 'cancel') {
    cancelled = true;
    resumeWaiters.forEach((r) => r());
    resumeWaiters = [];
  }
});

async function run(task: EngineTask) {
  const engine = new ScanEngine(task, {
    progress: (s) => send(s),
    checkpoint: async () => {
      if (cancelled) throw new CancelledError();
      while (paused && !cancelled) await new Promise<void>((r) => resumeWaiters.push(r));
      if (cancelled) throw new CancelledError();
    },
  });
  try {
    const result = await engine.run();
    send(result.state, true);
    port.postMessage({ type: 'result', result, elapsedMs: elapsed() });
  } catch (e) {
    if (e instanceof CancelledError) port.postMessage({ type: 'cancelled', state: engine.state, elapsedMs: elapsed() });
    else port.postMessage({ type: 'error', message: (e as Error)?.stack || String(e), state: engine.state });
  }
}
