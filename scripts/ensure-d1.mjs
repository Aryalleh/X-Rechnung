#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DB_NAME = "x-rechnung";
const CONFIG = "wrangler.jsonc";

function runWrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
}

function parseJson(output) {
  // Wrangler can emit informational lines before JSON. Find the first JSON
  // object/array and parse from there.
  const firstObject = output.indexOf("{");
  const firstArray = output.indexOf("[");
  const start =
    firstObject === -1 ? firstArray :
    firstArray === -1 ? firstObject :
    Math.min(firstObject, firstArray);

  if (start === -1) throw new Error("Wrangler returned no JSON output.");
  return JSON.parse(output.slice(start));
}

function getDatabaseId() {
  const result = parseJson(runWrangler(["d1", "list", "--json"]));
  const databases = Array.isArray(result)
    ? result
    : result.result ?? result.databases ?? [];

  const db = databases.find((item) =>
    item.name === DB_NAME || item.database_name === DB_NAME
  );

  return db?.uuid ?? db?.database_id ?? db?.id ?? null;
}

function setDatabaseId(databaseId) {
  let config = readFileSync(CONFIG, "utf8");

  const pattern =
    /(\"binding\"\s*:\s*\"DB\"[\s\S]*?\"database_name\"\s*:\s*\"x-rechnung\"[\s\S]*?\"database_id\"\s*:\s*)\"[^\"]*\"/;

  if (!pattern.test(config)) {
    throw new Error(
      "Could not find the DB/x-rechnung database_id entry in wrangler.jsonc."
    );
  }

  config = config.replace(pattern, `$1"${databaseId}"`);
  writeFileSync(CONFIG, config);
}

function ensureDatabase() {
  let databaseId = getDatabaseId();

  if (!databaseId) {
    console.log(`[d1] Database "${DB_NAME}" not found. Creating it in Western Europe...`);

    try {
      runWrangler([
        "d1",
        "create",
        DB_NAME,
        "--location=weur",
        "--update-config",
        "--binding",
        "DB",
      ]);
    } catch (error) {
      // Another build may have created it between list/create. Re-list before
      // failing so parallel CI builds remain safe.
      databaseId = getDatabaseId();
      if (!databaseId) throw error;
    }

    databaseId ??= getDatabaseId();
  }

  if (!databaseId) {
    throw new Error(`Unable to determine D1 database ID for "${DB_NAME}".`);
  }

  setDatabaseId(databaseId);
  console.log(`[d1] Using "${DB_NAME}" (${databaseId}).`);

  return databaseId;
}

const isWorkersBuild = process.env.WORKERS_CI === "1";
const force = process.env.AUTO_CREATE_D1 === "1";

if (!isWorkersBuild && !force) {
  console.log("[d1] Local build: skipping remote D1 provisioning.");
  process.exit(0);
}

ensureDatabase();

console.log("[d1] Applying pending remote migrations...");
execFileSync(
  "npx",
  ["wrangler", "d1", "migrations", "apply", "DB", "--remote"],
  { stdio: "inherit", env: process.env }
);

console.log("[d1] Provisioning and migrations complete.");
