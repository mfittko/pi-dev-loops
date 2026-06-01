import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEV_LOOP_GATE,
  DEV_LOOP_PUBLIC_INTENT,
  DEV_LOOP_ROUTE_KIND,
  DEV_LOOP_TARGET_KIND,
  DEV_LOOP_TARGET_PREFERENCE,
} from "../src/loop/public-dev-loop-routing-contract.mjs";

const ROUTING_MODULE_URL = new URL("../src/loop/public-dev-loop-routing.mjs", import.meta.url);

let routingModuleVersion = 0;

async function withTempRepo(fn) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "public-routing-config-"));
  try {
    await fn(repoRoot);
  } finally {
    await chmod(path.join(repoRoot, ".pi", "dev-loop", "defaults.json"), 0o644).catch(() => {});
    await rm(repoRoot, { recursive: true, force: true });
  }
}

async function writeDefaultsConfig(repoRoot, config) {
  const configDir = path.join(repoRoot, ".pi", "dev-loop");
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "defaults.json"), JSON.stringify(config));
}

async function writeRawDefaultsConfig(repoRoot, raw) {
  const configDir = path.join(repoRoot, ".pi", "dev-loop");
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "defaults.json"), raw);
}

async function loadRoutingModuleForRepo(repoRoot) {
  const priorCwd = process.cwd();
  /** @type {Error[]} */
  const warnings = [];
  const onWarning = (warning) => {
    if (warning?.code === "DEV_LOOP_ROUTING_CONFIG_FALLBACK") {
      warnings.push(warning);
    }
  };

  process.on("warning", onWarning);
  process.chdir(repoRoot);
  try {
    const version = routingModuleVersion += 1;
    const routing = await import(`${ROUTING_MODULE_URL.href}?config-test=${version}`);
    await new Promise((resolve) => setImmediate(resolve));
    return { routing, warnings };
  } finally {
    process.chdir(priorCwd);
    process.off("warning", onWarning);
  }
}

function evaluateStartOnIssue(routing, overrides = {}) {
  return routing.evaluatePublicDevLoopRouting({
    intent: DEV_LOOP_PUBLIC_INTENT.START_ON_ISSUE,
    target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42 },
    ...overrides,
  });
}

test("config strategy.default=local-first routes start_on_issue through the local path when no explicit targetPreference is provided", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeDefaultsConfig(repoRoot, {
      version: 1,
      strategy: { default: "local-first" },
    });

    const { routing } = await loadRoutingModuleForRepo(repoRoot);
    const result = evaluateStartOnIssue(routing);

    assert.equal(result.selectedGate, DEV_LOOP_GATE.LOCAL_IMPLEMENTATION);
    assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.ROUTE);
    assert.equal(result.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.LOCAL_PHASE);
  });
});

test("config strategy.default=github-first matches explicit prefer_github_first routing", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeDefaultsConfig(repoRoot, {
      version: 1,
      strategy: { default: "github-first" },
    });

    const { routing } = await loadRoutingModuleForRepo(repoRoot);
    const withConfig = evaluateStartOnIssue(routing);
    const withExplicitPreference = evaluateStartOnIssue(routing, {
      targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST,
    });

    assert.equal(withConfig.selectedGate, withExplicitPreference.selectedGate);
    assert.equal(withConfig.selectedStrategy, withExplicitPreference.selectedStrategy);
    assert.equal(withConfig.routeKind, withExplicitPreference.routeKind);
  });
});

test("explicit prefer_github_first overrides a local-first config default", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeDefaultsConfig(repoRoot, {
      version: 1,
      strategy: { default: "local-first" },
    });

    const { routing } = await loadRoutingModuleForRepo(repoRoot);
    const result = evaluateStartOnIssue(routing, {
      targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST,
    });

    assert.notEqual(result.selectedGate, DEV_LOOP_GATE.LOCAL_IMPLEMENTATION);
    assert.notEqual(result.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.LOCAL_PHASE);
  });
});

test("explicit prefer_local overrides a github-first config default", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeDefaultsConfig(repoRoot, {
      version: 1,
      strategy: { default: "github-first" },
    });

    const { routing } = await loadRoutingModuleForRepo(repoRoot);
    const result = evaluateStartOnIssue(routing, {
      targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_LOCAL,
    });

    assert.equal(result.selectedGate, DEV_LOOP_GATE.LOCAL_IMPLEMENTATION);
    assert.equal(result.canonicalState.target.kind, DEV_LOOP_TARGET_KIND.LOCAL_PHASE);
  });
});

test("missing config falls back to the built-in github-first default and emits a warning note", async () => {
  await withTempRepo(async (repoRoot) => {
    const { routing, warnings } = await loadRoutingModuleForRepo(repoRoot);
    const withFallback = evaluateStartOnIssue(routing);
    const withExplicitPreference = evaluateStartOnIssue(routing, {
      targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST,
    });

    assert.equal(withFallback.selectedGate, withExplicitPreference.selectedGate);
    assert.equal(withFallback.selectedStrategy, withExplicitPreference.selectedStrategy);
    assert.equal(withFallback.routeKind, withExplicitPreference.routeKind);
    assert.ok(warnings.some((warning) => /Committed defaults\.json not found/i.test(warning.message)));
  });
});

