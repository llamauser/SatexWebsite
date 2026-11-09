"use client";

import { Html, MapControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from "react";
import * as THREE from "three";
import {
  CAMERA, FLOOR_D, FLOOR_HEIGHT, FLOOR_W, baseZoom, centerOf, clampTarget, departmentStock, floorY, isVisibleFloor, rollsFor,
  type FloorMode, type ShowroomData, type ShowroomDepartment,
} from "@/lib/showroom/model";

type V3 = [number, number, number];
interface Item { p: V3; s: V3; c: string }

/** Many boxes in one draw call. */
function Boxes({ items, shadow = true, opacity = 1 }: { items: Item[]; shadow?: boolean; opacity?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.scale.set(...it.s);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, color.set(it.c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [items, invalidate]);
  if (items.length === 0) return null;
  return (
    <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} castShadow={shadow} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.85} transparent={opacity < 1} opacity={opacity} />
    </instancedMesh>
  );
}

/** Fabric rolls (cylinders lying along x) in one draw call. */
function Rolls({ items }: { items: { p: V3; len: number; c: string }[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const color = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.rotation.set(0, 0, Math.PI / 2);
      o.scale.set(1, it.len, 1);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, color.set(it.c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [items, invalidate]);
  if (items.length === 0) return null;
  return (
    <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} castShadow>
      <cylinderGeometry args={[0.28, 0.28, 1, 14]} />
      <meshStandardMaterial roughness={0.7} />
    </instancedMesh>
  );
}

// ------------------------------------------------------------------ what stands inside a department (all local coordinates, origin = the middle of the zone)
function hallItems(dep: ShowroomDepartment, topColors: string[], totalM: number) {
  const l = dep.layout;
  const racks = Math.max(1, l.racks);
  const rackW = Math.min(2.4, (l.w - 1) / racks - 0.4);
  const boxes: Item[] = [];
  const rolls: { p: V3; len: number; c: string }[] = [];
  const colors = topColors.length > 0 ? topColors : ["#B8C2CC"];
  const total = rollsFor(totalM);
  let placed = 0;
  for (let r = 0; r < racks; r++) {
    const x = -l.w / 2 + 0.7 + ((r + 0.5) * (l.w - 1.4)) / racks;
    const z = -l.d / 2 + 1.2;
    boxes.push({ p: [x, 1.1, z], s: [rackW + 0.2, 0.08, 0.9], c: "#8A94A0" }, { p: [x, 2.2, z], s: [rackW + 0.2, 0.08, 0.9], c: "#8A94A0" });
    boxes.push({ p: [x - rackW / 2 - 0.05, 1.1, z], s: [0.08, 2.2, 0.9], c: "#6C7683" }, { p: [x + rackW / 2 + 0.05, 1.1, z], s: [0.08, 2.2, 0.9], c: "#6C7683" });
    for (const level of [0.4, 1.5]) {
      // rolls on this shelf, shared out between the racks (at most 12 for the whole department)
      const here = Math.max(0, Math.min(3, Math.ceil((total - placed) / Math.max(1, racks * 2 - (r * 2 + (level > 1 ? 1 : 0))))));
      for (let k = 0; k < here; k++) {
        rolls.push({ p: [x - rackW / 2 + 0.3 + k * ((rackW - 0.4) / 2), level + 0.32, z], len: 0.75, c: colors[(placed + k) % colors.length]! });
      }
      placed += here;
    }
  }
  // two stacks of rolls on the floor, bigger when the stock is bigger
  const floorStacks = Math.min(2, Math.floor(total / 4));
  for (let s = 0; s < floorStacks; s++) for (let k = 0; k < 3; k++) rolls.push({ p: [-l.w / 2 + 2 + s * 2.2, 0.3 + (k > 1 ? 0.5 : 0), l.d / 2 - 1.6 + (k % 2) * 0.55], len: 0.8, c: colors[(s + k) % colors.length]! });
  return { boxes, rolls };
}

function otherItems(dep: ShowroomDepartment): Item[] {
  const l = dep.layout;
  switch (dep.kind) {
    case "cutting":
      return [
        { p: [0, 0.55, -l.d / 4], s: [Math.min(4.2, l.w - 1), 1.0, 1.7], c: "#C9D3DC" }, { p: [0, 0.55, l.d / 4], s: [Math.min(4.2, l.w - 1), 1.0, 1.7], c: "#C9D3DC" },
        { p: [-l.w / 2 + 0.7, 0.9, l.d / 2 - 1], s: [0.7, 1.8, 0.7], c: "#5E9AAE" },
      ];
    case "shipping":
      return [
        { p: [-1.2, 0.5, -l.d / 4], s: [1.6, 1, 1.4], c: "#D9B38C" }, { p: [-1.2, 1.5, -l.d / 4], s: [1.3, 1, 1.2], c: "#C99F74" }, { p: [1.1, 0.5, -l.d / 4], s: [1.5, 1, 1.4], c: "#D9B38C" },
        { p: [0, 0.35, l.d / 4], s: [1.4, 0.7, 2.2], c: "#F2B84B" }, { p: [0, 1.3, l.d / 4 - 0.8], s: [0.15, 2.2, 0.15], c: "#6C7683" }, // a forklift: body and mast
      ];
    case "studio":
      return [
        { p: [-l.w / 4, 0.55, 0], s: [3.6, 0.9, 1.4], c: "#E3D2B4" }, { p: [l.w / 4, 0.55, 0], s: [3.6, 0.9, 1.4], c: "#E3D2B4" },
        { p: [0, 1.0, l.d / 2 - 1], s: [0.6, 2, 0.6], c: "#C9A7C2" }, { p: [2, 1.0, l.d / 2 - 1], s: [0.6, 2, 0.6], c: "#A7C2C9" },
      ];
    case "client_suite":
      return [
        { p: [0, 0.55, 0], s: [4.2, 0.9, 2], c: "#BFD8C8" },
        ...[-1.8, 0, 1.8].flatMap((x) => [{ p: [x, 0.4, -1.5] as V3, s: [0.8, 0.8, 0.8] as V3, c: "#7FAF93" }, { p: [x, 0.4, 1.5] as V3, s: [0.8, 0.8, 0.8] as V3, c: "#7FAF93" }]),
        { p: [l.w / 2 - 1, 0.8, l.d / 2 - 1], s: [0.7, 1.6, 0.7], c: "#4F8F5A" },
      ];
    case "office":
      return [-l.w / 4, l.w / 4].flatMap((x) => [
        { p: [x, 0.55, -1.2] as V3, s: [2.6, 0.9, 1.2] as V3, c: "#C9CDD2" }, { p: [x, 0.55, 1.6] as V3, s: [2.6, 0.9, 1.2] as V3, c: "#C9CDD2" },
      ]);
    default:
      return [];
  }
}

// ------------------------------------------------------------------ one department
function Zone({ dep, label, data, selected, hovered, dimmed, onSelect, onHover }: {
  dep: ShowroomDepartment; label: string; data: ShowroomData; selected: boolean; hovered: boolean; dimmed: boolean; onSelect: (slug: string) => void; onHover: (slug: string | null) => void;
}) {
  const l = dep.layout;
  const y = floorY(dep.floor) + (dep.floor === 1 ? 0.15 : 0);
  const stock = useMemo(() => (dep.kind === "fabric_hall" ? departmentStock(dep, data.availability) : null), [dep, data.availability]);
  const parts = useMemo(() => (stock ? hallItems(dep, stock.topColors, stock.totalM) : { boxes: otherItems(dep), rolls: [] }), [dep, stock]);
  const active = selected || hovered;
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (dimmed || e.delta > 4) return; // a drag (panning) is not a click
    e.stopPropagation();
    onSelect(dep.slug);
  };
  const edge = (w: number, d: number, x: number, z: number) => (
    <mesh key={`${x}${z}`} position={[x, 0.16, z]}><boxGeometry args={[w, 0.06, d]} /><meshBasicMaterial color={selected ? "#1F6FEB" : "#1B2430"} /></mesh>
  );
  return (
    <group position={[l.x + l.w / 2, y, l.z + l.d / 2]}>
      <mesh position={[0, 0.06, 0]} receiveShadow
        onPointerOver={(e) => { if (dimmed) return; e.stopPropagation(); onHover(dep.slug); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = ""; }} onClick={click}>
        <boxGeometry args={[l.w, 0.12, l.d]} />
        <meshStandardMaterial color={l.color} emissive={l.color} emissiveIntensity={selected ? 0.55 : hovered ? 0.3 : 0.05} transparent={dimmed} opacity={dimmed ? 0.3 : 1} roughness={0.9} />
      </mesh>
      {active && !dimmed && [edge(l.w, 0.12, 0, -l.d / 2), edge(l.w, 0.12, 0, l.d / 2), edge(0.12, l.d, -l.w / 2, 0), edge(0.12, l.d, l.w / 2, 0)]}
      {!dimmed && <Boxes items={parts.boxes} />}
      {!dimmed && <Rolls items={parts.rolls} />}
      {active && !dimmed && (
        <Html center position={[0, 3.6, 0]} style={{ pointerEvents: "none" }} zIndexRange={[10, 0]}>
          <div className="whitespace-nowrap rounded-full bg-text px-3 py-1 text-xs font-semibold text-white shadow-card" data-testid="scene-label">{label}</div>
        </Html>
      )}
    </group>
  );
}

