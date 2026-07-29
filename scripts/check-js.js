"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const targets = [
  path.join(root, "server.js"),
  path.join(root, "public"),
  path.join(root, "scripts"),
  path.join(root, "test-support"),
  path.join(root, "tests")
];

function collect(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return target.endsWith(".js") ? [target] : [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    return collect(path.join(target, entry.name));
  });
}

const files = targets.flatMap(collect);
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`\n[문법 오류] ${path.relative(root, file)}\n`);
    process.stderr.write(result.stderr || result.stdout || "");
  }
}

if (failed) process.exit(1);
process.stdout.write(`${files.length}개 JavaScript 파일 문법 검사를 통과했습니다.\n`);
