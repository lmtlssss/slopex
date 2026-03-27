#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const packagePath = path.join(process.cwd(), "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const published = process.env.PUBLISHED_VERSION || "";

function parse(version) {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

function compare(leftVersion, rightVersion) {
  const left = parse(leftVersion);
  const right = parse(rightVersion);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const leftPart = left[i] || 0;
    const rightPart = right[i] || 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }
  return 0;
}

function bumpPatch(version) {
  const next = parse(version);
  while (next.length < 3) {
    next.push(0);
  }
  next[2] += 1;
  return next.slice(0, 3).join(".");
}

let nextVersion = pkg.version;
if (published && compare(pkg.version, published) <= 0) {
  nextVersion = bumpPatch(published);
}

pkg.version = nextVersion;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");

if (process.argv.includes("--github-output")) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is not set.");
  }
  fs.appendFileSync(outputPath, `next=${nextVersion}\n`);
} else {
  process.stdout.write(`${nextVersion}\n`);
}
