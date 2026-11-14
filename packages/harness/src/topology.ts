import { REVIEW_LENSES, type Role } from './types.js';

/**
 * A description of the workflow graph for humans and for the viewer: labels, the role that
 * works at each node, and layout hints. `graph.ts` is the executable definition; a test
 * asserts the two never drift apart.
 */
export interface TopologyNode {
  id: string;
  label: string;
  kind: 'work' | 'gate' | 'check';
  role?: Role;
  /** Phase band, used for grouping and colour in the viewer. */
  phase: 'discover' | 'design' | 'build' | 'review' | 'release';
  /** Position on the floor grid. */
  x: number;
  z: number;
}

export interface Topology {
  nodes: TopologyNode[];
  edges: { from: string; to: string; kind: 'flow' | 'loop' }[];
}

const lensNodes: TopologyNode[] = REVIEW_LENSES.map((lens, index) => ({
  id: `review_${lens}`,
  label: lens === 'ux' ? 'UX review' : `${lens[0]?.toUpperCase()}${lens.slice(1)} review`,
  kind: 'check',
  role: 'reviewer',
  phase: 'review',
  x: 12 + (index % 2) * 2.5,
  z: 4 + index * 2.6,
}));

export const TOPOLOGY: Topology = {
  nodes: [
    { id: 'intake', label: 'Intake', kind: 'work', phase: 'discover', x: -18, z: -10 },
    { id: 'scope', label: 'Scope and tier', kind: 'work', role: 'analyst', phase: 'discover', x: -12, z: -10 },
    { id: 'gate_scope', label: 'Scope gate', kind: 'gate', phase: 'discover', x: -8, z: -10 },
    { id: 'elicit', label: 'Elicitation', kind: 'work', role: 'analyst', phase: 'discover', x: -4, z: -10 },
    { id: 'gate_clarify', label: 'Your answers', kind: 'gate', phase: 'discover', x: 0, z: -10 },
    { id: 'requirements', label: 'Requirements', kind: 'work', role: 'product', phase: 'discover', x: 4, z: -10 },
    { id: 'gate_requirements', label: 'PRD gate', kind: 'gate', phase: 'discover', x: 8, z: -10 },

    { id: 'compliance', label: 'Compliance', kind: 'work', role: 'compliance', phase: 'discover', x: 12, z: -10 },
    { id: 'gate_compliance', label: 'Compliance gate', kind: 'gate', phase: 'discover', x: 16, z: -10 },

    { id: 'ux', label: 'UX design', kind: 'work', role: 'ux', phase: 'design', x: 15, z: -6 },
    { id: 'gate_ux', label: 'UX gate', kind: 'gate', phase: 'design', x: 12, z: -2 },
    { id: 'architecture', label: 'Architecture', kind: 'work', role: 'architect', phase: 'design', x: 8, z: -2 },
    { id: 'expert_panel', label: 'Expert panel', kind: 'check', role: 'expert', phase: 'design', x: 9, z: 1.5 },
    { id: 'gate_architecture', label: 'Architecture gate', kind: 'gate', phase: 'design', x: 4, z: -2 },
    { id: 'threat_model', label: 'Threat model', kind: 'work', role: 'security', phase: 'design', x: 0, z: -2 },
    { id: 'gate_threat-model', label: 'Security gate', kind: 'gate', phase: 'design', x: -4, z: -2 },
    { id: 'plan', label: 'Planning', kind: 'work', role: 'planner', phase: 'design', x: -8, z: -2 },

    { id: 'implement', label: 'Implementation', kind: 'work', role: 'developer', phase: 'build', x: -14, z: 4 },
    { id: 'verify', label: 'Verification', kind: 'check', phase: 'build', x: -8, z: 6 },
    { id: 'fix', label: 'Rework', kind: 'work', role: 'developer', phase: 'build', x: -8, z: 12 },
    { id: 'document', label: 'Documentation', kind: 'work', role: 'writer', phase: 'build', x: -2, z: 6 },
    { id: 'qa', label: 'QA', kind: 'check', role: 'qa', phase: 'build', x: -2, z: 11 },
    { id: 'usability_prep', label: 'Usability plan', kind: 'work', role: 'ux', phase: 'build', x: 0, z: 16 },
    { id: 'gate_usability', label: 'Usability gate', kind: 'gate', phase: 'build', x: 5, z: 16 },
    { id: 'sbom', label: 'SBOM and licences', kind: 'check', phase: 'review', x: 5, z: 12.5 },
    { id: 'publish', label: 'Pull request', kind: 'work', phase: 'review', x: 5, z: 9 },
    ...lensNodes,
    { id: 'review_gate', label: 'Review verdict', kind: 'check', phase: 'review', x: 19, z: 9 },
    { id: 'gate_release', label: 'Release gate', kind: 'gate', phase: 'release', x: 19, z: 2 },
    { id: 'complete', label: 'Run report', kind: 'work', phase: 'release', x: 19, z: -5 },
  ],
  edges: [
    { from: 'intake', to: 'scope', kind: 'flow' },
    { from: 'scope', to: 'gate_scope', kind: 'flow' },
    { from: 'gate_scope', to: 'elicit', kind: 'flow' },
    { from: 'elicit', to: 'gate_clarify', kind: 'flow' },
    { from: 'gate_clarify', to: 'requirements', kind: 'flow' },
    { from: 'requirements', to: 'gate_requirements', kind: 'flow' },
    { from: 'gate_requirements', to: 'compliance', kind: 'flow' },
    { from: 'compliance', to: 'gate_compliance', kind: 'flow' },
    { from: 'gate_compliance', to: 'ux', kind: 'flow' },
    { from: 'gate_compliance', to: 'architecture', kind: 'flow' },
    { from: 'ux', to: 'gate_ux', kind: 'flow' },
    { from: 'gate_ux', to: 'architecture', kind: 'flow' },
    { from: 'architecture', to: 'gate_architecture', kind: 'flow' },
    { from: 'architecture', to: 'expert_panel', kind: 'loop' },
    { from: 'expert_panel', to: 'architecture', kind: 'loop' },
    { from: 'gate_architecture', to: 'threat_model', kind: 'flow' },
    { from: 'gate_architecture', to: 'plan', kind: 'flow' },
    { from: 'threat_model', to: 'gate_threat-model', kind: 'flow' },
    { from: 'gate_threat-model', to: 'plan', kind: 'flow' },
    { from: 'plan', to: 'implement', kind: 'flow' },
    { from: 'implement', to: 'verify', kind: 'flow' },
    { from: 'verify', to: 'implement', kind: 'loop' },
    { from: 'verify', to: 'document', kind: 'flow' },
    { from: 'document', to: 'qa', kind: 'flow' },
    { from: 'qa', to: 'fix', kind: 'loop' },
    { from: 'verify', to: 'qa', kind: 'loop' },
    { from: 'qa', to: 'usability_prep', kind: 'flow' },
    { from: 'qa', to: 'sbom', kind: 'flow' },
    { from: 'sbom', to: 'publish', kind: 'flow' },
    { from: 'sbom', to: 'fix', kind: 'loop' },
    { from: 'usability_prep', to: 'gate_usability', kind: 'flow' },
    { from: 'gate_usability', to: 'sbom', kind: 'flow' },
    { from: 'gate_usability', to: 'fix', kind: 'loop' },
    ...REVIEW_LENSES.flatMap((lens) => [
      { from: 'publish', to: `review_${lens}`, kind: 'flow' as const },
      { from: `review_${lens}`, to: 'review_gate', kind: 'flow' as const },
    ]),
    { from: 'review_gate', to: 'fix', kind: 'loop' },
    { from: 'fix', to: 'verify', kind: 'loop' },
    { from: 'verify', to: 'sbom', kind: 'loop' },
    { from: 'review_gate', to: 'gate_release', kind: 'flow' },
    { from: 'gate_release', to: 'complete', kind: 'flow' },
  ],
};
