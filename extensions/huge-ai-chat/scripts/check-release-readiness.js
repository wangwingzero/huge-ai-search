#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

function fail(message) {
  console.error(`[release-check] ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`[release-check] ${message}`);
}

function isValidPublisherId(value) {
  // VS Marketplace publisher id is effectively slug-like.
  return /^[a-z0-9][a-z0-9-]{1,63}$/i.test(value);
}

function main() {
  const requireSecrets = process.argv.includes("--require-secrets");
  const requireVsce = process.argv.includes("--require-vsce");
  const packagePath = path.resolve(process.cwd(), "package.json");

  if (!fs.existsSync(packagePath)) {
    fail(`package.json not found at ${packagePath}`);
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch (error) {
    fail(`Failed to parse package.json: ${error.message}`);
  }

  const publisher = typeof pkg.publisher === "string" ? pkg.publisher.trim() : "";
  if (!publisher) {
    fail("Missing required field: package.json -> publisher");
  }
  if (!isValidPublisherId(publisher)) {
    fail(
      `Invalid publisher id "${publisher}". Use letters/numbers/hyphen, and start with letter/number.`
    );
  }
  info(`publisher ok: ${publisher}`);

  if (!requireSecrets) {
    info("secrets check skipped (use --require-secrets to enable)");
    return;
  }

  const missing = [];
  const needsVsce = requireSecrets || requireVsce;
  if (needsVsce && (!process.env.VSCE_PAT || process.env.VSCE_PAT.trim().length === 0)) {
    missing.push("VSCE_PAT");
  }

  if (missing.length > 0) {
    fail(
      `Missing required secrets: ${missing.join(", ")}. ` +
        "Set them in GitHub repo Settings -> Secrets and variables -> Actions."
    );
  }

  if (needsVsce) {
    info("publish secret ok: VSCE_PAT");
  } else {
    info("no specific secret requirement requested");
  }
}

main();
