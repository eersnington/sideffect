import { readFileSync } from "node:fs";

const version = process.argv[2];

if (version === undefined) {
  throw new Error("Usage: generate-release-notes.mjs <version>");
}

const packages = [
  ["sideffect", "packages/sideffect/CHANGELOG.md"],
  ["@sideffect/lint", "packages/lint-plugin/CHANGELOG.md"],
];

const extractVersion = (changelog, packageName) => {
  const heading = `## ${version}`;
  const start = changelog.split("\n").findIndex((line) => line === heading);

  if (start === -1) {
    throw new Error(`${packageName} changelog has no ${version} release`);
  }

  const remaining = changelog.split("\n").slice(start + 1);
  const nextVersion = remaining.findIndex((line) => line.startsWith("## "));
  const release = remaining.slice(0, nextVersion === -1 ? undefined : nextVersion);
  const body = release.join("\n").trim();

  if (body.length === 0) {
    throw new Error(`${packageName} changelog has an empty ${version} release`);
  }

  return `## ${packageName}\n\n${body}`;
};

const notes = packages.map(([packageName, path]) =>
  extractVersion(readFileSync(path, "utf8"), packageName),
);

process.stdout.write(`${notes.join("\n\n")}\n`);
