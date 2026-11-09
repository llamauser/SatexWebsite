import {
  AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, DoubleSide, Fog, Mesh, MeshPhysicalMaterial,
  MeshStandardMaterial, NeutralToneMapping, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Plane, Raycaster, RepeatWrapping, Scene, SphereGeometry, Vector2, Vector3,
  WebGLRenderer, type Texture,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { FeelScores } from "@/lib/cloth/feel";
import { solverParams } from "@/lib/cloth/xpbd/calibrate";
import { CLOTH_SIZE, HANG_HEIGHT, HANG_INSET, SPHERE, TABLE, type ClothMode } from "@/lib/cloth/xpbd/solver.cpu";
import { smoothGrid, type SmoothGrid } from "@/lib/cloth/xpbd/surface";
import { weaveCanvas, weaveFor } from "@/lib/cloth/xpbd/weave";

const SIM_N = 30;
const DEGRADED_N = 20;
const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

/** Where the camera looks from for each mode: the hanging cloth is seen from the front, what is dropped on an object from above. */
const VIEWS: Record<ClothMode, { position: [number, number, number]; target: [number, number, number] }> = {
  hang: { position: [0, 0.46, 1.08], target: [0, 0.36, 0] },
  wind: { position: [0.14, 0.46, 1.08], target: [0, 0.36, 0] },
  table: { position: [0, 0.5, 0.8], target: [0, 0.08, 0] },
  sphere: { position: [0, 0.46, 0.74], target: [0, 0.1, 0] },
};

export interface ClothSceneOptions {
  feel: FeelScores;
  gsm: number;
  structure: string;
  construction: string;
  stretchLimitPct: number | null;
  color: string;
  onStrain: (pct: number) => void;
  onReady: () => void;
}

type WorkerMessage = { type: "ready"; n: number } | { type: "frame"; positions: Float32Array; strainPct: number };

/** The 3D side of the swatch: a renderer, the cloth simulation in its worker, and the little world around it (floor, block, ball, pins). */
export class ClothScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private worker: Worker;
  private cloth: Mesh;
  private clothGeometry: BufferGeometry;
  private material: MeshPhysicalMaterial;
  private smooth: SmoothGrid;
  private particles: Float32Array | null = null;
  private mode: ClothMode = "hang";
  private view = { position: new Vector3(...VIEWS.hang.position), target: new Vector3(...VIEWS.hang.target) };
  private table: Mesh;
  private ball: Mesh;
  private pins: Mesh[] = [];
  private rod: Mesh;
  private marker: Mesh;
  private raycaster = new Raycaster();
  private dragPlane = new Plane();
  private dragging = false;
  private observer: ResizeObserver;
  private disposables: { dispose: () => void }[] = [];
  private environment: Texture | null = null;
  private frame = 0;
  private disposed = false;
  private inFlight = false;
  private pendingDt = 0;
  private lastTime = 0;
  private slowSince = 0;
  private sampleTime = 0;
  private samples = 0;
  private lastStrain = -1;
  private n = SIM_N;
  private ready = false;

  constructor(private host: HTMLElement, private opts: ClothSceneOptions) {
    const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 0.85; // pale fabrics must not burn out
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    this.renderer = renderer;

    this.camera = new PerspectiveCamera(34, host.clientWidth / Math.max(1, host.clientHeight), 0.05, 8);
    this.camera.position.copy(this.view.position);
    this.camera.lookAt(this.view.target);

    const background = new Color("#eef1f3");
    this.scene.background = background;
    this.scene.fog = new Fog(background, 2.2, 4.5);
    // soft, even light from a room, plus one lamp that casts the shadows (they are what shows the folds)
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    this.environment = target.texture;
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = 0.55;
    this.disposables.push(target, pmrem, room);
    this.scene.add(new AmbientLight(0xffffff, 0.15));
    const lamp = new DirectionalLight(0xffffff, 1.9);
    lamp.position.set(0.55, 1.2, 0.9);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.camera.left = lamp.shadow.camera.bottom = -0.7;
    lamp.shadow.camera.right = lamp.shadow.camera.top = 0.7;
    lamp.shadow.camera.near = 0.3;
    lamp.shadow.camera.far = 3.5;
    lamp.shadow.bias = -0.0004;
    lamp.shadow.normalBias = 0.003;
    lamp.target.position.set(0, 0.2, 0);
    this.scene.add(lamp, lamp.target);

    const floorMaterial = new MeshStandardMaterial({ color: "#e4e8eb", roughness: 1 });
    const floor = new Mesh(new PlaneGeometry(6, 6), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.disposables.push(floorMaterial, floor.geometry);

    const solid = (color: string, roughness: number) => new MeshStandardMaterial({ color, roughness });
    const tableMaterial = solid("#c2ae92", 0.7), ballMaterial = solid("#d9dde1", 0.45), steel = solid("#56606b", 0.4);
    this.table = new Mesh(new BoxGeometry(TABLE.half * 2, TABLE.height, TABLE.half * 2), tableMaterial);
    this.table.position.y = TABLE.height / 2;
    this.ball = new Mesh(new SphereGeometry(SPHERE.radius, 48, 32), ballMaterial);
    this.ball.position.y = SPHERE.radius;
    for (const object of [this.table, this.ball]) { object.castShadow = true; object.receiveShadow = true; this.scene.add(object); this.disposables.push(object.geometry); }
    const pinGeometry = new SphereGeometry(0.008, 16, 12);
    for (const x of [-CLOTH_SIZE / 2 + HANG_INSET, CLOTH_SIZE / 2 - HANG_INSET]) {
      const pin = new Mesh(pinGeometry, steel);
      pin.position.set(x, HANG_HEIGHT + 0.004, 0);
      pin.castShadow = true;
      this.pins.push(pin);
      this.scene.add(pin);
    }
    this.rod = new Mesh(new CylinderGeometry(0.005, 0.005, CLOTH_SIZE + 0.04, 16), steel);
    this.rod.rotation.z = Math.PI / 2;
    this.rod.position.set(0, HANG_HEIGHT + 0.006, 0);
    this.rod.castShadow = true;
    this.scene.add(this.rod);
    this.marker = new Mesh(new SphereGeometry(0.008, 16, 12), new MeshStandardMaterial({ color: "#1f6feb", emissive: "#1f6feb", emissiveIntensity: 0.6 }));
    this.marker.visible = false;
    this.scene.add(this.marker);
    this.disposables.push(tableMaterial, ballMaterial, steel, pinGeometry, this.rod.geometry, this.marker.geometry, this.marker.material as MeshStandardMaterial);

    // the cloth: drawn on a finer grid than it is simulated, with the weave of its structure as a bump map
    const { feel } = opts;
    const weave: Texture = new CanvasTexture(weaveCanvas(weaveFor(opts.structure, opts.construction)));
    weave.wrapS = weave.wrapT = RepeatWrapping;
    weave.repeat.set(6, 6);
    weave.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const color = new Color(opts.color);
    this.material = new MeshPhysicalMaterial({
      color, roughness: lerp(0.92, 0.38, feel.sheen / 10), sheen: lerp(0.9, 0.35, feel.sheen / 10), sheenRoughness: 0.5, sheenColor: color.clone().lerp(new Color("#ffffff"), 0.35),
      bumpMap: weave, bumpScale: 0.7, side: DoubleSide,
    });
    this.disposables.push(weave, this.material);
    this.smooth = smoothGrid(SIM_N, 3);
    this.clothGeometry = this.makeGeometry();
    this.cloth = new Mesh(this.clothGeometry, this.material);
    this.cloth.castShadow = true;
    this.cloth.receiveShadow = true;
    this.cloth.frustumCulled = false;
    this.cloth.visible = false; // until the first pose arrives
    this.scene.add(this.cloth);

    this.worker = new Worker(new URL("../../lib/cloth/xpbd/solver.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.onWorker(event.data);
    this.worker.postMessage({ type: "init", n: this.n, params: solverParams(feel, opts.gsm, this.n, opts.stretchLimitPct) });

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.applyMode();
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  // ------------------------------------------------------------------ from the page
  setMode(mode: ClothMode) {
    this.mode = mode;
    this.worker.postMessage({ type: "mode", mode });
    this.applyMode();
  }

  reset() {
    this.worker.postMessage({ type: "mode", mode: this.mode });
  }

  setColor(hex: string) {
    this.material.color.set(hex);
    this.material.sheenColor.copy(this.material.color).lerp(new Color("#ffffff"), 0.35);
  }

  /** Is there cloth under the pointer? (to show the grabbing hand) */
  hover(clientX: number, clientY: number): boolean {
    return this.hit(clientX, clientY) !== null;
  }

  pointerDown(clientX: number, clientY: number): boolean {
    const hit = this.hit(clientX, clientY);
    if (!hit || !this.particles) return false;
    let index = 0, nearest = Infinity;
    const p = this.particles;
    for (let i = 0; i < p.length / 3; i++) {
      const d = (p[i * 3]! - hit.x) ** 2 + (p[i * 3 + 1]! - hit.y) ** 2 + (p[i * 3 + 2]! - hit.z) ** 2;
      if (d < nearest) { nearest = d; index = i; }
    }
    this.dragPlane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new Vector3()), hit);
    this.dragging = true;
    this.marker.visible = true;
    this.marker.position.copy(hit);
    this.worker.postMessage({ type: "grab", index, target: [hit.x, hit.y, hit.z] });
    return true;
  }

  pointerMove(clientX: number, clientY: number) {
    if (!this.dragging) return;
    this.setRay(clientX, clientY);
    const point = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3());
    if (!point) return;
    point.y = Math.max(0.01, point.y);
    this.marker.position.copy(point);
    this.worker.postMessage({ type: "move", target: [point.x, point.y, point.z] });
  }

  pointerUp() {
    if (!this.dragging) return;
    this.dragging = false;
    this.marker.visible = false;
    this.worker.postMessage({ type: "release" });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.worker.terminate();
    this.clothGeometry.dispose();
    for (const item of this.disposables) item.dispose();
    this.environment = null;
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // dispose() alone leaves the WebGL context alive until the page is closed
    if (this.renderer.domElement.parentNode === this.host) this.host.removeChild(this.renderer.domElement);
  }

  // ------------------------------------------------------------------ inside
  private makeGeometry() {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(this.smooth.size * this.smooth.size * 3), 3));
    geometry.setAttribute("uv", new BufferAttribute(this.smooth.uvs, 2));
    geometry.setIndex(new BufferAttribute(this.smooth.indices, 1));
    return geometry;
  }

  private applyMode() {
    this.table.visible = this.mode === "table";
    this.ball.visible = this.mode === "sphere";
    this.rod.visible = this.mode === "wind";
    for (const pin of this.pins) pin.visible = this.mode === "hang";
    this.marker.visible = false;
    this.dragging = false;
  }

  private onWorker(message: WorkerMessage) {
    if (message.type === "ready") { this.inFlight = false; return; }
    this.inFlight = false;
    this.particles = message.positions;
    const position = this.clothGeometry.getAttribute("position") as BufferAttribute;
    this.smooth.evaluate(message.positions, position.array as Float32Array);
    position.needsUpdate = true;
    this.clothGeometry.computeVertexNormals();
    if (!this.ready) { this.ready = true; this.cloth.visible = true; this.opts.onReady(); }
    if (Math.abs(message.strainPct - this.lastStrain) >= 0.5) { this.lastStrain = message.strainPct; this.opts.onStrain(message.strainPct); }
  }

  private setRay(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
  }

  private hit(clientX: number, clientY: number): Vector3 | null {
    if (!this.ready) return null;
    this.setRay(clientX, clientY);
    return this.raycaster.intersectObject(this.cloth)[0]?.point.clone() ?? null;
  }

  private resize() {
    const width = this.host.clientWidth, height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private tick(time: number) {
    if (this.disposed) return;
    this.frame = requestAnimationFrame((t) => this.tick(t));
    const elapsed = Math.min(100, this.lastTime ? time - this.lastTime : 16);
    this.lastTime = time;
    if (document.visibilityState === "visible") this.pendingDt += elapsed / 1000;
    else this.pendingDt = 0;
    if (!this.inFlight && this.pendingDt > 0 && this.ready) {
      this.inFlight = true;
      this.worker.postMessage({ type: "step", dt: this.pendingDt });
      this.pendingDt = 0;
    }
    // the camera glides to the view of the mode
    const goal = VIEWS[this.mode];
    const k = 1 - Math.exp(-elapsed / 1000 * 4);
    this.view.position.lerp(new Vector3(...goal.position), k);
    this.view.target.lerp(new Vector3(...goal.target), k);
    this.camera.position.copy(this.view.position);
    this.camera.lookAt(this.view.target);
    this.renderer.render(this.scene, this.camera);
    this.watchSpeed(time, elapsed);
  }

  /** A device that cannot keep up (frames slower than 40 ms for two seconds) gets a coarser cloth. */
  private watchSpeed(time: number, elapsed: number) {
    this.sampleTime += elapsed;
    this.samples++;
    if (this.samples < 60) return;
    const average = this.sampleTime / this.samples;
    this.sampleTime = 0; this.samples = 0;
    if (average <= 40) { this.slowSince = 0; return; }
    if (!this.slowSince) this.slowSince = time;
    if (this.n > DEGRADED_N && time - this.slowSince > 2000) {
      this.n = DEGRADED_N;
      this.smooth = smoothGrid(this.n, 4);
      this.clothGeometry.dispose();
      this.clothGeometry = this.makeGeometry();
      this.cloth.geometry = this.clothGeometry;
      this.particles = null;
      this.inFlight = true;
      this.worker.postMessage({ type: "init", n: this.n, params: solverParams(this.opts.feel, this.opts.gsm, this.n, this.opts.stretchLimitPct) });
      this.worker.postMessage({ type: "mode", mode: this.mode });
    }
  }
}
