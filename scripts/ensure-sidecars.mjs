#!/usr/bin/env node
// scripts/ensure-sidecars.mjs
// Assures that verified static FFmpeg and FFprobe sidecars are ready before dev/build.
// If valid native binaries already exist, exits in <15ms.
// If missing or stubs, auto-provisions and cryptographically verifies them.

import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");

function hostTarget() {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null;
  if (!arch) return null;
  if (process.platform === "darwin") return `${arch}-apple-darwin`;
  if (process.platform === "linux") return `${arch}-unknown-linux-gnu`;
  if (process.platform === "win32") return `${arch}-pc-windows-msvc`;
  return null;
}

const target = hostTarget();
if (!target) {
  console.warn(`[SidecarAssurance] Unknown host platform (${process.platform} ${process.arch}). Skipping check.`);
  process.exit(0);
}

const extension = target.includes("windows") ? ".exe" : "";
const expectedMagic = target.includes("windows") ? "4d5a" : target.includes("linux") ? "7f454c46" : null;
const binaries = ["ffmpeg", "ffprobe"];

async function checkBinary(binary) {
  const path = resolve(rootDir, "src-tauri", "bin", `${binary}-${target}${extension}`);
  try {
    const handle = await open(path, "r");
    const header = Buffer.alloc(4);
    try {
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    const { size } = await stat(path);

    if (size < 1_000_000) {
      return false; // text stub or truncated
    }

    const magic = header.toString("hex");
    if (expectedMagic && !magic.startsWith(expectedMagic)) {
      return false;
    }
    if (target.includes("apple-darwin") && !isMachO(magic)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isMachO(magic) {
  return new Set(["feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca"]).has(magic);
}

let allValid = true;
for (const binary of binaries) {
  const valid = await checkBinary(binary);
  if (!valid) {
    allValid = false;
    break;
  }
}

if (allValid) {
  console.log(`[SidecarAssurance] Verified static media runtime (${target}) is ready.`);
  process.exit(0);
}

console.log(`[SidecarAssurance] Verified static sidecars missing or stub detected for ${target}. Auto-provisioning...`);

let result;
if (process.platform === "win32") {
  // Try pwsh first, then powershell
  result = spawnSync("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", "scripts/setup-sidecars.ps1", "-Target", target, "-Force"], {
    cwd: rootDir,
    stdio: "inherit",
  });
} else {
  result = spawnSync("bash", ["scripts/setup-sidecars.sh", "--target", target, "--force"], {
    cwd: rootDir,
    stdio: "inherit",
  });
}

if (result.status !== 0) {
  console.error(`[SidecarAssurance] Failed to auto-provision verified sidecars (exit code ${result.status}).`);
  process.exit(result.status ?? 1);
}

console.log(`[SidecarAssurance] Successfully provisioned verified static media runtime for ${target}.`);
