"use client";

import { Environment, MapControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import {
  CAMERA, FLOOR_D, FLOOR_W, baseZoom, centerOf, clampTarget, departmentStock, floorY, isVisibleFloor,
  type FloorMode, type ShowroomData, type ShowroomDepartment,
} from "@/lib/showroom/model";
import { departmentPlacements, type Placement } from "@/lib/showroom/placements";

type V3 = [number, number, number];

// Modelled in Blender (scripts/showroom): the building, and a library of objects the departments are furnished with.
const SHELL_URL = "/showroom/shell.glb";
const PROPS_URL = "/showroom/props.glb";
const ENV_URL = "/showroom/env.hdr";
// no draco / meshopt decoders: the files do not use them, and WebAssembly is not allowed by the Content-Security-Policy
useGLTF.preload(SHELL_URL, false, false);
useGLTF.preload(PROPS_URL, false, false);

// ------------------------------------------------------------------ the prop library
interface Part { geometry: THREE.BufferGeometry; material: THREE.Material; rel: THREE.Matrix4; tint: boolean }
type Library = Map<string, Part[]>;

/** Every `prop_<name>` of props.glb as the meshes it is made of, with the transform of each inside its prop (the exporter may have quantized it into the node). */
function useLibrary(): Library {
  const { scene } = useGLTF(PROPS_URL, false, false);
  return useMemo(() => {
    scene.updateMatrixWorld(true);
    const lib: Library = new Map();
    scene.traverse((root) => {
      if (!root.name.startsWith("prop_")) return;
      const inverse = root.matrixWorld.clone().invert();
      const parts: Part[] = [];
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const material = o.material as THREE.Material;
          parts.push({ geometry: o.geometry, material, rel: inverse.clone().multiply(o.matrixWorld), tint: material.name === "roll_fabric" });
        }
      });
      lib.set(root.name.slice(5), parts);
    });
    return lib;
  }, [scene]);
}

/** One mesh of a prop, drawn once for every place the prop stands (one draw call). */
function PartInstances({ part, items }: { part: Part; items: Placement[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(it.x, it.y ?? 0, it.z);
      o.rotation.set(0, it.ry ?? 0, 0);
      if (Array.isArray(it.s)) o.scale.set(...it.s);
      else o.scale.setScalar(it.s ?? 1);
      o.updateMatrix();
      mesh.setMatrixAt(i, m.multiplyMatrices(o.matrix, part.rel));
      if (part.tint) mesh.setColorAt(i, color.set(it.color ?? "#ffffff"));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [items, part, invalidate]);
  if (items.length === 0) return null;
  const glass = part.material.transparent;
  return <instancedMesh key={items.length} ref={ref} args={[part.geometry, part.material, items.length]} castShadow={!glass} receiveShadow frustumCulled={false} />;
}

// ------------------------------------------------------------------ one department
function Zone({ dep, selected, hovered, dimmed, onSelect, onHover }: {
  dep: ShowroomDepartment; selected: boolean; hovered: boolean; dimmed: boolean; onSelect: (slug: string) => void; onHover: (slug: string | null) => void;
}) {
  const l = dep.layout;
  const y = floorY(dep.floor) + (dep.floor === 1 ? 0.15 : 0);
  const active = selected || hovered;
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (dimmed || e.delta > 4) return; // a drag (panning) is not a click
    e.stopPropagation();
    onSelect(dep.slug);
  };
  const edge = (w: number, d: number, x: number, z: number) => (
    <mesh key={`${x}${z}`} position={[x, 0.03, z]}><boxGeometry args={[w, 0.06, d]} /><meshBasicMaterial color={selected ? "#1F6FEB" : "#1B2430"} toneMapped={false} /></mesh>
  );
  return (
    <group position={[l.x + l.w / 2, y, l.z + l.d / 2]}>
      {/* the painted zone on the floor: it is what is hovered and clicked */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}
        onPointerOver={(e) => { if (dimmed) return; e.stopPropagation(); onHover(dep.slug); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = ""; }} onClick={click}>
        <planeGeometry args={[l.w, l.d]} />
        <meshBasicMaterial color={l.color} transparent opacity={dimmed ? 0.1 : selected ? 0.62 : hovered ? 0.5 : 0.3} depthWrite={false} polygonOffset polygonOffsetFactor={-2} toneMapped={false} />
      </mesh>
      {active && !dimmed && [edge(l.w, 0.12, 0, -l.d / 2), edge(l.w, 0.12, 0, l.d / 2), edge(0.12, l.d, -l.w / 2, 0), edge(0.12, l.d, l.w / 2, 0)]}
    </group>
  );
}

/** Everything standing in the visible departments, in world coordinates and grouped by prop, so each part of each prop is one draw call for the whole building. */
function useWorld(data: ShowroomData, floor: FloorMode): [string, Placement[]][] {
  return useMemo(() => {
    const byProp = new Map<string, Placement[]>();
    for (const dep of data.departments) {
      if (!isVisibleFloor(floor, dep.floor)) continue;
      const stock = dep.kind === "fabric_hall" ? departmentStock(dep, data.availability) : null;
      const placed = departmentPlacements(dep, stock);
      const ox = dep.layout.x + dep.layout.w / 2, oz = dep.layout.z + dep.layout.d / 2, oy = floorY(dep.floor) + (dep.floor === 1 ? 0.15 : 0);
      for (const p of [...placed.props, ...placed.rolls]) {
        const list = byProp.get(p.prop) ?? [];
        list.push({ ...p, x: p.x + ox, z: p.z + oz, y: (p.y ?? 0) + oy });
        byProp.set(p.prop, list);
      }
    }
    return [...byProp];
  }, [data, floor]);
}

