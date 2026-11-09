"use client";

import { AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, GridHelper, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, Plane, Raycaster, Scene, SphereGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Camera } from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { mapFeelToPhysics } from "@/lib/cloth/mapping";
import type { FeelScores } from "@/lib/cloth/feel";
import type { ClothMode } from "@/lib/cloth/xpbd/solver.cpu";

type ColorOption = { id: string; label: string; hex: string };
type WorkerMessage = { type: "ready"; n: number } | { type: "frame"; positions: Float32Array; strainPct: number };
const INITIAL_N = 30;

export function ClothSwatch({ colors, gsm, feel, stretchLimitPct }: { colors: ColorOption[]; gsm: number; feel: FeelScores; stretchLimitPct: number | null }) {
  const t = useTranslations("fabric.feel");
  const hostRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const materialRef = useRef<MeshPhysicalMaterial | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const positionsRef = useRef<Float32Array | null>(null);
  const raycasterRef = useRef(new Raycaster());
  const planeRef = useRef(new Plane());
  const draggingRef = useRef(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [mode, setMode] = useState<ClothMode>("hang");
  const [strain, setStrain] = useState(0);
  const [colorId, setColorId] = useState(colors[0]?.id ?? "");
  const selected = colors.find((color) => color.id === colorId) ?? colors[0];
  const colorRef = useRef(colors[0]?.hex ?? "#557d86");
  const physics = useMemo(() => mapFeelToPhysics(feel, gsm, { gridSize: INITIAL_N }), [feel, gsm]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: WebGLRenderer | null = null;
    let scene: Scene | null = null;
    let camera: PerspectiveCamera | null = null;
    let geometry: BufferGeometry | null = null;
    let observer: ResizeObserver | null = null;
    let animation = 0;
    let disposed = false;
    let inFlight = false;
    let pendingDt = 0;
    let priorTime = 0;
    let slowStart = 0;
    let total = 0;
    let samples = 0;
    let degraded = false;
    let currentN = INITIAL_N;
    let lastStrain = -1;
    const disposables: { dispose: () => void }[] = [];

    const makeGeometry = (n: number) => {
      const next = new BufferGeometry();
      const values = new Float32Array(n * n * 3);
      const indices: number[] = [];
      for (let row = 0; row < n - 1; row++) for (let col = 0; col < n - 1; col++) {
        const a = row * n + col; const b = a + n; const c = a + 1; const d = b + 1;
        indices.push(a, b, c, c, b, d);
      }
      next.setAttribute("position", new BufferAttribute(values, 3));
      next.setIndex(indices);
      return next;
    };
    const setup = () => {
      try {
        if (disposed) return;
        renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.setSize(host.clientWidth, host.clientHeight);
        host.appendChild(renderer.domElement);
        scene = new Scene();
        scene.background = new Color("#f6f7f7");
        camera = new PerspectiveCamera(35, host.clientWidth / Math.max(1, host.clientHeight), 0.01, 10);
        camera.position.set(0, 0.63, 1.12);
        camera.lookAt(0, 0.3, 0);
        cameraRef.current = camera;
        scene.add(new AmbientLight(0xffffff, 1.4));
        const light = new DirectionalLight(0xffffff, 2.2); light.position.set(-0.6, 1, 0.8); scene.add(light);
        const grid = new GridHelper(1.1, 12, 0xcbd5d5, 0xe2e8e8); grid.position.y = 0; scene.add(grid);
        disposables.push(grid.geometry, grid.material as unknown as { dispose: () => void });
        const tableGeometry = new BoxGeometry(0.42, 0.035, 0.28); const tableMaterial = new MeshStandardMaterial({ color: "#9c8c76", roughness: 0.85 });
        const table = new Mesh(tableGeometry, tableMaterial);
        table.position.set(0, 0.18, 0); scene.add(table);
        const ballGeometry = new SphereGeometry(0.12, 24, 16); const ballMaterial = new MeshStandardMaterial({ color: "#c6b9a6", roughness: 0.8 });
        const ball = new Mesh(ballGeometry, ballMaterial);
        ball.position.set(0, 0.18, 0); scene.add(ball);
        const clothMaterial = new MeshPhysicalMaterial({ color: colorRef.current, roughness: 0.68, metalness: 0, sheen: Math.min(0.8, feel.sheen / 10 * 0.8), sheenColor: colorRef.current, side: DoubleSide });
        materialRef.current = clothMaterial;
        disposables.push(tableGeometry, tableMaterial, ballGeometry, ballMaterial, clothMaterial);
        geometry = makeGeometry(INITIAL_N);
        const mesh = new Mesh(geometry, clothMaterial); meshRef.current = mesh; scene.add(mesh);
        setSupported(true);

        const worker = new Worker(new URL("../../lib/cloth/xpbd/solver.worker.ts", import.meta.url), { type: "module" });
        workerRef.current = worker;
        worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
          const payload = event.data;
          if (payload.type === "ready") { inFlight = false; return; }
          if (payload.type !== "frame") return;
          inFlight = false;
          positionsRef.current = payload.positions;
          if (Math.abs(payload.strainPct - lastStrain) >= 0.5) { lastStrain = payload.strainPct; setStrain(payload.strainPct); } // not one re-render per frame
          const attribute = mesh.geometry.getAttribute("position") as import("three").BufferAttribute;
          if (attribute.array.length === payload.positions.length) {
            (attribute.array as Float32Array).set(payload.positions);
            attribute.needsUpdate = true;
            mesh.geometry.computeVertexNormals();
          }
        };
        worker.postMessage({ type: "init", n: currentN, params: physics.xpbd });

        const resize = () => {
          const width = host.clientWidth; const height = Math.max(1, host.clientHeight);
          camera!.aspect = width / height; camera!.updateProjectionMatrix(); renderer!.setSize(width, height);
        };
        observer = new ResizeObserver(resize); observer.observe(host);
        const tick = (time: number) => {
          if (disposed) return;
          animation = requestAnimationFrame(tick);
          if (!priorTime) priorTime = time;
          const elapsed = Math.min(100, time - priorTime); priorTime = time;
          total += elapsed; samples++;
          if (document.visibilityState === "visible") pendingDt += elapsed / 1000;
          else pendingDt = 0;
          if (document.visibilityState === "visible" && !inFlight && pendingDt > 0) {
            inFlight = true;
            worker.postMessage({ type: "step", dt: pendingDt });
            pendingDt = 0;
          }
          renderer?.render(scene!, camera!);
          if (samples >= 60) {
            const average = total / samples; total = 0; samples = 0;
            if (average > 40) { if (!slowStart) slowStart = time; }
            else slowStart = 0;
            if (!degraded && slowStart && time - slowStart > 2000) {
              degraded = true; currentN = 20; inFlight = true;
              mesh.geometry.dispose(); mesh.geometry = makeGeometry(currentN); geometry = mesh.geometry; positionsRef.current = null;
              worker.postMessage({ type: "init", n: currentN, params: mapFeelToPhysics(feel, gsm, { gridSize: currentN }).xpbd });
            }
          }
        };
        animation = requestAnimationFrame(tick);
      } catch {
        if (!disposed) setSupported(false);
      }
    };
    setup();
    return () => {
      disposed = true; cancelAnimationFrame(animation); observer?.disconnect(); workerRef.current?.terminate(); workerRef.current = null; meshRef.current = null; cameraRef.current = null;
      materialRef.current = null;
      for (const item of disposables) item.dispose();
      geometry?.dispose();
      renderer?.dispose(); renderer?.forceContextLoss(); // dispose() alone leaves the WebGL context alive until the page is closed
      if (host && renderer?.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, [physics, feel, gsm]);

  // choosing another color only recolors the cloth: no new renderer, no new simulation
  useEffect(() => {
    const hex = selected?.hex;
    if (!hex) return;
    colorRef.current = hex;
    materialRef.current?.color.set(hex);
    materialRef.current?.sheenColor.set(hex);
  }, [selected?.hex]);

  useEffect(() => { if (supported) workerRef.current?.postMessage({ type: "mode", mode }); }, [mode, supported]);

  const pointFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const pointer = new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const mesh = meshRef.current;
    const positions = positionsRef.current;
    if (!mesh || !positions) return null;
    if (!cameraRef.current) return null;
    raycasterRef.current.setFromCamera(pointer, cameraRef.current);
    const hit = raycasterRef.current.intersectObject(mesh)[0];
    if (!hit) return null;
    const local = mesh.worldToLocal(hit.point.clone());
    let index = 0; let nearest = Infinity;
    for (let i = 0; i < positions.length / 3; i++) {
      const d = (positions[i * 3]! - local.x) ** 2 + (positions[i * 3 + 1]! - local.y) ** 2 + (positions[i * 3 + 2]! - local.z) ** 2;
      if (d < nearest) { nearest = d; index = i; }
    }
    planeRef.current.setFromNormalAndCoplanarPoint(cameraRef.current.getWorldDirection(new Vector3()), hit.point);
    return { index, point: hit.point };
  };
  const movePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const pointer = new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const mesh = meshRef.current;
    const camera = cameraRef.current;
    if (!mesh || !camera) return;
    raycasterRef.current.setFromCamera(pointer, camera);
    const world = raycasterRef.current.ray.intersectPlane(planeRef.current, new Vector3());
    if (world) { const local = mesh.worldToLocal(world); workerRef.current?.postMessage({ type: "move", target: [local.x, local.y, local.z] }); }
  };

  const modes: ClothMode[] = ["hang", "table", "sphere", "wind"];
  return <section className="space-y-3" aria-label={t("swatchTitle")}>
    <div className="flex flex-wrap items-center gap-2">{modes.map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-full border px-3 py-1.5 text-sm ${mode === value ? "border-primary bg-primary/10" : "border-border"}`}>{t(`modes.${value}`)}</button>)}<button type="button" onClick={() => workerRef.current?.postMessage({ type: "mode", mode })} className="ms-auto text-sm text-primary hover:underline">{t("modes.reset")}</button></div>
    {colors.length > 1 && <div className="flex flex-wrap gap-2" aria-label={t("color")}>{colors.map((color) => <button key={color.id} type="button" title={color.label} aria-label={color.label} aria-pressed={color.id === colorId} onClick={() => setColorId(color.id)} className={`size-7 rounded-full border-2 ${color.id === colorId ? "border-text" : "border-border"}`} style={{ backgroundColor: color.hex }} />)}</div>}
    <div ref={hostRef} className="relative h-[330px] touch-none overflow-hidden rounded-xl border border-border bg-[#f6f7f7]" onPointerDown={(event) => {
      if (!supported) return; const result = pointFromPointer(event); if (!result) return;
      draggingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId);
      const mesh = meshRef.current; const local = mesh?.worldToLocal(result.point.clone());
      if (local) workerRef.current?.postMessage({ type: "grab", index: result.index, target: [local.x, local.y, local.z] });
    }} onPointerMove={movePointer} onPointerUp={() => { draggingRef.current = false; workerRef.current?.postMessage({ type: "release" }); }} onPointerCancel={() => { draggingRef.current = false; workerRef.current?.postMessage({ type: "release" }); }}>
      {supported !== true && <div className="absolute inset-0 z-10 grid place-items-center bg-surface/90 p-6 text-center text-sm text-text-muted">{supported === false ? t("unsupported") : t("loading")}</div>}
    </div>
    <p className="text-sm text-text-muted">{mode === "hang" ? t("strain", { value: strain.toFixed(0), limit: stretchLimitPct === null ? "—" : `${stretchLimitPct}%` }) : mode === "wind" ? t("windSummary", { gsm, air: feel.breathability.toFixed(1) }) : t("drapeSummary", { drape: feel.drape.toFixed(1) })}</p>
  </section>;
}
