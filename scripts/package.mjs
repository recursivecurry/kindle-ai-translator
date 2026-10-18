import { readFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const { name, version } = JSON.parse(await readFile("package.json", "utf8"));
const archive = resolve(`artifacts/${name}-${version}.zip`);
await mkdir("artifacts", { recursive: true });
await rm(archive, { force: true });
execFileSync("zip", ["-qr", archive, "."], { cwd: "dist" });
console.log(archive);
