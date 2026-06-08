#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(arg, next);
    i += 1;
  } else {
    args.set(arg, "true");
  }
}

const northstarRoot = resolve(args.get("--northstar-root") ?? process.env.NORTHSTAR_ROOT ?? join(root, "..", "northstar"));
const outDir = resolve(args.get("--out") ?? join(root, "dist", "northstar-suite"));
const build = args.get("--build") === "true";
const workBaseDir = resolve(args.get("--work") ?? join(root, "dist", ".northstar-suite-work"));
const workDir = join(workBaseDir, `run-${Date.now()}`);
const suiteHomeDir = join(workBaseDir, "home");
const suiteCacheDir = join(workBaseDir, "npm-cache");
const packagesDir = join(outDir, "packages");

if (!existsSync(join(northstarRoot, "package.json"))) {
  throw new Error(`Northstar package.json not found at ${northstarRoot}`);
}

if (build) {
  run("npm", ["run", "build"], root);
}
if (!existsSync(join(root, ".next"))) {
  throw new Error("pi-web .next build artifacts are missing. Run npm run build first, or rerun this script with --build.");
}

rmSync(outDir, { recursive: true, force: true });
rmSync(workBaseDir, { recursive: true, force: true });
mkdirSync(packagesDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

const northstarPackageRoot = prepareNorthstarPackageRoot();
const northstarTgz = npmPack(northstarPackageRoot, packagesDir);
const piWebTgz = packPiWebSuitePackage();

writeInstallerScripts(northstarTgz, piWebTgz);
writeReadme(northstarTgz, piWebTgz);
rmSync(workBaseDir, { recursive: true, force: true });

console.log(JSON.stringify({
  outDir,
  package: join(packagesDir, piWebTgz),
  install: {
    windows: join(outDir, "install.ps1"),
    unix: join(outDir, "install.sh"),
  },
}, null, 2));

function packPiWebSuitePackage() {
  const packageRoot = join(workDir, "pi-web");
  mkdirSync(packageRoot, { recursive: true });

  for (const name of ["bin", ".next", "public"]) {
    const source = join(root, name);
    if (existsSync(source)) cpSync(source, join(packageRoot, name), { recursive: true });
  }
  for (const name of ["next.config.ts", "package.json"]) {
    cpSync(join(root, name), join(packageRoot, name));
  }

  const pkgPath = join(packageRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  delete pkg.dependencies?.["@northstar/runtime"];
  pkg.scripts = {
    start: pkg.scripts?.start,
  };
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  return npmPack(packageRoot, packagesDir);
}

function prepareNorthstarPackageRoot() {
  const packageRoot = join(workDir, "northstar-runtime");
  cpSync(northstarRoot, packageRoot, {
    recursive: true,
    filter(source) {
      const relative = source.slice(northstarRoot.length).replaceAll("\\", "/");
      if (!relative) return true;
      return ![
        "/.git",
        "/.remember",
        "/.worktrees",
        "/coverage",
        "/node_modules",
      ].some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`));
    },
  });
  return packageRoot;
}

function npmPack(cwd, destination) {
  const before = new Set(readdirSync(destination).filter((name) => name.endsWith(".tgz")));
  const output = run("npm", ["pack", "--json", "--pack-destination", destination], cwd);
  if (output) {
    const parsed = JSON.parse(output);
    const filename = parsed[0]?.filename;
    if (filename) return basename(filename);
  }
  const created = readdirSync(destination)
    .filter((name) => name.endsWith(".tgz") && !before.has(name))
    .map((name) => ({ name, mtimeMs: statSync(join(destination, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (created[0]?.name) return created[0].name;
  throw new Error(`Unable to locate npm pack output from ${cwd}`);
}

function writeInstallerScripts(northstarTgz, piWebTgz) {
  const ps1 = `$ErrorActionPreference = "Stop"
$RuntimePackage = Join-Path $PSScriptRoot "packages\\${northstarTgz}"
$WebPackage = Join-Path $PSScriptRoot "packages\\${piWebTgz}"
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm was not found. Install Node.js 22.22.2 or newer, then rerun this script."
}
npm install -g --no-audit --no-fund $RuntimePackage
npm install -g --no-audit --no-fund $WebPackage
Write-Host "Installed Northstar Pi Web."
Write-Host "Run: pi-web"
`;
  writeFileSync(join(outDir, "install.ps1"), ps1);

  const sh = `#!/usr/bin/env sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js 22.22.2 or newer, then rerun this script." >&2
  exit 1
fi
npm install -g --no-audit --no-fund "$SCRIPT_DIR/packages/${northstarTgz}"
npm install -g --no-audit --no-fund "$SCRIPT_DIR/packages/${piWebTgz}"
echo "Installed Northstar Pi Web."
echo "Run: pi-web"
`;
  const shPath = join(outDir, "install.sh");
  writeFileSync(shPath, sh, { mode: 0o755 });
}

function writeReadme(northstarTgz, piWebTgz) {
  writeFileSync(join(outDir, "README.md"), `# Northstar Pi Web Suite

This folder contains cross-platform npm installer packages for pi-web and
@northstar/runtime.

## Windows

\`\`\`powershell
Set-ExecutionPolicy -Scope Process Bypass
.\\install.ps1
pi-web
\`\`\`

## macOS / Linux

\`\`\`sh
./install.sh
pi-web
\`\`\`

Installed package:

- packages/${northstarTgz}
- packages/${piWebTgz}

Requires Node.js 22.22.2 or newer and network access to resolve npm dependencies
that are not already present in the npm cache. A fully offline installer needs a
separate bundled dependency cache.
`);
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: {
      ...process.env,
      HOME: process.env.NORTHSTAR_SUITE_HOME ?? suiteHomeDir,
      npm_config_cache: process.env.npm_config_cache ?? suiteCacheDir,
      NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE ?? suiteCacheDir,
    },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed in ${cwd}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}
