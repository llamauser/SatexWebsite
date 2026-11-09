import { CpuClothSolver, type ClothMode, type XpbdParameters } from "./solver.cpu";

type Request =
  | { type: "init"; n: number; params: XpbdParameters }
  | { type: "step"; dt: number }
  | { type: "mode"; mode: ClothMode }
  | { type: "grab"; index: number; target: [number, number, number] }
  | { type: "move"; target: [number, number, number] }
  | { type: "release" }
  | { type: "params"; params: XpbdParameters };

let solver: CpuClothSolver | null = null;
let accumulator = 0;
const workerScope = globalThis as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (message: unknown, transfer?: Transferable[]) => void };
workerScope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") { solver = new CpuClothSolver(message.n, message.params); accumulator = 0; workerScope.postMessage({ type: "ready", n: solver.n }); return; }
  if (!solver) return;
  if (message.type === "mode") { solver.reset(message.mode); return; }
  if (message.type === "grab") { solver.grab(message.index, message.target); return; }
  if (message.type === "move") { solver.moveGrab(message.target); return; }
  if (message.type === "release") { solver.release(); return; }
  if (message.type === "params") { solver.setParams(message.params); return; }
  accumulator += Math.max(0, Math.min(0.1, message.dt));
  let steps = 0;
  while (accumulator >= 1 / 60 && steps < 4) { solver.step(1 / 60); accumulator -= 1 / 60; steps++; }
  const positions = solver.positions.slice();
  workerScope.postMessage({ type: "frame", positions, strainPct: solver.strainPct }, [positions.buffer]);
};
