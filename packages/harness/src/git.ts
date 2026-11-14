import { spawnSync } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function exec(cwd: string, bin: string, args: string[], input?: string): ExecResult {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? String(result.error ?? '') };
}

/** Thin, synchronous git wrapper. The harness owns all commits, pushes and pull requests. */
export class Git {
  constructor(readonly cwd: string) {}

  private run(args: string[]): ExecResult {
    return exec(this.cwd, 'git', args);
  }

  private must(args: string[]): string {
    const result = this.run(args);
    if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  }

  /** Makes sure there is a repository with at least one commit, and returns the current branch. */
  ensureRepo(): string {
    if (this.run(['rev-parse', '--is-inside-work-tree']).code !== 0) this.must(['init', '-b', 'main']);
    if (this.run(['rev-parse', '--verify', 'HEAD']).code !== 0) {
      this.must(['commit', '--allow-empty', '-m', 'chore: initialise repository']);
    }
    return this.must(['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  isDirty(): boolean {
    return this.must(['status', '--porcelain']).length > 0;
  }

  /** Paths with uncommitted changes, tracked or not. */
  dirtyPaths(): string[] {
    return this.must(['status', '--porcelain'])
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3));
  }

  checkoutNew(branch: string): void {
    this.must(['checkout', '-b', branch]);
  }

  /** Stages everything and commits. Returns the short sha, or null when there was nothing to commit. */
  commitAll(message: string, trailers: Record<string, string>): string | null {
    this.must(['add', '-A']);
    if (this.run(['diff', '--cached', '--quiet']).code === 0) return null;
    const body = Object.entries(trailers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
    this.must(['commit', '-m', message, '-m', body]);
    return this.must(['rev-parse', '--short', 'HEAD']);
  }

  /** Commits only the named paths, leaving everything else in the working tree untouched. */
  commitPaths(paths: string[], message: string): void {
    this.must(['add', '--', ...paths]);
    if (this.run(['diff', '--cached', '--quiet']).code !== 0) this.must(['commit', '-m', message, '--', ...paths]);
  }

  /** Creates an isolated checkout on a new branch from the current HEAD, for one parallel agent. */
  worktreeAdd(path: string, branch: string): void {
    this.run(['worktree', 'remove', '--force', path]);
    this.run(['branch', '-D', branch]);
    this.must(['worktree', 'add', '-b', branch, path, 'HEAD']);
  }

  worktreeRemove(path: string): void {
    this.run(['worktree', 'remove', '--force', path]);
  }

  /** Merges a branch into the current one. Returns false, with nothing changed, on a conflict. */
  merge(branch: string, message: string): boolean {
    if (this.run(['merge', '--no-ff', '-m', message, branch]).code === 0) return true;
    this.run(['merge', '--abort']);
    return false;
  }

  deleteBranch(branch: string): void {
    this.run(['branch', '-D', branch]);
  }

  diff(base: string): string {
    return this.must(['diff', `${base}...HEAD`, '--', '.', ':(exclude)docs/runs', ':(exclude)docs/reviews']);
  }

  diffStat(base: string): string {
    return this.must(['diff', '--stat', `${base}...HEAD`]);
  }

  hasRemote(): boolean {
    return this.run(['remote', 'get-url', 'origin']).code === 0;
  }

  push(branch: string): ExecResult {
    return this.run(['push', '--set-upstream', 'origin', branch]);
  }
}

/** GitHub operations through the `gh` CLI, so the harness never handles a token itself. */
export class GitHub {
  constructor(readonly cwd: string) {}

  available(): boolean {
    return exec(this.cwd, 'gh', ['auth', 'status']).code === 0;
  }

  existingPr(branch: string): string | null {
    const result = exec(this.cwd, 'gh', ['pr', 'view', branch, '--json', 'url', '--jq', '.url']);
    return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  }

  createPr(opts: { title: string; body: string; base: string; draft: boolean }): string {
    const args = ['pr', 'create', '--title', opts.title, '--body-file', '-', '--base', opts.base];
    if (opts.draft) args.push('--draft');
    const result = exec(this.cwd, 'gh', args, opts.body);
    if (result.code !== 0) throw new Error(`gh pr create failed: ${result.stderr.trim()}`);
    return result.stdout.trim().split('\n').at(-1) ?? '';
  }

  comment(body: string): boolean {
    return exec(this.cwd, 'gh', ['pr', 'comment', '--body-file', '-'], body).code === 0;
  }
}
