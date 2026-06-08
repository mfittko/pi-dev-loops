import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { main } from "../../scripts/projects/ensure-queue-board.mjs";

// ── Helpers ─────────────────────────────────────────────────────────────

function mockRunChild(responses) {
  let callIndex = 0;
  return async (_cmd, args, _env) => {
    if (callIndex >= responses.length) {
      throw new Error(`Unexpected gh call #${callIndex + 1} (only ${responses.length} mocked)`);
    }
    const resp = responses[callIndex++];
    if (resp.error) {
      return { code: 1, stdout: "", stderr: resp.error };
    }
    return { code: 0, stdout: JSON.stringify(resp.payload), stderr: "" };
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────

function userPayload() {
  return { data: { user: { id: "U_kgDOABC123" } } };
}

function orgPayload() {
  return { data: { organization: { id: "O_kgDOXYZ789" } } };
}

function noUserPayload() {
  return { data: { user: null } };
}

function noOrgPayload() {
  return { data: { organization: null } };
}

function listUserProjectsResponse(projects) {
  return {
    data: {
      user: {
        projectsV2: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: projects,
        },
      },
    },
  };
}

function listOrgProjectsResponse(projects) {
  return {
    data: {
      organization: {
        projectsV2: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: projects,
        },
      },
    },
  };
}

function getFieldsResponse(fields) {
  return {
    data: { node: { fields: { nodes: fields } } },
  };
}

function createProjectResponse(project) {
  return {
    data: { createProjectV2: { projectV2: project } },
  };
}

function createFieldResponse(field) {
  return {
    data: { createProjectV2Field: { projectV2Field: field } },
  };
}

const STATUS_FIELD = {
  id: "PVTSSF_lADO...",
  name: "Status",
  options: [
    { id: "opt1", name: "Backlog" },
    { id: "opt2", name: "Next Up" },
    { id: "opt3", name: "In Progress" },
    { id: "opt4", name: "Done" },
  ],
};

const EXISTING_PROJECT = {
  id: "PVT_kwDO...",
  number: 1,
  title: "Dev Loop Queue",
  url: "https://github.com/users/mfittko/projects/1",
};

// ── Tests ───────────────────────────────────────────────────────────────

