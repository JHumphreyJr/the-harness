import { createReadStream, existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AuditEvent } from './events.js';
import { eventsFile, listRuns } from './run.js';

/**
 * Serves the viewer and streams a run's events to it.
 *
 * The bridge only tails the events file. It holds no reference to a running harness, so
 * attaching or detaching a viewer cannot affect a run, and finished runs replay identically.
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

export const VIEWER_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'viewer', 'dist');

/** Reads complete lines appended to a file since `offset`. */
function readFrom(file: string, offset: number): { events: AuditEvent[]; offset: number } {
  if (!existsSync(file)) return { events: [], offset };
  const size = statSync(file).size;
  if (size <= offset) return { events: [], offset };
  const buffer = Buffer.alloc(size - offset);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buffer, 0, buffer.length, offset);
  } finally {
    closeSync(fd);
  }
  const text = buffer.toString('utf8');
  const end = text.lastIndexOf('\n');
  if (end < 0) return { events: [], offset };
  const events = text
    .slice(0, end)
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditEvent);
  return { events, offset: offset + Buffer.byteLength(text.slice(0, end + 1)) };
}

export interface BridgeOptions {
  projectDir: string;
  port: number;
  viewerDir?: string;
}

export function startBridge(opts: BridgeOptions): Promise<{ server: Server; url: string; close: () => void }> {
  const viewerDir = opts.viewerDir ?? VIEWER_DIST;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/runs') {
      res.writeHead(200, { 'content-type': MIME['.json'] });
      res.end(JSON.stringify(listRuns(opts.projectDir)));
      return;
    }
    const requested = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = join(viewerDir, requested);
    if (!file.startsWith(viewerDir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(existsSync(viewerDir) ? 404 : 503, { 'content-type': 'text/plain' });
      res.end(existsSync(viewerDir) ? 'Not found' : 'Viewer is not built. Run: npm run build');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  const timers = new Set<NodeJS.Timeout>();

  wss.on('connection', (socket: WebSocket, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const wanted = url.searchParams.get('run') ?? 'latest';
    const send = (message: unknown) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(message));

    let runId = wanted === 'latest' ? (listRuns(opts.projectDir)[0]?.runId ?? null) : wanted;
    let offset = 0;
    let knownRuns = '';

    const tick = () => {
      const runs = listRuns(opts.projectDir);
      const signature = runs.map((r) => r.runId).join(',');
      if (signature !== knownRuns) {
        knownRuns = signature;
        send({ type: 'runs', runs });
      }
      // In "latest" mode, wait for the first run to appear.
      if (!runId && wanted === 'latest') runId = runs[0]?.runId ?? null;
      if (!runId) return;
      if (offset === 0) send({ type: 'attached', runId });
      const chunk = readFrom(eventsFile(opts.projectDir, runId), offset);
      if (chunk.events.length) send({ type: 'events', runId, events: chunk.events });
      offset = chunk.offset;
    };

    tick();
    const timer = setInterval(tick, 200);
    timers.add(timer);
    socket.on('close', () => {
      clearInterval(timer);
      timers.delete(timer);
    });
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    // Loopback only: the event stream contains project details and is not authenticated.
    server.listen(opts.port, '127.0.0.1', () => {
      resolvePromise({
        server,
        url: `http://127.0.0.1:${opts.port}`,
        close: () => {
          for (const timer of timers) clearInterval(timer);
          wss.close();
          server.close();
        },
      });
    });
  });
}
