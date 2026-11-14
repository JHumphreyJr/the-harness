import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileFor } from './tiers.js';
import type { ReviewLens, Role, Surfaces, Tier } from './types.js';

export const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/**
 * Role prompts and standards are plain markdown so they can be read, reviewed and versioned
 * like any other engineering document. A project overrides any of them by placing a file with
 * the same name under `.foundry/roles/` or `.foundry/standards/`.
 */
function load(projectDir: string, kind: 'roles' | 'standards', name: string): string {
  const override = join(projectDir, '.foundry', kind, `${name}.md`);
  const file = existsSync(override) ? override : join(ASSETS_DIR, kind, `${name}.md`);
  if (!existsSync(file)) throw new Error(`Missing ${kind} document: ${name}.md`);
  return readFileSync(file, 'utf8').trim();
}

export interface PromptContext {
  projectDir: string;
  tier: Tier;
  surfaces: Surfaces;
  lens?: ReviewLens;
  /** Regimes found applicable; each adds its control pack to the roles that must act on it. */
  regimes?: string[];
  /** For the expert role: a catalogue id under assets/experts, or a domain in plain words. */
  expert?: string;
  /** True while the tier and surface are still being decided (the scope node). */
  unscoped?: boolean;
}

/** Each target platform brings its own language standard. Mobile is always the platform's native language. */
function languageStandards(surfaces: Surfaces): string[] {
  const names: string[] = [];
  if (surfaces.platforms.some((p) => p === 'native' || p === 'embedded')) names.push('rust');
  if (surfaces.platforms.includes('web')) names.push('typescript');
  if (surfaces.platforms.includes('ios')) names.push('ios');
  if (surfaces.platforms.includes('android')) names.push('android');
  return names;
}

/** Control packs for the applicable regimes that have one. A regime without a pack is covered by the assessment document itself. */
function packs(ctx: PromptContext): string[] {
  return (ctx.regimes ?? []).map((id) => `compliance-${id}`).filter((name) => existsSync(join(ASSETS_DIR, 'standards', `${name}.md`)) || existsSync(join(ctx.projectDir, '.foundry', 'standards', `${name}.md`)));
}

/** The prompt for a domain expert: its catalogue entry if there is one, otherwise the generic brief for that domain. */
function expertBrief(projectDir: string, expert: string): string {
  const id = expert.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const file of [join(projectDir, '.foundry', 'experts', `${id}.md`), join(ASSETS_DIR, 'experts', `${id}.md`)]) {
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  }
  return readFileSync(join(ASSETS_DIR, 'experts', '_generic.md'), 'utf8').trim().replaceAll('{{domain}}', expert);
}

export function expertCatalogue(): string[] {
  return readdirSync(join(ASSETS_DIR, 'experts')).filter((name) => name.endsWith('.md') && !name.startsWith('_')).map((name) => name.slice(0, -3)).sort();
}

/** Which standards each role is held to. Smaller prompts keep agents focused on their own job. */
export function standardsFor(role: Role, ctx: PromptContext): string[] {
  const profile = profileFor(ctx.tier);
  const ux = ctx.surfaces.graphical ? ['ux'] : [];
  const lang = languageStandards(ctx.surfaces);
  switch (role) {
    case 'analyst':
      return ['stack', 'technology'];
    case 'compliance':
      return ['compliance'];
    case 'expert':
      return ['technology', profile.standards.architecture];
    case 'product':
      return ux;
    case 'ux':
      return ['ux', 'platform-guidelines'];
    case 'architect':
      return ['stack', 'technology', 'platform-guidelines', profile.standards.testing, profile.standards.architecture, profile.standards.security, ...packs(ctx), ...lang];
    case 'security':
      return [profile.standards.security, ...packs(ctx)];
    case 'planner':
      return ['clean-code', profile.standards.testing, ...packs(ctx)];
    case 'developer':
      return ['clean-code', profile.standards.testing, 'technology', 'platform-guidelines', ...lang, ...ux, profile.standards.security, ...packs(ctx), 'documentation'];
    case 'writer':
      return ['documentation'];
    case 'qa':
      return [profile.standards.testing, 'platform-guidelines', ...packs(ctx), ...ux, ...lang];
    case 'reviewer':
      switch (ctx.lens) {
        case 'security':
          return ['review', profile.standards.security, ...packs(ctx)];
        case 'compliance':
          return ['review', 'compliance', ...packs(ctx)];
        case 'ux':
          return ['review', 'ux', 'platform-guidelines', ...lang];
        case 'architecture':
          return ['review', 'technology', profile.standards.architecture];
        default:
          return ['review', 'clean-code', profile.standards.testing, 'technology', 'platform-guidelines', ...lang];
      }
  }
}

export function buildInstructions(role: Role, ctx: PromptContext): string {
  const profile = profileFor(ctx.tier);
  const standards = [...new Set(standardsFor(role, ctx))].map((name) => load(ctx.projectDir, 'standards', name));
  return [
    role === 'expert' && ctx.expert ? expertBrief(ctx.projectDir, ctx.expert) : load(ctx.projectDir, 'roles', role),
    '## Engagement',
    ...(ctx.unscoped
      ? ['The scale tier, surface and platforms are not decided yet. Deciding them is part of your task; ignore any defaults.']
      : [
          `Scale tier: **${profile.label}**. ${profile.intent}`,
          `Product surface: ${ctx.surfaces.graphical ? 'graphical' : 'non-graphical'}; platforms: ${ctx.surfaces.platforms.join(', ')}.`,
        ]),
    ctx.lens ? `Your review lens is **${ctx.lens}**. Stay inside it; other reviewers cover the rest.` : '',
    'Build what this tier calls for. Process or infrastructure beyond the tier is a defect, not diligence.',
    '## Standards you are held to',
    ...standards,
  ]
    .filter(Boolean)
    .join('\n\n');
}