describe("ensure-queue-board", () => {
  describe("create path", () => {
    it("creates project and Status field when board does not exist (user)", async () => {
      const responses = [
        { payload: userPayload() },
        { payload: listUserProjectsResponse([]) },
        {
          payload: createProjectResponse({
            id: "PVT_new",
            number: 2,
            title: "Dev Loop Queue",
            url: "https://github.com/users/mfittko/projects/2",
          }),
        },
        {
          payload: createFieldResponse({ id: "PVTSSF_new", name: "Status" }),
        },
      ];
      const result = await main(
        { repo: "mfittko/pi-dev-loops" },
        { env: {}, runChild: mockRunChild(responses) },
      );
      assert.equal(result.ok, true);
      assert.equal(result.project.title, "Dev Loop Queue");
      assert.equal(result.project.number, 2);
      assert.ok(result.project.id);
      assert.ok(result.project.url);
      assert.equal(result.project.statusFieldId, "PVTSSF_new");
    });

    it("creates project for org owner", async () => {
      const responses = [
        { payload: noUserPayload() },
        { payload: orgPayload() },
        { payload: listOrgProjectsResponse([]) },
        {
          payload: createProjectResponse({
            id: "PVT_org",
            number: 1,
            title: "Dev Loop Queue",
            url: "https://github.com/orgs/myorg/projects/1",
          }),
        },
        {
          payload: createFieldResponse({ id: "PVTSSF_org", name: "Status" }),
        },
      ];
      const result = await main(
        { repo: "myorg/repo" },
        { env: {}, runChild: mockRunChild(responses) },
      );
      assert.equal(result.ok, true);
      assert.equal(result.project.number, 1);
    });

    it("uses custom title", async () => {
      const responses = [
        { payload: userPayload() },
        { payload: listUserProjectsResponse([]) },
        {
          payload: createProjectResponse({
            id: "PVT_custom", number: 3, title: "My Queue",
            url: "https://github.com/users/mfittko/projects/3",
          }),
        },
        {
          payload: createFieldResponse({ id: "PVTSSF_custom", name: "Status" }),
        },
      ];
      const result = await main(
        { repo: "mfittko/pi-dev-loops", title: "My Queue" },
        { env: {}, runChild: mockRunChild(responses) },
      );
      assert.equal(result.ok, true);
      assert.equal(result.project.title, "My Queue");
    });
  });

  describe("already-exists path", () => {
    it("returns existing project when board and Status field exist", async () => {
      const responses = [
        { payload: userPayload() },
        { payload: listUserProjectsResponse([EXISTING_PROJECT]) },
        { payload: getFieldsResponse([STATUS_FIELD]) },
      ];
      const result = await main(
        { repo: "mfittko/pi-dev-loops" },
        { env: {}, runChild: mockRunChild(responses) },
      );
      assert.equal(result.ok, true);
      assert.equal(result.project.id, "PVT_kwDO...");
      assert.equal(result.project.number, 1);
      assert.equal(result.project.title, "Dev Loop Queue");
      assert.equal(result.project.statusFieldId, "PVTSSF_lADO...");
    });

    it("creates Status field when project exists but field is missing", async () => {
      const responses = [
        { payload: userPayload() },
        { payload: listUserProjectsResponse([EXISTING_PROJECT]) },
        { payload: getFieldsResponse([]) },
        {
          payload: createFieldResponse({ id: "PVTSSF_new", name: "Status" }),
        },
      ];
      const result = await main(
        { repo: "mfittko/pi-dev-loops" },
        { env: {}, runChild: mockRunChild(responses) },
      );
      assert.equal(result.ok, true);
      assert.equal(result.project.statusFieldId, "PVTSSF_new");
    });

    it("throws on missing columns in existing Status field", async () => {
      const partialField = {
        id: "PVTSSF_partial", name: "Status",
        options: [{ id: "opt1", name: "Backlog" }],
      };
      const responses = [
        { payload: userPayload() },
        { payload: listUserProjectsResponse([EXISTING_PROJECT]) },
        { payload: getFieldsResponse([partialField]) },
      ];
      await assert.rejects(
        () => main({ repo: "mfittko/pi-dev-loops" }, { env: {}, runChild: mockRunChild(responses) }),
        /missing columns/,
      );
    });

    it("handles paginated project listing (>50 projects)", async () => {
      const page1 = {
        data: {
          user: {
            projectsV2: {
              pageInfo: { hasNextPage: true, endCursor: "cursor1" },
              nodes: Array.from({ length: 50 }, (_, i) => ({
                id: `PVT_${i}`, number: i, title: `Project ${i}`,
                url: `https://github.com/users/mfittko/projects/${i}`,
              })),
            },
          },
        },
      };
      const page2 = {
        data: {
          user: {
            projectsV2: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [EXISTING_PROJECT],
            },
          },
        },
      };
      const responses = [
        { payload: userPayload() },
        { payload: page1 },
        { payload: page2 },
        { payload: getFieldsResponse([STATUS_FIELD]) },
      ];
      const result = await main(
        { repo: "mfittko/pi-dev-loops" },
        { env: {}, runChild: mockRunChild(responses) },
      );
      assert.equal(result.ok, true);
      assert.equal(result.project.number, 1);
    });
  });

  describe("error paths", () => {
    it("throws on invalid repo format", async () => {
      await assert.rejects(() => main({ repo: "not-a-repo" }), /owner\/name/);
    });

    it("throws on repo with extra segments", async () => {
      await assert.rejects(() => main({ repo: "a/b/c" }), /owner\/name/);
    });

    it("throws on whitespace-padded repo", async () => {
      await assert.rejects(() => main({ repo: " owner/repo " }), /whitespace/);
    });

    it("throws on missing repo", async () => {
      await assert.rejects(() => main({}), /required/);
    });

    it("throws on GraphQL API error", async () => {
      const responses = [{ error: "gh: authentication required" }];
      await assert.rejects(
        () => main({ repo: "mfittko/pi-dev-loops" }, { env: {}, runChild: mockRunChild(responses) }),
        /gh api graphql failed/,
      );
    });

    it("throws on GraphQL errors in payload", async () => {
      const responses = [{
        payload: { errors: [{ message: "Could not resolve to a User" }] },
      }];
      await assert.rejects(
        () => main({ repo: "mfittko/pi-dev-loops" }, { env: {}, runChild: mockRunChild(responses) }),
        /GraphQL errors/,
      );
    });

    it("throws when neither user nor org resolves", async () => {
      const responses = [
        { payload: noUserPayload() },
        { payload: noOrgPayload() },
      ];
      await assert.rejects(
        () => main({ repo: "mfittko/pi-dev-loops" }, { env: {}, runChild: mockRunChild(responses) }),
        /Could not resolve owner ID/,
      );
    });
  });

  describe("exit code classification", () => {
    it("MISSING_COLUMNS error has code MISSING_COLUMNS", async () => {
      const partialField = {
        id: "PVTSSF_partial", name: "Status",
        options: [{ id: "opt1", name: "Backlog" }],
      };
      const responses = [
        { payload: userPayload() },
        { payload: listUserProjectsResponse([EXISTING_PROJECT]) },
        { payload: getFieldsResponse([partialField]) },
      ];
      try {
        await main({ repo: "mfittko/pi-dev-loops" }, { env: {}, runChild: mockRunChild(responses) });
        assert.fail("should have thrown");
      } catch (err) {
        assert.equal(err.code, "MISSING_COLUMNS");
      }
    });
  });
});
