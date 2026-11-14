import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FoundryConfig } from './config.js';

/**
 * Software bill of materials and open source licence compliance.
 *
 * Generation is delegated to an established tool (OWASP cdxgen by default). Everything after
 * that is deterministic code in this file: the harness checks the result itself instead of
 * trusting a model's reading of it.
 *
 * The readiness checks follow the published baseline for the EU Cyber Resilience Act, BSI
 * TR-03183-2 v2.1.0: CycloneDX 1.6+ or SPDX 3.0.1+, JSON, with creator, timestamp, and per
 * component a name, version, licence and SHA-512 hash, plus dependency relationships, and no
 * embedded vulnerability data. They are a checked subset, not a certification.
 */

export interface Component {
  name: string;
  version: string;
  licenses: string[];
  hasSha512: boolean;
  /** False for build and test tooling that is not shipped. Licence policy applies to shipped components. */
  shipped: boolean;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SbomReport {
  generated: boolean;
  error?: string;
  file: string;
  format: string;
  specVersion: string;
  components: Component[];
  checks: Check[];
  denied: { component: string; license: string }[];
  needsReview: { component: string; license: string }[];
  unlicensed: string[];
}

export const SBOM_FILE = 'sbom/bom.cdx.json';

const expand = (argv: string[], vars: Record<string, string>) => argv.map((arg) => arg.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole));

function onPath(bin: string): boolean {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;
}

/** Runs the configured generator and returns the parsed document, or the reason there is none. */
export function generateSbom(projectDir: string, config: FoundryConfig): { bom?: Record<string, any>; error?: string; command: string } {
  const output = join(projectDir, SBOM_FILE);
  mkdirSync(dirname(output), { recursive: true });
  const creator = config.compliance.sbom.creator;
  let argv = config.compliance.sbom.command;
  if (argv.length === 0) {
    const base = ['--spec-version', '1.6', '--profile', 'license-compliance', '--no-install-deps', '--author', creator, '-o', '{output}', '.'];
    // Prefer an installed cdxgen; otherwise fetch the pinned major through npx.
    argv = onPath('cdxgen') ? ['cdxgen', ...base] : ['npx', '--yes', '@cyclonedx/cdxgen@12', ...base];
  }
  const [bin, ...args] = expand(argv, { output, creator }) as [string, ...string[]];
  const result = spawnSync(bin, args, { cwd: projectDir, encoding: 'utf8', timeout: config.compliance.sbom.timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FETCH_LICENSE: 'true' } });
  const command = [bin, ...args].join(' ');
  if (result.error || result.status !== 0) {
    return { command, error: `SBOM generator failed (${result.error?.message ?? `exit ${result.status}`}): ${`${result.stderr ?? ''}`.trim().slice(-600)}` };
  }
  if (!existsSync(output)) return { command, error: 'SBOM generator exited cleanly but wrote no file' };
  try {
    return { command, bom: JSON.parse(readFileSync(output, 'utf8')) as Record<string, any> };
  } catch (error) {
    return { command, error: `SBOM is not valid JSON: ${(error as Error).message}` };
  }
}

const atLeast = (version: string, minimum: [number, number, number]) => {
  const parts = version.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((parts[i] ?? 0) !== minimum[i]) return (parts[i] ?? 0) > (minimum[i] as number);
  }
  return true;
};

function licensesOf(component: Record<string, any>): string[] {
  const out: string[] = [];
  for (const entry of (component.licenses ?? []) as Record<string, any>[]) {
    if (typeof entry.expression === 'string') out.push(entry.expression);
    else if (entry.license?.id) out.push(String(entry.license.id));
    else if (entry.license?.name) out.push(String(entry.license.name));
  }
  return out;
}

/** True when the licence text names an identifier from the list, as a whole SPDX id or a prefix family such as GPL-. */
function matches(license: string, patterns: string[]): string | undefined {
  const ids = license.split(/\s+(?:AND|OR|WITH)\s+|[()]/i).map((id) => id.trim()).filter(Boolean);
  return patterns.find((pattern) => ids.some((id) => (pattern.endsWith('*') ? id.toUpperCase().startsWith(pattern.slice(0, -1).toUpperCase()) : id.toUpperCase() === pattern.toUpperCase())));
}

