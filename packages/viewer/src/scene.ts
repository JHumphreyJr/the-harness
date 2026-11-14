import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { agentName, type AgentState, type Effect, type NodeStatus, type Phase, type TopoNode, type World } from './world';

/**
 * The board: a tabletop model of the workflow. Stations are graph nodes, the coloured
 * pieces are agents, and the small puck is the work moving between stages.
 */

export const PHASE_COLOR: Record<Phase, number> = {
  discover: 0xe0a526,
  design: 0x2f7fc1,
  build: 0xc8436a,
  review: 0x6f5bd3,
  release: 0x1f9d6b,
};

export const ROLE_COLOR: Record<string, number> = {
  analyst: 0xe0a526,
  product: 0xe8742c,
  ux: 0xd9488f,
  architect: 0x2f7fc1,
  compliance: 0x5b7a2a,
  expert: 0x3a9fbf,
  security: 0x12908e,
  planner: 0x4a5fd0,
  developer: 0xc8436a,
  qa: 0x8a6d1f,
  reviewer: 0x6f5bd3,
  writer: 0x1f9d6b,
};

const PAPER = 0xf3f5f4;
const CARD = 0xffffff;
const INK = 0x16262e;
const WAIT = 0xf2a900;
const BAD = 0xd43b3b;
const GOOD = 0x1f9d6b;

/** The harness publishes a compact grid; the board spreads it out so labels have room. */
const SX = 1.22;
const SZ = 1.15;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

interface Station {
  node: TopoNode;
  group: THREE.Group;
  cap: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  tag: HTMLDivElement;
  status: NodeStatus;
  flash: { color: THREE.Color; t: number } | null;
}

interface Piece {
  id: string;
  group: THREE.Group;
  target: THREE.Vector3;
  home: THREE.Vector3;
  bubble: HTMLDivElement;
  working: boolean;
  phase: number;
}

interface Puck {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
}

