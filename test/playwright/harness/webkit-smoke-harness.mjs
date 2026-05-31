import { once } from 'node:events';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

export function normalizeUiStateSegment(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-');

  if (normalized.length === 0) {
    throw new Error('UI state segment must contain at least one alphanumeric character');
  }

  return normalized;
}

function normalizeTestMatch(testMatch) {
  const normalized = (Array.isArray(testMatch) ? testMatch : [testMatch]).filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
  if (normalized.length === 0) {
    throw new Error('testMatch must include at least one non-empty spec pattern');
  }
  return normalized;
}

function requireOutputDir(outputDir) {
  if (typeof outputDir !== 'string' || outputDir.trim().length === 0) {
    throw new Error('A deterministic outputDir is required for named UI state artifacts');
  }
  return outputDir;
}

export function createWebkitSmokeConfig({ sliceId, testMatch, testDir = './test/playwright' }) {
  const normalizedSliceId = normalizeUiStateSegment(sliceId);
  return {
    testDir,
    testMatch: normalizeTestMatch(testMatch),
    timeout: 30_000,
    fullyParallel: false,
    retries: 0,
    outputDir: `test-results/ui-smoke/${normalizedSliceId}`,
    reporter: [['list'], ['html', { open: 'never', outputFolder: `playwright-report/ui-smoke/${normalizedSliceId}` }]],
    use: {
      headless: true,
      screenshot: 'only-on-failure',
      trace: 'retain-on-failure',
      video: 'off',
    },
    projects: [
      {
        name: 'webkit',
        use: {
          browserName: 'webkit',
        },
      },
    ],
  };
}

export function buildNamedUiStateArtifactPaths({ outputDir, sliceId, stateName }) {
  const normalizedSliceId = normalizeUiStateSegment(sliceId);
  const stateSlug = normalizeUiStateSegment(stateName);
  const artifactDir = path.join(requireOutputDir(outputDir), 'named-states', stateSlug);

  return {
    sliceId: normalizedSliceId,
    stateSlug,
    artifactDir,
    screenshotPath: path.join(artifactDir, 'screenshot.png'),
    statePath: path.join(artifactDir, 'state.json'),
  };
}

export async function captureNamedUiState({ page, testInfo, sliceId, stateName, metadata = {}, fullPage = true, outputDir } = {}) {
  const resolvedOutputDir = outputDir ?? testInfo?.project?.outputDir ?? testInfo?.config?.outputDir ?? testInfo?.outputDir;
  const paths = buildNamedUiStateArtifactPaths({
    outputDir: resolvedOutputDir,
    sliceId,
    stateName,
  });

  await mkdir(paths.artifactDir, { recursive: true });
  await page.screenshot({ path: paths.screenshotPath, fullPage });

  const stateArtifact = {
    schemaVersion: 1,
    sliceId: paths.sliceId,
    stateName,
    stateSlug: paths.stateSlug,
    capturedAt: new Date().toISOString(),
    projectName: testInfo?.project?.name ?? null,
    testTitle: testInfo?.title ?? null,
    testFile: testInfo?.file ?? null,
    artifacts: {
      screenshot: {
        fileName: path.basename(paths.screenshotPath),
        path: paths.screenshotPath,
      },
      state: {
        fileName: path.basename(paths.statePath),
        path: paths.statePath,
      },
    },
    metadata,
  };

  await writeFile(paths.statePath, `${JSON.stringify(stateArtifact, null, 2)}\n`, 'utf8');
  return paths;
}

export async function startFixtureServer(createServer) {
  const server = await createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

export async function stopFixtureServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
