import { type FoundryConfig, runnerNameFor } from './config.js';
import type { PlanTask } from './types.js';

/**
 * The dispatcher: decides how many developer agents work at once and which runner each one
 * uses. It is plain code, not a model, so the same plan and config always give the same
 * schedule, and every choice can be explained in the audit log.
 */

export interface Assignment {
  task: PlanTask;
  runner: string;
  /** Why this runner, in words fit for the audit log. */
  reason: string;
}

export interface Wave {
  tasks: PlanTask[];
  /** Set when the plan's dependencies could not be satisfied and the dispatcher forced progress. */
  note?: string;
}

/**
 * The next set of tasks that can safely run at the same time:
 *   - every task it depends on is done,
 *   - no two tasks share a track (a track owns its part of the tree, so two agents never edit
 *     the same files),
 *   - no more than `maxParallel` at once.
 * A task listed in `serial` runs alone: its earlier parallel attempt could not be merged.
 */
export function nextWave(tasks: PlanTask[], done: ReadonlySet<string>, serial: readonly string[], maxParallel: number): Wave {
  const remaining = tasks.filter((task) => !done.has(task.id));
  if (remaining.length === 0) return { tasks: [] };

  const alone = remaining.find((task) => serial.includes(task.id));
  if (alone) return { tasks: [alone], note: `${alone.id} runs alone after a merge conflict` };

  const known = new Set(tasks.map((task) => task.id));
  const ready = remaining.filter((task) => task.dependsOn.every((id) => done.has(id) || !known.has(id)));
  if (ready.length === 0) {
    // A dependency cycle in the plan. Take the first task in plan order rather than stall.
    const first = remaining[0] as PlanTask;
    return { tasks: [first], note: `dependency cycle in the plan; forcing ${first.id}` };
  }

  const wave: PlanTask[] = [];
  const tracks = new Set<string>();
  for (const task of ready) {
    if (wave.length >= Math.max(1, maxParallel)) break;
    if (tracks.has(task.track)) continue;
    tracks.add(task.track);
    wave.push(task);
  }
  return { tasks: wave };
}

/** Picks the runner for one task: an explicit track mapping first, then size and risk, then the role default. */
export function route(config: FoundryConfig, task: PlanTask): Assignment {
  const { byTrack, bySize } = config.dispatch;
  const forTrack = byTrack[task.track];
  if (forTrack) return { task, runner: forTrack, reason: `track "${task.track}" is mapped to ${forTrack}` };

  // High risk is treated as large: a wrong answer costs more than a slow one.
  const size = task.risk === 'high' ? 'large' : task.size;
  const forSize = bySize[size];
  if (forSize) {
    const why = task.risk === 'high' && task.size !== 'large' ? `high risk, treated as large` : `size ${task.size}`;
    return { task, runner: forSize, reason: `${why} is mapped to ${forSize}` };
  }
  const fallback = runnerNameFor(config, 'developer');
  return { task, runner: fallback, reason: `no mapping for track "${task.track}" or size ${size}; developer default` };
}

export function assign(config: FoundryConfig, wave: Wave): Assignment[] {
  return wave.tasks.map((task) => route(config, task));
}
