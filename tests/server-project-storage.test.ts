import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveServerProjectContextCachePath,
  resolveServerProjectHome,
  resolveServerProjectMemoryHome,
  resolveServerProjectStructureSnapshotPath
} from "../src/server/projects.js";

const originalProjectHome = process.env.OHMYQWEN_PROJECT_HOME;
const originalMemoryHome = process.env.OHMYQWEN_MEMORY_HOME;

afterEach(() => {
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
});
