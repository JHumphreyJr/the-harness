import './style.css';
import { BoardScene, PHASE_COLOR } from './scene';
import { TIER_LABEL, agentName, applyEvent, emptyWorld, type Effect, type Ev, type World } from './world';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attrs: Record<string, string> = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const scene = new BoardScene($('stage'));

// ------------------------------------------------------------------ state

let events: Ev[] = [];
let world: World = emptyWorld();
let cursor = 0; // number of events applied to `world`
let live = true;
let playing = false;
let timer = 0;
let socket: WebSocket | null = null;
let source: 'none' | 'live' | 'file' = 'none';
let wantedRun = 'latest';
let selection: { kind: 'node' | 'agent'; id: string } | null = null;
let tab: 'activity' | 'stages' | 'decisions' = 'activity';
let dirty = true;

/** Moves the world to exactly `n` applied events. Forward steps animate; anything else rebuilds. */
function seek(n: number, animate: boolean): void {
  const target = Math.max(0, Math.min(n, events.length));
  let effects: Effect[] = [];
  if (target < cursor) {
    world = emptyWorld();
    cursor = 0;
    animate = false;
  }
  while (cursor < target) effects = applyEvent(world, events[cursor++] as Ev);
  scene.sync(world, animate ? effects : [], !animate);
  dirty = true;
}

function stopPlayback(): void {
  playing = false;
  window.clearTimeout(timer);
}

function step(): void {
  if (!playing) return;
  if (cursor >= events.length) {
    stopPlayback();
    live = source === 'live';
    dirty = true;
    return;
  }
  seek(cursor + 1, true);
  const now = events[cursor - 1];
  const next = events[cursor];
  const gap = now && next ? Date.parse(next.ts) - Date.parse(now.ts) : 0;
  const speed = Number($<HTMLSelectElement>('speed').value);
  // Long waits (a human gate, a slow build) are compressed so replay stays watchable.
  timer = window.setTimeout(step, Math.max(30, Math.min(gap, 1500) / speed));
}

// ------------------------------------------------------------- connection

function receive(batch: Ev[], runId: string): void {
  const first = events.length === 0;
  events.push(...batch);
  if (!live) {
    dirty = true;
    return;
  }
  // History that arrives on attach is applied at once; only new events animate.
  if (first && batch.length > 1) seek(events.length, false);
  else for (let i = cursor; i < events.length; i += 1) seek(i + 1, true);
  void runId;
}

function detach(): void {
  socket?.close();
  socket = null;
  if (source === 'live') source = 'none';
  dirty = true;
}