// ------------------------------------------------------------------ the building around them
function Shell({ mode }: { mode: FloorMode }) {
  const { scene } = useGLTF(SHELL_URL, false, false);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const material = o.material as THREE.MeshStandardMaterial;
      o.castShadow = !material.transparent;
      o.receiveShadow = true;
      if (material.map) material.map.anisotropy = 8;
    });
  }, [scene]);
  useLayoutEffect(() => {
    const mezzanine = scene.getObjectByName("mezzanine");
    if (mezzanine) mezzanine.visible = isVisibleFloor(mode, 1);
    invalidate();
  }, [scene, mode, invalidate]);
  return <primitive object={scene} />;
}

// ------------------------------------------------------------------ camera: easing towards the chosen department, limits on panning
function Rig({ selected, departments, controls, zoom0 }: { selected: string | null; departments: ShowroomDepartment[]; controls: React.RefObject<ComponentRef<typeof MapControls> | null>; zoom0: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const goal = useRef<{ target: THREE.Vector3; zoom: number; until: number } | null>(null);
  useEffect(() => {
    const dep = departments.find((d) => d.slug === selected);
    const c = dep ? centerOf(dep.layout) : { x: FLOOR_W / 2, z: FLOOR_D / 2 };
    goal.current = { target: new THREE.Vector3(c.x, dep ? floorY(dep.floor) : 0, c.z), zoom: dep ? zoom0 * 1.45 : zoom0, until: performance.now() + 900 };
    invalidate();
  }, [selected, departments, zoom0, invalidate]);
  useFrame((state, dt) => {
    const ctl = controls.current;
    if (!ctl) return;
    const g = goal.current;
    if (g) {
      const k = 1 - Math.exp(-dt * 9);
      const delta = g.target.clone().sub(ctl.target).multiplyScalar(k);
      ctl.target.add(delta);
      state.camera.position.add(delta); // move both, so the viewing direction stays the same
      const cam = state.camera as THREE.OrthographicCamera;
      cam.zoom += (g.zoom - cam.zoom) * k;
      cam.updateProjectionMatrix();
      if (performance.now() < g.until) state.invalidate();
      else goal.current = null;
    }
    const c = clampTarget(ctl.target.x, ctl.target.z);
    if (c.x !== ctl.target.x || c.z !== ctl.target.z) {
      const dx = c.x - ctl.target.x, dz = c.z - ctl.target.z;
      ctl.target.x += dx; ctl.target.z += dz;
      state.camera.position.x += dx; state.camera.position.z += dz;
    }
  });
  return null;
}

function Scene({ data, selected, hovered, floor, onSelect, onHover }: Props) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<ComponentRef<typeof MapControls>>(null);
  const light = useRef<THREE.DirectionalLight>(null);
  const library = useLibrary();
  const world = useWorld(data, floor);
  const zoom0 = baseZoom(size.width);
  useLayoutEffect(() => {
    // the sun looks at the middle of the building, so the shadow map covers all of it
    if (light.current) {
      light.current.target.position.set(...(CAMERA.target as unknown as V3));
      light.current.target.updateMatrixWorld();
    }
  }, []);
  useLayoutEffect(() => {
    camera.zoom = zoom0;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, zoom0, invalidate]);
  return (
    <>
      <hemisphereLight args={["#FFFFFF", "#C7CFD8", 0.5]} />
      <directionalLight ref={light} position={[CAMERA.target[0] + 18, 44, CAMERA.target[2] - 20]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-camera-left={-34} shadow-camera-right={34} shadow-camera-top={34} shadow-camera-bottom={-34} shadow-camera-near={1} shadow-camera-far={120} />
      <Suspense fallback={null}>
        <Environment files={ENV_URL} environmentIntensity={0.55} />
        <Shell mode={floor} />
        {data.departments.filter((d) => d.floor === 0 || isVisibleFloor(floor, 1)).map((d) => (
          <Zone key={d.id} dep={d} selected={selected === d.slug} hovered={hovered === d.slug}
            dimmed={d.floor === 0 && !isVisibleFloor(floor, 0)} onSelect={onSelect} onHover={onHover} />
        ))}
        {world.map(([name, items]) => library.get(name)?.map((part, i) => <PartInstances key={`${name}${i}`} part={part} items={items} />))}
      </Suspense>
      <MapControls ref={controls} makeDefault enableDamping={false} target={CAMERA.target as unknown as [number, number, number]} minPolarAngle={CAMERA.pitch} maxPolarAngle={CAMERA.pitch}
        minAzimuthAngle={CAMERA.yaw - CAMERA.yawRange} maxAzimuthAngle={CAMERA.yaw + CAMERA.yawRange} minZoom={zoom0 * 0.6} maxZoom={zoom0 * 2.2} zoomSpeed={0.8} screenSpacePanning={false} />
      <Rig selected={selected} departments={data.departments} controls={controls} zoom0={zoom0} />
    </>
  );
}

interface Props {
  data: ShowroomData;
  selected: string | null;
  hovered: string | null;
  floor: FloorMode;
  ariaLabel: string;
  onSelect: (slug: string) => void;
  onHover: (slug: string | null) => void;
}

/** The 3D showroom: an isometric, two-floor building modelled in Blender and furnished from the departments' layouts and the live stock. Loaded on demand only. */
export default function Scene3D(props: Props) {
  return (
    <Canvas orthographic shadows dpr={[1, 1.5]} frameloop="demand" camera={{ position: [...CAMERA.position], zoom: 14, near: -200, far: 400 }}
      gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.0 }}
      onCreated={({ gl }) => gl.setClearColor("#E9EEF3")} aria-label={props.ariaLabel} role="img">
      <Scene {...props} />
    </Canvas>
  );
}
