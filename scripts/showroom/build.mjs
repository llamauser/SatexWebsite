// Rebuilds public/showroom/{shell,props}.glb from the Blender scripts in scripts/showroom/blender (needs Blender 4.2+ and the raw assets
// fetched by scripts/showroom/fetch-assets.py).
//   node scripts/showroom/build.mjs [shell|props]      BLENDER=<path to blender> to use another install
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const blender = process.env.BLENDER || "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe";
const tmp = path.join(root, ".tmp", "showroom");
mkdirSync(tmp, { recursive: true });
mkdirSync(path.join(root, "public", "showroom"), { recursive: true });

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const targets = { shell: { script: "build_shell.py", texture: "1024" }, props: { script: "build_props.py", texture: "512" } };
for (const name of process.argv[2] ? [process.argv[2]] : Object.keys(targets)) {
  const t = targets[name];
  if (!t) throw new Error(`unknown target ${name} (shell | props)`);
  const raw = path.join(tmp, `${name}.raw.glb`);
  run(blender, ["--background", "--python", path.join(root, "scripts", "showroom", "blender", t.script), "--", "--out", raw]);
  run(process.execPath, [path.join(root, "scripts", "showroom", "optimize.mjs"), raw, path.join(root, "public", "showroom", `${name}.glb`), t.texture]);
}