function attach(run = wantedRun): void {
  detach();
  wantedRun = run;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?run=${encodeURIComponent(run)}`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    source = 'live';
    dirty = true;
  };
  ws.onmessage = (message) => {
    if (socket !== ws) return;
    const msg = JSON.parse(message.data as string) as { type: string; runs?: { runId: string; request: string }[]; runId?: string; events?: Ev[] };
    if (msg.type === 'runs' && msg.runs) {
      const pick = $<HTMLSelectElement>('run-pick');
      pick.replaceChildren(el('option', 'Latest run', { value: 'latest' }), ...msg.runs.map((r) => el('option', `${r.runId.slice(4, 13)}  ${r.request.slice(0, 40)}`, { value: r.runId })));
      pick.value = wantedRun;
      pick.disabled = false;
    } else if (msg.type === 'attached') {
      stopPlayback();
      events = [];
      live = true;
      seek(0, false);
    } else if (msg.type === 'events' && msg.events) {
      receive(msg.events, msg.runId ?? '');
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (source === 'live') source = 'none';
    dirty = true;
  };
}

async function openFile(file: File): Promise<void> {
  const text = await file.text();
  const parsed = text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Ev);
  detach();
  stopPlayback();
  source = 'file';
  events = parsed;
  live = false;
  seek(0, false);
  seek(events.length, false);
}

// ----------------------------------------------------------------- render

function renderHeader(): void {
  const { run } = world;
  $('empty').hidden = events.length > 0;
  $('run').hidden = events.length === 0;
  $('panel').hidden = events.length === 0;
  $('run-title').textContent = run.request || 'Waiting for the run to start';
  const status = { none: 'Not started', running: 'Working', waiting: 'Waiting on you', completed: 'Finished', failed: 'Failed' }[run.status];
  const meta = $('run-meta');
  meta.replaceChildren(el('b', run.tier ? (TIER_LABEL[run.tier] ?? run.tier) : 'Tier not decided yet'));
  if (run.surface) meta.append(el('span', run.surface));
  const state = el('span', status, { class: 'state', 'data-s': run.status });
  meta.append(state);
  if (run.prUrl) meta.append(el('a', 'Pull request', { href: run.prUrl, target: '_blank', rel: 'noreferrer' }));

  $('waiting').hidden = !world.waiting;
  if (world.waiting) $('waiting-title').textContent = world.waiting.title;

  $('lamp').dataset.state = source === 'live' ? 'on' : source === 'file' ? 'file' : 'off';
  $('link-text').textContent = source === 'live' ? 'Attached' : source === 'file' ? 'Log file' : 'Detached';
  $('attach').textContent = source === 'live' ? 'Detach' : 'Attach';
}

function renderTransport(): void {
  const scrub = $<HTMLInputElement>('scrub');
  scrub.max = String(events.length);
  scrub.value = String(cursor);
  const at = events[cursor - 1];
  $('position').textContent = `${cursor} of ${events.length}${at ? `  ${at.ts.slice(11, 19)}` : ''}`;
  $('play').textContent = playing ? 'Pause' : cursor >= events.length && events.length ? 'Replay' : 'Play';
  ($('play') as HTMLButtonElement).disabled = events.length === 0;
  $('live').setAttribute('aria-pressed', String(live && source === 'live'));
  ($('live') as HTMLButtonElement).disabled = source !== 'live';
}

function renderPanel(): void {
  for (const name of ['activity', 'stages', 'decisions'] as const) {
    $(`tab-${name}`).setAttribute('aria-selected', String(tab === name));
    $(`view-${name}`).hidden = tab !== name;
  }

  if (tab === 'activity') {
    const feed = $('view-activity');
    const stick = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 40;
    const items = selection?.kind === 'node' ? world.feed.filter((f) => f.node === selection?.id) : world.feed;
    feed.replaceChildren(
      ...items.slice(-150).map((item) => {
        const li = el('li', undefined, { 'data-tone': item.tone });
        const body = el('div');
        body.append(el('b', item.who), el('span', item.text));
        li.append(el('time', item.time), body);
        return li;
      }),
    );
    if (!items.length) feed.append(el('li', 'Nothing has happened here yet.', { class: 'none' }));
    if (stick) feed.scrollTop = feed.scrollHeight;
  }

  if (tab === 'stages') {
    $('view-stages').replaceChildren(
      ...world.topology.nodes.map((node) => {
        const state = world.nodes.get(node.id);
        const button = el('button', undefined, { type: 'button', 'data-status': state?.status ?? 'idle', style: `--c:#${PHASE_COLOR[node.phase].toString(16).padStart(6, '0')}` });
        if (selection?.id === node.id) button.setAttribute('aria-current', 'true');
        const status = { idle: 'Not reached', active: 'Working', done: 'Done', waiting: 'Waiting on you', skipped: 'Not needed at this tier', failed: 'Failed' }[state?.status ?? 'idle'];
        button.append(el('i'), el('span', node.label), el('small', state?.note || status));
        button.onclick = () => select('node', node.id);
        const li = el('li');
        li.append(button);
        return li;
      }),
    );
  }

  if (tab === 'decisions') {
    const list = $('view-decisions');
    list.replaceChildren(
      ...world.decisions.map((d) => {
        const li = el('li');
        li.append(el('h3', `${d.id}. ${d.title}`), el('p', d.decision), el('code', d.path));
        return li;
      }),
    );
    if (!world.decisions.length) list.append(el('li', 'No decisions recorded yet. Each one becomes a file under docs/decisions.', { class: 'none' }));
  }

  const detail = $('detail');
  detail.hidden = !selection;
  if (!selection) return;
  const close = el('button', '×', { class: 'close', type: 'button', 'aria-label': 'Clear selection' });
  close.onclick = () => select(null);
  if (selection.kind === 'node') {
    const node = world.topology.nodes.find((n) => n.id === selection?.id);
    const state = world.nodes.get(selection.id);
    const files = el('ul');
    for (const path of new Set(state?.artifacts ?? [])) {
      const li = el('li');
      li.append(el('code', path));
      files.append(li);
    }
    const kind = node?.kind === 'gate' ? 'Approval gate' : node?.kind === 'check' ? 'Automated check' : node?.role ? `Worked by the ${node.role} agent` : 'Harness step';
    detail.replaceChildren(close, el('h2', node?.label ?? selection.id), el('p', kind), el('p', state?.note || `Visited ${state?.visits ?? 0} time${state?.visits === 1 ? '' : 's'}`), files);
  } else {
    const agent = world.agents.get(selection.id);
    if (!agent) return void (detail.hidden = true);
    const where = world.topology.nodes.find((n) => n.id === agent.node)?.label;
    detail.replaceChildren(close, el('h2', agentName(agent)), el('p', where ? `At ${where}: ${agent.activity}` : 'On the bench'), el('p', agent.model ? `Model: ${agent.model}` : ''));
  }
}

function select(kind: 'node' | 'agent' | null, id = ''): void {
  selection = kind && !(selection?.kind === kind && selection.id === id) ? { kind, id } : null;
  scene.select(selection?.id ?? null);
  scene.sync(world, [], false);
  if (selection?.kind === 'node' && tab === 'decisions') tab = 'activity';
  dirty = true;
}

function loop(): void {
  if (dirty) {
    dirty = false;
    renderHeader();
    renderTransport();
    renderPanel();
  }
  requestAnimationFrame(loop);
}

// ----------------------------------------------------------------- wiring

scene.onSelect = (kind, id) => select(kind, id);

for (const button of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
  button.onclick = () => {
    tab = button.dataset.tab as typeof tab;
    dirty = true;
  };
}

$('attach').onclick = () => (source === 'live' ? detach() : attach());
$<HTMLSelectElement>('run-pick').onchange = (e) => attach((e.target as HTMLSelectElement).value);
$('open').onclick = () => $('file').click();
$<HTMLInputElement>('file').onchange = (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void openFile(file);
};

$('play').onclick = () => {
  if (playing) return void (stopPlayback(), (dirty = true));
  if (cursor >= events.length) seek(0, false);
  live = false;
  playing = true;
  step();
};
$<HTMLInputElement>('scrub').oninput = (e) => {
  stopPlayback();
  live = false;
  seek(Number((e.target as HTMLInputElement).value), false);
};
$('live').onclick = () => {
  stopPlayback();
  live = true;
  seek(events.length, false);
};

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
  if (e.key === ' ') {
    e.preventDefault();
    $('play').click();
  } else if (e.key === 'Escape') select(null);
});

attach();
loop();