export class BoardScene {
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private board = new THREE.Group();
  private stations = new Map<string, Station>();
  private pieces = new Map<string, Piece>();
  private pucks: Puck[] = [];
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private selected: string | null = null;
  private topologyKey = '';
  onSelect: (kind: 'node' | 'agent', id: string) => void = () => {};

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    host.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(37, 1, 1, 900);
    this.camera.position.set(-5, 58, 64);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(1, 0, 8);
    this.controls.enableDamping = true;
    this.controls.minDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.44;
    this.controls.screenSpacePanning = false;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c4c9, 1.15));
    const sun = new THREE.DirectionalLight(0xfff4e2, 2.1);
    sun.position.set(-22, 40, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 42, bottom: -42, near: 1, far: 160 });
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 5;
    this.scene.add(sun);
    this.scene.add(this.board);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.domElement.addEventListener('click', (e) => this.pick(e));
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    const narrow = w < 860;
    this.camera.fov = 37;
    // Centre the board in the space the side panel and transport leave free.
    if (narrow) this.camera.setViewOffset(w, h, 0, h * 0.2, w, h);
    else this.camera.setViewOffset(w, h, 150, 10, w, h);
    // Pull back on tall, narrow screens until the board's full width is in view.
    const distance = 96 * Math.max(1, 1.15 / (w / h));
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(distance);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.maxDistance = distance * 1.8;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ build

  private rebuild(world: World): void {
    this.board.clear();
    for (const el of this.labels.domElement.querySelectorAll('.tag, .bubble')) el.remove();
    this.stations.clear();
    this.pieces.clear();
    this.pucks = [];

    const nodes = world.topology.nodes;
    if (!nodes.length) return;

    const base = new THREE.Mesh(new RoundedBoxGeometry(48 * SX + 4, 1.2, 45 * SZ, 4, 0.6), new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.95 }));
    base.position.set(0.5 * SX, -0.62, 7.4 * SZ);
    base.receiveShadow = true;
    this.board.add(base);

    // Phase zones: tinted mats under each group of stations.
    for (const phase of Object.keys(PHASE_COLOR) as Phase[]) {
      const group = nodes.filter((n) => n.phase === phase);
      if (!group.length) continue;
      const xs = group.map((n) => n.x * SX);
      const zs = group.map((n) => n.z * SZ);
      const w = Math.max(...xs) - Math.min(...xs) + 5;
      const d = Math.max(...zs) - Math.min(...zs) + 5;
      const mat = new THREE.Mesh(
        new RoundedBoxGeometry(w, 0.08, d, 3, 0.04),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(PHASE_COLOR[phase]).lerp(new THREE.Color(PAPER), 0.8), roughness: 1 }),
      );
      mat.position.set((Math.max(...xs) + Math.min(...xs)) / 2, 0.02, (Math.max(...zs) + Math.min(...zs)) / 2);
      mat.receiveShadow = true;
      this.board.add(mat);
    }

    const at = (id: string) => {
      const n = nodes.find((x) => x.id === id);
      return n ? new THREE.Vector3(n.x * SX, 0, n.z * SZ) : null;
    };

    for (const edge of world.topology.edges) {
      const a = at(edge.from);
      const b = at(edge.to);
      if (!a || !b) continue;
      const dir = b.clone().sub(a);
      const length = dir.length() - 2.6;
      if (length <= 0.2) continue;
      const loop = edge.kind === 'loop';
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(loop ? 0.1 : 0.2, 0.03, length),
        new THREE.MeshStandardMaterial({ color: loop ? 0x9aa7ad : 0x55676f, roughness: 1 }),
      );
      // Loop edges sit slightly to one side so a there-and-back pair stays readable.
      const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(loop ? 0.35 : 0);
      strip.position.copy(a.clone().add(b).multiplyScalar(0.5).add(side)).setY(0.09);
      strip.lookAt(strip.position.clone().add(dir));
      this.board.add(strip);
      const head = new THREE.Mesh(new THREE.ConeGeometry(loop ? 0.22 : 0.3, 0.6, 3), strip.material);
      head.position.copy(b.clone().sub(dir.clone().normalize().multiplyScalar(1.55)).add(side)).setY(0.1);
      head.lookAt(head.position.clone().add(dir));
      head.rotateX(Math.PI / 2);
      head.scale.y = 1;
      head.scale.z = 0.12;
      this.board.add(head);
    }

    for (const node of nodes) this.addStation(node);
  }

  private addStation(node: TopoNode): void {
    const group = new THREE.Group();
    group.position.set(node.x * SX, 0, node.z * SZ);
    group.userData = { kind: 'node', id: node.id };
    const accent = PHASE_COLOR[node.phase];
    const bodyMat = new THREE.MeshStandardMaterial({ color: CARD, roughness: 0.8 });
    const capMat = new THREE.MeshStandardMaterial({ color: CARD, roughness: 0.6, emissive: accent, emissiveIntensity: 0 });
    let body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    let cap: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

    if (node.kind === 'gate') {
      // A gate is an archway: two posts and a beam that carries the signal colour.
      body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.1, 0.34), bodyMat);
      body.position.set(-0.85, 1.05, 0);
      const post = body.clone();
      post.position.x = 0.85;
      group.add(post);
      cap = new THREE.Mesh(new RoundedBoxGeometry(2.3, 0.5, 0.5, 3, 0.12), capMat);
      cap.position.y = 2.3;
    } else if (node.kind === 'check') {
      body = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 0.7, 4), bodyMat);
      body.position.y = 0.35;
      cap = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.16, 4), capMat);
      cap.position.y = 0.78;
    } else {
      body = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, 0.8, 6), bodyMat);
      body.position.y = 0.4;
      cap = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.16, 6), capMat);
      cap.position.y = 0.88;
    }
    for (const mesh of [body, cap]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    group.add(body, cap);

    const ring = new THREE.Mesh(new THREE.RingGeometry(1.75, 1.95, 48), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.11;
    group.add(ring);

    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.innerHTML = `<span class="tag-name"></span><span class="tag-note"></span>`;
    (tag.firstElementChild as HTMLElement).textContent = node.label;
    const label = new CSS2DObject(tag);
    // Gate names sit behind their arch and station names in front, so neighbours never share a line of text.
    label.position.set(0, 0, node.kind === 'gate' ? -1.2 : 2.0);
    label.center.set(0.5, node.kind === 'gate' ? 1 : 0);
    if (node.kind === 'gate') tag.classList.add('tag-gate');
    group.add(label);

    this.board.add(group);
    this.stations.set(node.id, { node, group, cap, body, ring, tag, status: 'idle', flash: null });
  }

  private addPiece(agent: AgentState): Piece {
    const color = new THREE.Color(ROLE_COLOR[agent.role] ?? 0x55676f);
    if (agent.lens) color.offsetHSL(0, 0, (['code', 'security', 'ux', 'architecture'].indexOf(agent.lens) - 1) * 0.07);
    // Parallel agents of one role stay in the role's colour family but are told apart by shade.
    if (agent.tag) color.offsetHSL(0, 0, ((agent.order % 3) - 1) * 0.06);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
    const group = new THREE.Group();
    group.userData = { kind: 'agent', id: agent.id };
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.5, 6, 16), mat);
    body.position.y = 0.67;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 16), mat);
    head.position.y = 1.5;
    const visor = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.17, 0.2, 2, 0.06), new THREE.MeshStandardMaterial({ color: INK, roughness: 0.2 }));
    visor.position.set(0, 1.53, 0.26);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3), new THREE.MeshStandardMaterial({ color: INK }));
    stalk.position.y = 1.98;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0.4 }));
    bulb.position.y = 2.16;
    bulb.name = 'bulb';
    for (const mesh of [body, head, visor, stalk, bulb]) mesh.castShadow = true;
    group.add(body, head, visor, stalk, bulb);

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.style.setProperty('--role', `#${color.getHexString()}`);
    const label = new CSS2DObject(bubble);
    label.position.set(0, 2.5, 0);
    label.center.set(0.5, 1);
    group.add(label);

    // Idle pieces wait on a bench along the front edge of the board.
    const home = new THREE.Vector3((-19 + (agent.order % 13) * 3.0) * SX, 0, (24.5 + Math.floor(agent.order / 13) * 2.4) * SZ);
    group.position.copy(home);
    this.board.add(group);
    const piece: Piece = { id: agent.id, group, target: home.clone(), home, bubble, working: false, phase: agent.order * 1.7 };
    this.pieces.set(agent.id, piece);
    return piece;
  }

  // ------------------------------------------------------------------- sync

  /** Brings the board in line with the world. `instant` skips travel (used when scrubbing). */
  sync(world: World, effects: Effect[], instant: boolean): void {
    const key = world.run.id + world.topology.nodes.length;
    if (key !== this.topologyKey) {
      this.topologyKey = key;
      this.rebuild(world);
    }
    const snap = instant || reducedMotion.matches;

    for (const [id, state] of world.nodes) {
      const station = this.stations.get(id);
      if (!station) continue;
      station.status = state.status;
      station.tag.dataset.status = state.status;
      station.tag.classList.toggle('is-selected', this.selected === id);
      (station.tag.lastElementChild as HTMLElement).textContent = state.note;
    }

    const seen = new Set<string>();
    const crowd = new Map<string, number>();
    for (const agent of world.agents.values()) {
      seen.add(agent.id);
      const piece = this.pieces.get(agent.id) ?? this.addPiece(agent);
      const station = agent.node ? this.stations.get(agent.node) : undefined;
      // Agents stand to the left of their station, clear of its label. Several agents at one
      // station (parallel build tracks, a review ensemble) fan out in a row behind it.
      const slot = station ? (crowd.get(station.node.id) ?? 0) : 0;
      if (station) crowd.set(station.node.id, slot + 1);
      piece.target.copy(station ? station.group.position.clone().add(new THREE.Vector3(-2.3 + slot * 1.25, 0, 0.5 - slot * 1.5)) : piece.home);
      piece.working = agent.working;
      piece.bubble.textContent = agent.node ? `${agentName(agent)}: ${agent.activity}` : agentName(agent);
      piece.bubble.classList.toggle('is-idle', !agent.node);
      piece.bubble.classList.toggle('is-selected', this.selected === agent.id);
      if (snap) piece.group.position.copy(piece.target);
    }
    for (const [id, piece] of this.pieces) {
      if (seen.has(id)) continue;
      this.board.remove(piece.group);
      piece.bubble.remove();
      this.pieces.delete(id);
    }

    if (snap) return;
    for (const effect of effects) {
      if (effect.kind === 'travel') {
        const a = this.stations.get(effect.from);
        const b = this.stations.get(effect.to);
        if (!a || !b) continue;
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: PHASE_COLOR[b.node.phase], emissiveIntensity: 1.4 }));
        this.board.add(mesh);
        this.pucks.push({ mesh, from: a.group.position.clone(), to: b.group.position.clone(), t: 0 });
      } else {
        const station = this.stations.get(effect.node);
        if (station) station.flash = { color: new THREE.Color(effect.tone === 'good' ? GOOD : effect.tone === 'warn' ? WAIT : BAD), t: 0 };
      }
    }
  }

  select(id: string | null): void {
    this.selected = id;
  }

  private pick(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const point = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(point, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.board.children, true)) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj && !obj.userData.kind) obj = obj.parent;
      if (obj) {
        this.onSelect(obj.userData.kind, obj.userData.id);
        return;
      }
    }
  }

  // ------------------------------------------------------------------ frame

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const time = this.clock.elapsedTime;
    const calm = reducedMotion.matches;

    for (const station of this.stations.values()) {
      const accent = new THREE.Color(PHASE_COLOR[station.node.phase]);
      const { cap, body, ring } = station;
      let capColor = new THREE.Color(CARD);
      let glow = 0;
      let ringOpacity = 0;
      let opacity = 1;
      switch (station.status) {
        case 'active':
          capColor = accent;
          glow = calm ? 0.5 : 0.45 + Math.sin(time * 4) * 0.25;
          ringOpacity = 0.9;
          break;
        case 'done':
          capColor = accent;
          break;
        case 'waiting':
          capColor = new THREE.Color(WAIT);
          cap.material.emissive.setHex(WAIT);
          glow = calm ? 0.8 : 0.6 + Math.sin(time * 6) * 0.4;
          ringOpacity = 1;
          break;
        case 'failed':
          capColor = new THREE.Color(BAD);
          break;
        case 'skipped':
          opacity = 0.3;
          break;
      }
      if (station.status !== 'waiting') cap.material.emissive.copy(accent);
      if (station.flash) {
        station.flash.t += dt;
        const k = Math.max(0, 1 - station.flash.t / 1.1);
        capColor.lerp(station.flash.color, k);
        cap.material.emissive.copy(station.flash.color);
        glow = Math.max(glow, k * 1.2);
        if (k === 0) station.flash = null;
      }
      cap.material.color.lerp(capColor, 0.2);
      cap.material.emissiveIntensity = glow;
      for (const mat of [cap.material, body.material]) {
        mat.transparent = opacity < 1;
        mat.opacity = opacity;
      }
      ring.material.color.setHex(station.status === 'waiting' ? WAIT : PHASE_COLOR[station.node.phase]);
      ring.material.opacity += (ringOpacity - ring.material.opacity) * 0.15;
      if (!calm) ring.scale.setScalar(station.status === 'waiting' ? 1 + (time % 1) * 0.35 : 1);
    }

    for (const piece of this.pieces.values()) {
      const pos = piece.group.position;
      const flat = new THREE.Vector3(piece.target.x - pos.x, 0, piece.target.z - pos.z);
      const distance = flat.length();
      if (distance > 0.03) {
        const step = Math.min(distance, 13 * dt);
        pos.add(flat.normalize().multiplyScalar(step));
        pos.y = calm ? 0 : Math.abs(Math.sin(time * 11 + piece.phase)) * 0.22;
        piece.group.rotation.y = Math.atan2(flat.x, flat.z);
      } else {
        pos.y += (0 - pos.y) * 0.3;
        if (piece.working && !calm) {
          piece.group.rotation.y += (Math.sin(time * 2.2 + piece.phase) * 0.5 - piece.group.rotation.y) * 0.08;
          piece.group.scale.y = 1 + Math.sin(time * 6 + piece.phase) * 0.035;
        } else {
          piece.group.rotation.y *= 0.92;
          piece.group.scale.y = 1;
        }
      }
      const bulb = piece.group.getObjectByName('bulb') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | undefined;
      if (bulb) bulb.material.emissiveIntensity = piece.working ? (calm ? 2 : 1.6 + Math.sin(time * 9 + piece.phase) * 1.2) : 0.3;
    }

    this.pucks = this.pucks.filter((puck) => {
      puck.t += dt / 0.7;
      const k = Math.min(puck.t, 1);
      const eased = k * k * (3 - 2 * k);
      puck.mesh.position.lerpVectors(puck.from, puck.to, eased).setY(1.3 + Math.sin(eased * Math.PI) * 1.6);
      if (k < 1) return true;
      this.board.remove(puck.mesh);
      return false;
    });

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}