export function analyseSbom(bom: Record<string, any>, config: FoundryConfig): Omit<SbomReport, 'generated' | 'file'> {
  const policy = config.compliance.licenses;
  const isCdx = bom.bomFormat === 'CycloneDX';
  const specVersion = String(bom.specVersion ?? bom.spdxVersion ?? '');
  const raw = (bom.components ?? []) as Record<string, any>[];
  const components: Component[] = raw.map((c) => ({
    name: [c.group, c.name].filter(Boolean).join('/'),
    version: String(c.version ?? ''),
    licenses: licensesOf(c),
    hasSha512: ((c.hashes ?? []) as { alg: string }[]).some((h) => h.alg === 'SHA-512'),
    shipped: c.scope !== 'optional' && c.scope !== 'excluded',
  }));
  const meta = (bom.metadata ?? {}) as Record<string, any>;
  const creators = [...((meta.authors ?? []) as Record<string, any>[]), meta.manufacturer, meta.supplier].filter(Boolean) as Record<string, any>[];
  const contactable = creators.some((c) => c.email || c.url || /@|https?:\/\//.test(String(c.name ?? '')) || (c.contact ?? []).some?.((p: Record<string, any>) => p.email));
  const count = (list: unknown[]) => `${list.length} of ${components.length}`;
  const noVersion = components.filter((c) => !c.name || !c.version);
  const noLicense = components.filter((c) => c.licenses.length === 0);
  const noHash = components.filter((c) => !c.hasSha512);

  const checks: Check[] = [
    { name: 'Format and version', ok: isCdx ? atLeast(specVersion, [1, 6, 0]) : atLeast(specVersion.replace(/^SPDX-/, ''), [3, 0, 1]), detail: `${isCdx ? 'CycloneDX' : 'SPDX'} ${specVersion}; baseline is CycloneDX 1.6+ or SPDX 3.0.1+` },
    { name: 'Timestamp', ok: Boolean(meta.timestamp), detail: String(meta.timestamp ?? 'missing') },
    { name: 'Creator with an email or URL', ok: contactable, detail: contactable ? 'present' : 'set compliance.sbom.creator to "Name <email>" or include a URL' },
    { name: 'Primary component named and versioned', ok: Boolean(meta.component?.name && meta.component?.version), detail: `${meta.component?.name ?? 'unnamed'} ${meta.component?.version ?? '(no version)'}` },
    { name: 'Every component has a name and version', ok: noVersion.length === 0, detail: `${count(noVersion)} incomplete` },
    { name: 'Every component has a licence', ok: noLicense.length === 0, detail: `${count(noLicense)} without one` },
    { name: 'Every component has a SHA-512 hash', ok: noHash.length === 0, detail: `${count(noHash)} without one` },
    { name: 'Dependency relationships recorded', ok: Array.isArray(bom.dependencies) && bom.dependencies.length > 0, detail: `${(bom.dependencies ?? []).length} entries` },
    { name: 'No vulnerability data embedded', ok: !bom.vulnerabilities || bom.vulnerabilities.length === 0, detail: 'vulnerability information belongs in separate VEX or CSAF documents' },
  ];

  const denied: SbomReport['denied'] = [];
  const needsReview: SbomReport['needsReview'] = [];
  for (const component of components.filter((c) => c.shipped)) {
    for (const license of component.licenses) {
      const label = `${component.name}@${component.version}`;
      if (matches(license, policy.deny)) denied.push({ component: label, license });
      else if (matches(license, policy.review) || !/^[A-Za-z0-9.+\-() ]+$/.test(license) || /\bSEE\b|\bLICENSE\b/i.test(license)) needsReview.push({ component: label, license });
    }
  }
  return { format: isCdx ? 'CycloneDX' : 'SPDX', specVersion, components, checks, denied, needsReview, unlicensed: noLicense.filter((c) => c.shipped).map((c) => `${c.name}@${c.version}`) };
}

export function renderNotices(report: Pick<SbomReport, 'components'>, product: string): string {
  const shipped = report.components.filter((c) => c.shipped).sort((a, b) => a.name.localeCompare(b.name));
  return [
    '# Third-party notices',
    '',
    `${product} includes the following third-party open source components. This file is generated from \`${SBOM_FILE}\`; do not edit it by hand.`,
    '',
    ...(shipped.length ? ['| Component | Version | Licence |', '|---|---|---|', ...shipped.map((c) => `| ${c.name} | ${c.version} | ${c.licenses.join(', ') || 'not declared'} |`)] : ['None. The product ships no third-party components.']),
    '',
    'Each licence requires its text and any copyright notice to accompany the distributed product. Ship the licence files from each component alongside this list.',
  ].join('\n');
}

export function renderSbomReport(report: SbomReport, runId: string, command: string): string {
  const mark = (ok: boolean) => (ok ? 'pass' : '**fail**');
  const list = (items: { component: string; license: string }[]) => (items.length ? ['| Component | Licence |', '|---|---|', ...items.map((i) => `| ${i.component} | ${i.license} |`)] : ['None.']);
  return [
    '# SBOM and open source compliance report',
    '',
    `Run \`${runId}\`. Generated with \`${command.replace(/\s+/g, ' ').slice(0, 300)}\`.`,
    '',
    report.generated ? `\`${report.file}\`: ${report.format} ${report.specVersion}, ${report.components.length} components, ${report.components.filter((c) => c.shipped).length} of them shipped.` : `**No SBOM was produced.** ${report.error ?? ''}`,
    '',
    '## EU readiness (BSI TR-03183-2 v2.1.0 baseline)',
    '',
    'A checked subset of the baseline most often used for the EU Cyber Resilience Act. Passing these checks is evidence, not certification.',
    '',
    '| Check | Result | Detail |',
    '|---|---|---|',
    ...report.checks.map((c) => `| ${c.name} | ${mark(c.ok)} | ${c.detail} |`),
    '',
    '## Licences that are not allowed in shipped components',
    '',
    ...list(report.denied),
    '',
    '## Licences that need a person to review',
    '',
    ...list(report.needsReview),
    '',
    '## Shipped components with no declared licence',
    '',
    ...(report.unlicensed.length ? report.unlicensed.map((c) => `- ${c}`) : ['None.']),
  ].join('\n');
}
