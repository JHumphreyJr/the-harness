import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VerifyResult } from './types.js';

/** Picks the project's own quality gates. Explicit config always wins over detection. */
export function detectVerifyCommands(projectDir: string): string[] {
  // A project with several toolchains (an Xcode app plus a website, say) declares its own gate.
  // The script is part of the reviewed diff like any other code.
  if (existsSync(join(projectDir, 'scripts', 'verify.sh'))) return ['sh scripts/verify.sh'];
  const commands: string[] = [];
  if (existsSync(join(projectDir, 'Cargo.toml'))) {
    commands.push('cargo fmt --all --check', 'cargo clippy --all-targets -- -D warnings', 'cargo test');
  }
  if (existsSync(join(projectDir, 'Package.swift'))) commands.push('swift build', 'swift test');
  const pkgFile = join(projectDir, 'package.json');
  if (existsSync(pkgFile)) {
    const scripts = (JSON.parse(readFileSync(pkgFile, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
    for (const name of ['lint', 'typecheck', 'test', 'build']) {
      if (scripts[name]) commands.push(`npm run ${name} --silent`);
    }
  }
  return commands;
}

const TAIL = 6000;

export function runVerify(projectDir: string, commands: string[], timeoutSec: number): VerifyResult {
  const steps: VerifyResult['steps'] = [];
  for (const command of commands) {
    const started = Date.now();
    // Commands come from the operator's config or from detection of standard toolchains and
    // scripts/verify.sh. They are never taken from a model's reply.
    const result = spawnSync(command, {
      cwd: projectDir,
      shell: true,
      encoding: 'utf8',
      timeout: timeoutSec * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.slice(-TAIL);
    const exitCode = result.status ?? 1;
    steps.push({ command, exitCode, output, durationMs: Date.now() - started });
    if (exitCode !== 0) break; // Later steps would only add noise to the developer's fix prompt.
  }
  return { ok: steps.every((step) => step.exitCode === 0), steps };
}
