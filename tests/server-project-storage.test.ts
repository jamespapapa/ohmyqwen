import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveServerProjectContextCachePath,
  resolveServerProjectHome,
  resolveServerProjectMemoryHome,
  resolveServerProjectStructureSnapshotPath
} from "../src/server/projects.js";
import { rmWithRetry } from "./temp-dir-utils.js";

const originalProjectHome = process.env.OHMYQWEN_PROJECT_HOME;
const originalMemoryHome = process.env.OHMYQWEN_MEMORY_HOME;
const originalCwd = process.cwd();
const tempDirs: string[] = [];

afterEach(async () => {
  if (originalProjectHome === undefined) {
    delete process.env.OHMYQWEN_PROJECT_HOME;
  } else {
    process.env.OHMYQWEN_PROJECT_HOME = originalProjectHome;
  }

  if (originalMemoryHome === undefined) {
    delete process.env.OHMYQWEN_MEMORY_HOME;
  } else {
    process.env.OHMYQWEN_MEMORY_HOME = originalMemoryHome;
  }

  process.chdir(originalCwd);
  vi.resetModules();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rmWithRetry(dir);
    }
  }
});

describe("server project storage paths", () => {
  it("keeps project home inside the workspace when the workspace is under the repo cwd", () => {
    delete process.env.OHMYQWEN_PROJECT_HOME;
    delete process.env.OHMYQWEN_MEMORY_HOME;

    const workspaceDir = path.resolve(process.cwd(), "fixtures", "sample-project");

    expect(resolveServerProjectHome(workspaceDir)).toBe(workspaceDir);
    expect(resolveServerProjectMemoryHome(workspaceDir)).toBe(path.resolve(workspaceDir, "memory"));
    expect(resolveServerProjectContextCachePath(workspaceDir)).toBe(
      path.resolve(workspaceDir, ".ohmyqwen", "cache", "context-index.json")
    );
  });

  it("falls back to repo-local project storage for external workspaces when no override is set", () => {
    delete process.env.OHMYQWEN_PROJECT_HOME;
    delete process.env.OHMYQWEN_MEMORY_HOME;

    const workspaceDir = "/Users/jules/Desktop/work/untitle/dcp/dcp-services-mevelop";
    const projectHome = resolveServerProjectHome(workspaceDir);

    expect(projectHome).not.toBe(path.resolve(workspaceDir));
    expect(projectHome).toContain(path.resolve(process.cwd(), ".ohmyqwen", "server", "project-homes"));
    expect(path.basename(projectHome)).toMatch(/^dcp-services-mevelop-[a-f0-9]{10}$/);
    expect(resolveServerProjectMemoryHome(workspaceDir)).toBe(path.resolve(projectHome, "memory"));
    expect(resolveServerProjectContextCachePath(workspaceDir)).toBe(
      path.resolve(projectHome, ".ohmyqwen", "cache", "context-index.json")
    );
    expect(resolveServerProjectStructureSnapshotPath(workspaceDir)).toBe(
      path.resolve(projectHome, ".ohmyqwen", "cache", "structure-index.v1.json")
    );
  });

  it("respects explicit project and memory home overrides", () => {
    process.env.OHMYQWEN_PROJECT_HOME = "/tmp/ohmyqwen-project-home";
    process.env.OHMYQWEN_MEMORY_HOME = "memory-cache";

    const workspaceDir = "/Users/jules/Desktop/work/untitle/dcp/dcp-services-mevelop";
    const projectHome = resolveServerProjectHome(workspaceDir);
    const expectedProjectHome = path.resolve("/tmp/ohmyqwen-project-home");

    expect(projectHome).toBe(expectedProjectHome);
    expect(resolveServerProjectMemoryHome(workspaceDir)).toBe(path.resolve(expectedProjectHome, "memory-cache"));
    expect(resolveServerProjectContextCachePath(workspaceDir)).toBe(
      path.resolve(expectedProjectHome, ".ohmyqwen", "cache", "context-index.json")
    );
  });

  it("stores projects without preset metadata in ontology-first mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-project-store-"));
    tempDirs.push(root);
    process.chdir(root);

    const workspaceDir = path.join(root, "workspace");
    await mkdir(workspaceDir, { recursive: true });

    vi.resetModules();
    const { listServerProjects, upsertServerProject } = await import("../src/server/projects.js");

    const project = await upsertServerProject({
      name: "ontology-first-demo",
      workspaceDir,
      description: "demo"
    });

    expect("presetId" in project).toBe(false);

    const projects = await listServerProjects();
    expect(projects).toHaveLength(1);
    expect("presetId" in projects[0]).toBe(false);

    const rawStore = JSON.parse(
      await readFile(path.join(root, ".ohmyqwen", "server", "projects.json"), "utf8")
    ) as { projects?: Array<Record<string, unknown>> };
    expect(rawStore.projects?.[0]).toBeTruthy();
    expect("presetId" in (rawStore.projects?.[0] ?? {})).toBe(false);
  });
});