// ------------------------------------------------------------------ the building around them
function Shell({ mode }: { mode: FloorMode }) {
  const upper = isVisibleFloor(mode, 1);
  const posts: Item[] = [[1, 15.5], [39, 15.5], [1, 23], [39, 23], [20, 15.5], [20, 23]].map(([x, z]) => ({ p: [x!, FLOOR_HEIGHT / 2, z!], s: [0.35, FLOOR_HEIGHT, 0.35], c: "#B7C0CC" }));
  const steps: Item[] = Array.from({ length: 8 }, (_, i) => ({ p: [1.2, 0.25 + i * 0.5, 14.6 - i * 0.55], s: [1.6, 0.5 + i * 0.5, 0.55], c: "#CBD3DC" }));
  const path: Item[] = [
    { p: [16, 0.03, 9], s: [30, 0.02, 0.25], c: "#4DA3FF" }, { p: [31, 0.03, 10], s: [0.25, 0.02, 20], c: "#4DA3FF" }, { p: [1.2, 0.03, 12], s: [0.25, 0.02, 6], c: "#4DA3FF" },
  ];
  return (
    <group>
      <mesh position={[FLOOR_W / 2, -0.2, FLOOR_D / 2]} receiveShadow><boxGeometry args={[FLOOR_W + 1, 0.4, FLOOR_D + 1]} /><meshStandardMaterial color="#F7F9FB" roughness={1} /></mesh>
      <mesh position={[FLOOR_W / 2, 1.2, FLOOR_D + 0.15]} castShadow><boxGeometry args={[FLOOR_W + 0.6, 2.4, 0.3]} /><meshStandardMaterial color="#DDE3EA" /></mesh>
      <mesh position={[-0.15, 1.2, FLOOR_D / 2]} castShadow><boxGeometry args={[0.3, 2.4, FLOOR_D]} /><meshStandardMaterial color="#DDE3EA" /></mesh>
      <Boxes items={path} shadow={false} />
      <Boxes items={steps} />
      {upper && (
        <group>
          <mesh position={[FLOOR_W / 2, FLOOR_HEIGHT - 0.0, 19.6]} receiveShadow castShadow><boxGeometry args={[FLOOR_W, 0.3, 9.6]} /><meshStandardMaterial color="#EDF1F5" transparent opacity={mode === "both" ? 0.92 : 1} /></mesh>
          <Boxes items={posts} />
        </group>
      )}
      <Html position={[3, 3.2, -0.4]} center style={{ pointerEvents: "none" }} zIndexRange={[5, 0]}>
        <div className="rounded-sm bg-primary px-3 py-1 font-display text-sm font-bold tracking-widest text-white shadow-card">SATEX</div>
      </Html>
    </group>
  );
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

function Scene({ data, selected, hovered, floor, labels, onSelect, onHover }: Props) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<ComponentRef<typeof MapControls>>(null);
  const light = useRef<THREE.DirectionalLight>(null);
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
      <ambientLight intensity={0.95} />
      <directionalLight ref={light} position={[CAMERA.target[0] + 18, 44, CAMERA.target[2] - 20]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-34} shadow-camera-right={34} shadow-camera-top={34} shadow-camera-bottom={-34} shadow-camera-near={1} shadow-camera-far={120} />
      <Shell mode={floor} />
      {data.departments.filter((d) => d.floor === 0 || isVisibleFloor(floor, 1)).map((d) => (
        <Zone key={d.id} dep={d} label={labels[d.slug] ?? d.slug} data={data} selected={selected === d.slug} hovered={hovered === d.slug}
          dimmed={d.floor === 0 && !isVisibleFloor(floor, 0)} onSelect={onSelect} onHover={onHover} />
      ))}
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
  labels: Record<string, string>;
  ariaLabel: string;
  onSelect: (slug: string) => void;
  onHover: (slug: string | null) => void;
}

/** The 3D showroom: an isometric, stylized two-floor building generated from the departments' layouts. Loaded on demand only. */
export default function Scene3D(props: Props) {
  return (
    <Canvas orthographic shadows dpr={[1, 1.5]} frameloop="demand" camera={{ position: [...CAMERA.position], zoom: 14, near: -200, far: 400 }} gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#E9EEF3")} aria-label={props.ariaLabel} role="img">
      <Scene {...props} />
    </Canvas>
  );
}