test("invalid config JSON falls back to the built-in github-first default without throwing", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeRawDefaultsConfig(repoRoot, "{");

    const { routing, warnings } = await loadRoutingModuleForRepo(repoRoot);
    const withFallback = evaluateStartOnIssue(routing);
    const withExplicitPreference = evaluateStartOnIssue(routing, {
      targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST,
    });

    assert.equal(withFallback.selectedGate, withExplicitPreference.selectedGate);
    assert.equal(withFallback.selectedStrategy, withExplicitPreference.selectedStrategy);
    assert.ok(warnings.some((warning) => /Invalid JSON/i.test(warning.message)));
  });
});

test("config version mismatch falls back to the built-in github-first default without throwing", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeDefaultsConfig(repoRoot, {
      version: 2,
      strategy: { default: "local-first" },
    });

    const { routing, warnings } = await loadRoutingModuleForRepo(repoRoot);
    const withFallback = evaluateStartOnIssue(routing);
    const withExplicitPreference = evaluateStartOnIssue(routing, {
      targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST,
    });

    assert.equal(withFallback.selectedGate, withExplicitPreference.selectedGate);
    assert.equal(withFallback.selectedStrategy, withExplicitPreference.selectedStrategy);
    assert.ok(warnings.some((warning) => /Schema validation failed/i.test(warning.message)));
  });
});

test("missing strategy key falls back to the built-in github-first default", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeDefaultsConfig(repoRoot, {
      version: 1,
      refinement: { fanOut: 2, mode: "parallel" },
    });

    const { routing } = await loadRoutingModuleForRepo(repoRoot);
    const withFallback = evaluateStartOnIssue(routing);
    const withExplicitPreference = evaluateStartOnIssue(routing, {
      targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST,
    });

    assert.equal(withFallback.selectedGate, withExplicitPreference.selectedGate);
    assert.equal(withFallback.selectedStrategy, withExplicitPreference.selectedStrategy);
  });
});

test("empty-string strategy.default fails closed to the built-in github-first default", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeDefaultsConfig(repoRoot, {
      version: 1,
      strategy: { default: "" },
    });

    const { routing, warnings } = await loadRoutingModuleForRepo(repoRoot);
    const withFallback = evaluateStartOnIssue(routing);
    const withExplicitPreference = evaluateStartOnIssue(routing, {
      targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST,
    });

    assert.equal(withFallback.selectedGate, withExplicitPreference.selectedGate);
    assert.equal(withFallback.selectedStrategy, withExplicitPreference.selectedStrategy);
    assert.ok(warnings.some((warning) => /Schema validation failed/i.test(warning.message)));
  });
});

test("unknown strategy.default enum falls back to the built-in github-first default", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeDefaultsConfig(repoRoot, {
      version: 1,
      strategy: { default: "tracker-first" },
    });

    const { routing, warnings } = await loadRoutingModuleForRepo(repoRoot);
    const withFallback = evaluateStartOnIssue(routing);
    const withExplicitPreference = evaluateStartOnIssue(routing, {
      targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST,
    });

    assert.equal(withFallback.selectedGate, withExplicitPreference.selectedGate);
    assert.equal(withFallback.selectedStrategy, withExplicitPreference.selectedStrategy);
    assert.ok(warnings.some((warning) => /Schema validation failed/i.test(warning.message)));
  });
});

test("unreadable config falls back to the built-in github-first default without throwing", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeDefaultsConfig(repoRoot, {
      version: 1,
      strategy: { default: "local-first" },
    });
    await chmod(path.join(repoRoot, ".pi", "dev-loop", "defaults.json"), 0o000);

    const { routing, warnings } = await loadRoutingModuleForRepo(repoRoot);
    const withFallback = evaluateStartOnIssue(routing);
    const withExplicitPreference = evaluateStartOnIssue(routing, {
      targetPreference: DEV_LOOP_TARGET_PREFERENCE.PREFER_GITHUB_FIRST,
    });

    assert.equal(withFallback.selectedGate, withExplicitPreference.selectedGate);
    assert.equal(withFallback.selectedStrategy, withExplicitPreference.selectedStrategy);
    assert.ok(warnings.some((warning) => /Cannot read config file/i.test(warning.message)));
  });
});

test("config-driven prefer_local still fails closed when authoritative linked PR state is active", async () => {
  await withTempRepo(async (repoRoot) => {
    await writeDefaultsConfig(repoRoot, {
      version: 1,
      strategy: { default: "local-first" },
    });

    const { routing } = await loadRoutingModuleForRepo(repoRoot);
    const result = evaluateStartOnIssue(routing, {
      currentState: {
        target: { kind: DEV_LOOP_TARGET_KIND.ISSUE, issue: 42, linkedPr: 88 },
        ownership: "copilot",
        nextActor: "copilot",
        status: "active",
        authorization: "needs_confirmation",
      },
    });

    assert.equal(result.selectedGate, DEV_LOOP_GATE.FAIL_CLOSED_RECONCILE);
    assert.equal(result.routeKind, DEV_LOOP_ROUTE_KIND.NEEDS_RECONCILE);
    assert.match(result.reason, /prefer_local.*conflicts with authoritative PR\/linked-PR/i);
  });
});
