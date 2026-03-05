import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { FailureCategory, VerifyGateResult } from "../core/types.js";

interface ObjectiveContractSpec {
  objective: string;
  endpointPath?: string;
  expectedResponseText?: string;

  // Node/Express
  requiresNodeRuntime: boolean;
  requiresExpress: boolean;
  requiresLatestExpress: boolean;
  requiresStartScript: boolean;
  requiresServeScript: boolean;
  requiresDevScript: boolean;

  // Spring/Java
  requiresSpringBoot: boolean;
  requiresGradle: boolean;
  requiresMaven: boolean;
  requiresJpa: boolean;
  requiresH2: boolean;
  requiresMemberDomain: boolean;
  requiresCrudCreate: boolean;
  requiresCrudRead: boolean;
  requiresCrudUpdate: boolean;
  requiresCrudDelete: boolean;
}

function normalizeResponseTextValue(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isHelloWorldExpectation(text: string): boolean {
  return /^hello\s*world!?$/i.test(normalizeResponseTextValue(text));
}

function sourceContainsExpectedText(source: string, expectedText: string): boolean {
  if (source.includes(expectedText)) {
    return true;
  }

  if (isHelloWorldExpectation(expectedText)) {
    return /hello\s*world!?/i.test(source);
  }

  return false;
}

interface ObjectiveContractFailure {
  message: string;
  category: FailureCategory;
}

function normalizeObjectiveText(objective: string): string {
  return objective.replace(/\s+/g, " ").trim();
}

function parseObjectiveSpec(objective: string): ObjectiveContractSpec {
  const normalized = normalizeObjectiveText(objective);
  const lower = normalized.toLowerCase();
  const endpointPath = normalized.match(/\/[a-zA-Z0-9._~-]+/g)?.[0];

  const quoted = normalized.match(
    /(?:리턴|반환|응답|return|returns?)\D{0,20}["'`“”‘’]([^"'`“”‘’]{1,120})["'`“”‘’]/i
  )?.[1];
  const explicitHelloWorld =
    /(?:리턴|반환|응답|response|출력|print).{0,30}hello\s*world!?/i.test(normalized) ||
    /hello\s*world!?.{0,30}(?:리턴|반환|응답|response|출력|print)/i.test(normalized);
  const expectedResponseText = quoted?.trim()
    ? quoted.trim()
    : explicitHelloWorld
      ? /hello\s*world!/i.test(normalized)
        ? "Hello World!"
        : "Hello World"
      : undefined;
  const requiresMemberDomain = /\bmember\b|회원|멤버/i.test(normalized);
  const createHit = /\bcreate\b|생성|등록|추가/i.test(normalized);
  const readHit = /\bread\b|조회|목록|get|find/i.test(normalized);
  const updateHit = /\bupdate\b|수정|변경/i.test(normalized);
  const deleteHit = /\bdelete\b|삭제|제거|remove/i.test(normalized);
  const operationHitCount = [createHit, readHit, updateHit, deleteHit].filter(Boolean).length;
  const explicitCrudWord = /\bcrud\b|create\s*\/\s*read\s*\/\s*update\s*\/\s*delete|생성\s*\/\s*수정\s*\/\s*삭제\s*\/\s*조회/i.test(
    normalized
  );
  const crudContext = explicitCrudWord || (requiresMemberDomain && operationHitCount >= 2);
  const requiresCrudCreate = crudContext && (createHit || explicitCrudWord);
  const requiresCrudRead = crudContext && (readHit || explicitCrudWord);
  const requiresCrudUpdate = crudContext && (updateHit || explicitCrudWord);
  const requiresCrudDelete = crudContext && (deleteHit || explicitCrudWord);

  return {
    objective: normalized,
    endpointPath,
    expectedResponseText,
    requiresNodeRuntime: /\bnode(\.js)?\b|npm|pnpm|express/i.test(normalized),
    requiresExpress: /\bexpress\b/i.test(normalized),
    requiresLatestExpress: /express.{0,20}(latest|최신)/i.test(normalized),
    requiresStartScript: /\b(?:npm|pnpm)\s+run\s+start\b/i.test(lower),
    requiresServeScript: /\b(?:npm|pnpm)\s+run\s+serve\b/i.test(lower),
    requiresDevScript: /\b(?:npm|pnpm)\s+run\s+dev\b/i.test(lower),
    requiresSpringBoot: /spring\s*boot|springboot/i.test(normalized),
    requiresGradle: /\bgradle\b/i.test(normalized),
    requiresMaven: /\bmaven\b|\bmvn\b/i.test(normalized),
    requiresJpa: /\bjpa\b|spring-data-jpa|hibernate/i.test(normalized),
    requiresH2: /\bh2\b|h2db|h2 db/i.test(normalized),
    requiresMemberDomain,
    requiresCrudCreate,
    requiresCrudRead,
    requiresCrudUpdate,
    requiresCrudDelete
  };
}

function shouldRunContractGate(spec: ObjectiveContractSpec): boolean {
  return Boolean(
    spec.requiresExpress ||
      spec.requiresStartScript ||
      spec.requiresServeScript ||
      spec.requiresDevScript ||
      spec.requiresSpringBoot ||
      spec.requiresGradle ||
      spec.requiresMaven ||
      spec.endpointPath
  );
}

function sanitizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function failure(message: string, category: FailureCategory): ObjectiveContractFailure {
  return { message, category };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function inferRuntimeFamily(spec: ObjectiveContractSpec): "spring" | "node" | "unknown" {
  if (spec.requiresSpringBoot || spec.requiresGradle || spec.requiresMaven) {
    return "spring";
  }

  if (spec.requiresNodeRuntime || spec.requiresExpress || spec.requiresStartScript || spec.requiresServeScript) {
    return "node";
  }

  return "unknown";
}

function detectEntryFromNodeScript(script: string): string | undefined {
  const normalized = script.trim();
  const direct = normalized.match(/^node\s+([^\s]+\.js)\b/i)?.[1];
  if (direct) {
    return direct;
  }

  const npmNode = normalized.match(/npm\s+run\s+node\s+([^\s]+\.js)\b/i)?.[1];
  if (npmNode) {
    return npmNode;
  }

  const pnpmNode = normalized.match(/pnpm\s+(?:run\s+)?node\s+([^\s]+\.js)\b/i)?.[1];
  if (pnpmNode) {
    return pnpmNode;
  }

  return undefined;
}

async function findLikelyNodeServerFile(cwd: string, scriptValue?: string): Promise<string | undefined> {
  const fromScript = scriptValue ? detectEntryFromNodeScript(scriptValue) : undefined;
  const candidates = [fromScript, "src/server.js", "server.js", "index.js", "src/index.js"].filter(
    Boolean
  ) as string[];

  for (const candidate of candidates) {
    if (await pathExists(path.resolve(cwd, candidate))) {
      return candidate;
    }
  }

  return undefined;
}

async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to resolve free port")));
        return;
      }
      const port = address.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function runNodeServerSmokeCheck(options: {
  cwd: string;
  scriptName: string;
  endpointPath: string;
  expectedResponseText?: string;
  timeoutMs: number;
}): Promise<{ passed: boolean; details: string; category?: FailureCategory }> {
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}${options.endpointPath}`;
  const timeoutAt = Date.now() + options.timeoutMs;

  const child = spawn("npm", ["run", options.scriptName], {
    cwd: options.cwd,
    env: {
      ...process.env,
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.on("exit", (code) => {
    exitCode = typeof code === "number" ? code : 1;
  });

  const stopChild = (): void => {
    if (child.killed) {
      return;
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // noop
    }
  };

  try {
    while (Date.now() < timeoutAt) {
      if (exitCode !== null) {
        return {
          passed: false,
          category: "runtime",
          details: [
            `${options.scriptName} command exited before endpoint was reachable (code=${exitCode})`,
            sanitizeLine(stdout).slice(0, 300),
            sanitizeLine(stderr).slice(0, 300)
          ]
            .filter(Boolean)
            .join(" | ")
        };
      }

      try {
        const response = await fetch(url);
        const text = await response.text();
        if (!response.ok) {
          return {
            passed: false,
            category: "runtime",
            details: `endpoint responded with status=${response.status}, body=${sanitizeLine(text).slice(0, 200)}`
          };
        }

        if (options.expectedResponseText && text.trim() !== options.expectedResponseText.trim()) {
          return {
            passed: false,
            category: "runtime",
            details: `endpoint body mismatch expected="${options.expectedResponseText}" actual="${text.trim()}"`
          };
        }

        return {
          passed: true,
          details: `endpoint smoke passed (${options.endpointPath}) status=${response.status}`
        };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return {
      passed: false,
      category: "runtime",
      details: `endpoint smoke timeout after ${options.timeoutMs}ms (url=${url})`
    };
  } finally {
    stopChild();
  }
}

function detectExpressRangeStatus(value: unknown): "ok" | "weak" | "missing" {
  if (typeof value !== "string" || !value.trim()) {
    return "missing";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "latest") {
    return "ok";
  }

  if (/^[~^]?\d+\.\d+\.\d+/.test(normalized)) {
    return "weak";
  }

  return "weak";
}

async function collectFilesRecursive(rootDir: string, extension: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(extension)) {
        out.push(full);
      }
    }
  }

  await walk(rootDir);
  return out;
}

function extractSpringBootVersion(raw: string): string | undefined {
  const patterns = [
    /org\.springframework\.boot['")\s]+version\s+['"](\d+\.\d+\.\d+)['"]/i,
    /springBootVersion\s*=\s*['"](\d+\.\d+\.\d+)['"]/i,
    /spring-boot-starter-parent[\s\S]*?<version>(\d+\.\d+\.\d+)<\/version>/i
  ];

  for (const pattern of patterns) {
    const matched = raw.match(pattern)?.[1];
    if (matched) {
      return matched;
    }
  }

  return undefined;
}

function parseMajor(version: string): number | undefined {
  const major = Number(version.split(".")[0]);
  return Number.isFinite(major) ? major : undefined;
}

async function runNodeContractChecks(options: {
  spec: ObjectiveContractSpec;
  cwd: string;
  timeoutMs?: number;
  runSmoke?: boolean;
}): Promise<{ failures: ObjectiveContractFailure[]; notes: string[] }> {
  const { spec, cwd } = options;
  const failures: ObjectiveContractFailure[] = [];
  const notes: string[] = [];

  const packagePath = path.join(cwd, "package.json");
  let packageJson: Record<string, unknown> | undefined;
  try {
    packageJson = JSON.parse(await fs.readFile(packagePath, "utf8")) as Record<string, unknown>;
  } catch {
    failures.push(failure("package.json is missing or invalid JSON", "tooling"));
  }

  const scripts =
    packageJson && typeof packageJson.scripts === "object" && packageJson.scripts
      ? (packageJson.scripts as Record<string, unknown>)
      : {};

  const startScript = typeof scripts.start === "string" ? scripts.start : undefined;
  const serveScript = typeof scripts.serve === "string" ? scripts.serve : undefined;
  const devScript = typeof scripts.dev === "string" ? scripts.dev : undefined;

  if (spec.requiresStartScript && !startScript) {
    failures.push(failure("required script is missing: scripts.start", "tooling"));
  }
  if (spec.requiresServeScript && !serveScript) {
    failures.push(failure("required script is missing: scripts.serve", "tooling"));
  }
  if (spec.requiresDevScript && !devScript) {
    failures.push(failure("required script is missing: scripts.dev", "tooling"));
  }

  const depsSources = [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.peerDependencies
  ];
  const expressRange =
    depsSources
      .map((source) =>
        source && typeof source === "object" ? (source as Record<string, unknown>).express : undefined
      )
      .find((value) => value !== undefined) ?? undefined;
  const expressStatus = detectExpressRangeStatus(expressRange);

  if (spec.requiresExpress && expressStatus === "missing") {
    failures.push(failure("express dependency is missing", "tooling"));
  } else if (spec.requiresLatestExpress && expressStatus === "weak") {
    notes.push(
      `express version is "${String(expressRange)}"; objective asked latest so consider "latest" tag or explicit upgrade`
    );
  }

  const serverFile = await findLikelyNodeServerFile(cwd, startScript ?? serveScript ?? devScript);
  let serverSource = "";
  if (spec.endpointPath || spec.expectedResponseText || spec.requiresExpress) {
    if (!serverFile) {
      failures.push(
        failure(
          "server entry file was not detected (expected from scripts.start/serve or common server paths)",
          "runtime"
        )
      );
    } else {
      try {
        serverSource = await fs.readFile(path.join(cwd, serverFile), "utf8");
      } catch {
        failures.push(failure(`server source file is not readable: ${serverFile}`, "runtime"));
      }
    }
  }

  if (serverSource && spec.endpointPath && !serverSource.includes(spec.endpointPath)) {
    failures.push(failure(`endpoint path is missing in server source: ${spec.endpointPath}`, "runtime"));
  }
  if (
    serverSource &&
    spec.expectedResponseText &&
    !sourceContainsExpectedText(serverSource, spec.expectedResponseText)
  ) {
    failures.push(
      failure(`response text is missing in server source: ${spec.expectedResponseText}`, "runtime")
    );
  }

  const smokeScript = spec.requiresServeScript
    ? serveScript
      ? "serve"
      : undefined
    : spec.requiresStartScript
      ? startScript
        ? "start"
        : undefined
      : startScript
        ? "start"
        : serveScript
          ? "serve"
          : undefined;

  const shouldRunSmoke =
    (options.runSmoke ?? true) &&
    failures.length === 0 &&
    Boolean(smokeScript && spec.endpointPath);

  if (shouldRunSmoke) {
    const smoke = await runNodeServerSmokeCheck({
      cwd,
      scriptName: smokeScript as string,
      endpointPath: spec.endpointPath as string,
      expectedResponseText: spec.expectedResponseText,
      timeoutMs: options.timeoutMs ?? 10_000
    });

    if (!smoke.passed) {
      failures.push(failure(smoke.details, smoke.category ?? "runtime"));
    } else {
      notes.push(smoke.details);
    }
  }

  return { failures, notes };
}

async function runSpringContractChecks(options: {
  spec: ObjectiveContractSpec;
  cwd: string;
}): Promise<{ failures: ObjectiveContractFailure[]; notes: string[] }> {
  const { spec, cwd } = options;
  const failures: ObjectiveContractFailure[] = [];
  const notes: string[] = [];

  const gradleBuildFiles = [path.join(cwd, "build.gradle"), path.join(cwd, "build.gradle.kts")];
  const mavenPom = path.join(cwd, "pom.xml");
  const hasGradle = (await Promise.all(gradleBuildFiles.map((target) => pathExists(target)))).some(Boolean);
  const hasMaven = await pathExists(mavenPom);

  if (spec.requiresGradle && !hasGradle) {
    failures.push(failure("Gradle build file is required but build.gradle(.kts) is missing", "tooling"));
  }
  if (spec.requiresMaven && !hasMaven) {
    failures.push(failure("Maven build file is required but pom.xml is missing", "tooling"));
  }
  if (!spec.requiresGradle && !spec.requiresMaven && !hasGradle && !hasMaven) {
    failures.push(failure("No Java build file detected (expected Gradle or Maven)", "tooling"));
  }

  if (spec.requiresSpringBoot) {
    const versionCandidates: string[] = [];
    for (const filePath of [...gradleBuildFiles, mavenPom]) {
      if (!(await pathExists(filePath))) {
        continue;
      }
      const raw = await fs.readFile(filePath, "utf8");
      const version = extractSpringBootVersion(raw);
      if (version) {
        versionCandidates.push(version);
      }
    }

    if (versionCandidates.length === 0) {
      notes.push("Spring Boot version could not be statically inferred from build files");
    } else {
      const first = versionCandidates[0] as string;
      const major = parseMajor(first);
      if (major !== undefined && major < 3) {
        failures.push(
          failure(`Spring Boot major version must be >= 3 (detected ${first})`, "tooling")
        );
      }
    }
  }

  const javaSources = await collectFilesRecursive(path.join(cwd, "src", "main", "java"), ".java");
  if (javaSources.length === 0) {
    failures.push(failure("No Java source files found under src/main/java", "runtime"));
    return { failures, notes };
  }

  const contents = await Promise.all(javaSources.map((target) => fs.readFile(target, "utf8")));
  const buildSources = await Promise.all(
    [...gradleBuildFiles, mavenPom].map(async (target) => {
      try {
        return await fs.readFile(target, "utf8");
      } catch {
        return "";
      }
    })
  );
  const resourcePaths = [
    path.join(cwd, "src", "main", "resources", "application.properties"),
    path.join(cwd, "src", "main", "resources", "application.yml"),
    path.join(cwd, "src", "main", "resources", "application.yaml")
  ];
  const resourceSources = await Promise.all(
    resourcePaths.map(async (target) => {
      try {
        return await fs.readFile(target, "utf8");
      } catch {
        return "";
      }
    })
  );
  const combinedBuildAndResource = [...buildSources, ...resourceSources].join("\n");
  const combinedSources = contents.join("\n");

  if (spec.requiresJpa) {
    const hasJpaDependency =
      /spring-boot-starter-data-jpa|spring-data-jpa|jakarta\.persistence|javax\.persistence/i.test(
        `${combinedBuildAndResource}\n${combinedSources}`
      );
    if (!hasJpaDependency) {
      failures.push(failure("JPA requirement is not satisfied (data-jpa dependency/usages not detected)", "runtime"));
    }
  }

  if (spec.requiresH2) {
    const hasH2 =
      /\bh2database\b|jdbc:h2|spring\.h2\.console|runtimeonly\s+['"]com\.h2database:h2/i.test(
        combinedBuildAndResource
      );
    if (!hasH2) {
      failures.push(failure("H2 requirement is not satisfied (H2 dependency/config not detected)", "runtime"));
    }
  }

  if (spec.requiresMemberDomain) {
    const hasMemberDomain = /\bMember\b|회원|멤버/.test(combinedSources);
    if (!hasMemberDomain) {
      failures.push(failure("Member domain model/handler is missing in Spring source", "runtime"));
    }
  }

  if (spec.endpointPath) {
    const endpointPath = spec.endpointPath;
    const hasEndpoint = contents.some((raw) => {
      if (raw.includes(endpointPath)) {
        return true;
      }
      const escaped = endpointPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`@(GetMapping|RequestMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\\(\\s*["']${escaped}["']`, "m").test(raw);
    });

    if (!hasEndpoint) {
      failures.push(failure(`endpoint path is missing in Spring controller source: ${endpointPath}`, "runtime"));
    }
  } else if (spec.requiresMemberDomain) {
    const hasMemberEndpoint = /\/members?\b/.test(combinedSources);
    if (!hasMemberEndpoint) {
      failures.push(failure("Member CRUD objective requires /member or /members endpoint", "runtime"));
    }
  }

  if (spec.expectedResponseText) {
    const hasResponse = contents.some((raw) =>
      sourceContainsExpectedText(raw, spec.expectedResponseText as string)
    );
    if (!hasResponse) {
      failures.push(
        failure(`response text is missing in Spring source: ${spec.expectedResponseText}`, "runtime")
      );
    }
  }

  const testSources = await collectFilesRecursive(path.join(cwd, "src", "test", "java"), ".java");
  if (testSources.length === 0) {
    failures.push(
      failure(
        "Spring objective requires at least one automated test under src/test/java (e.g., MockMvc endpoint contract test)",
        "test"
      )
    );
    return { failures, notes };
  }

  const testContents = await Promise.all(testSources.map((target) => fs.readFile(target, "utf8")));
  if (spec.endpointPath) {
    const hasEndpointTest = testContents.some((raw) => raw.includes(spec.endpointPath as string));
    if (!hasEndpointTest) {
      failures.push(
        failure(
          `endpoint contract test is missing in Spring tests: ${spec.endpointPath}`,
          "test"
        )
      );
    }
  } else if (spec.requiresMemberDomain) {
    const hasMemberEndpointTest = testContents.some((raw) => /\/members?\b/.test(raw) || /\bMember\b/.test(raw));
    if (!hasMemberEndpointTest) {
      failures.push(
        failure(
          "Member CRUD objective requires endpoint-focused tests for member API",
          "test"
        )
      );
    }
  }

  if (spec.expectedResponseText) {
    const hasResponseAssertion = testContents.some((raw) =>
      sourceContainsExpectedText(raw, spec.expectedResponseText as string)
    );
    if (!hasResponseAssertion) {
      failures.push(
        failure(
          `response text assertion is missing in Spring tests: ${spec.expectedResponseText}`,
          "test"
        )
      );
    }
  }

  if (spec.requiresCrudCreate) {
    const hasCreate = /@PostMapping|\.save\(/.test(combinedSources);
    if (!hasCreate) {
      failures.push(failure("CRUD requirement missing: create operation (@PostMapping/save)", "runtime"));
    }
  }
  if (spec.requiresCrudRead) {
    const hasRead = /@GetMapping|findById|findAll/.test(combinedSources);
    if (!hasRead) {
      failures.push(failure("CRUD requirement missing: read operation (@GetMapping/findById/findAll)", "runtime"));
    }
  }
  if (spec.requiresCrudUpdate) {
    const hasUpdate = /@PutMapping|@PatchMapping/.test(combinedSources);
    if (!hasUpdate) {
      failures.push(failure("CRUD requirement missing: update operation (@PutMapping/@PatchMapping)", "runtime"));
    }
  }
  if (spec.requiresCrudDelete) {
    const hasDelete = /@DeleteMapping|deleteById/.test(combinedSources);
    if (!hasDelete) {
      failures.push(failure("CRUD requirement missing: delete operation (@DeleteMapping/deleteById)", "runtime"));
    }
  }

  return { failures, notes };
}

export async function runObjectiveContractGate(options: {
  objective: string;
  cwd: string;
  timeoutMs?: number;
  runSmoke?: boolean;
  verifyLogPath?: string;
}): Promise<VerifyGateResult | undefined> {
  const startedAt = Date.now();
  const spec = parseObjectiveSpec(options.objective);
  if (!shouldRunContractGate(spec)) {
    return undefined;
  }

  const runtimeFamily = inferRuntimeFamily(spec);
  const checkResult =
    runtimeFamily === "spring"
      ? await runSpringContractChecks({ spec, cwd: options.cwd })
      : await runNodeContractChecks({
          spec,
          cwd: options.cwd,
          timeoutMs: options.timeoutMs,
          runSmoke: options.runSmoke
        });

  const passed = checkResult.failures.length === 0;
  const details = passed
    ? checkResult.notes.length > 0
      ? checkResult.notes.join(" | ")
      : "objective contract checks passed"
    : checkResult.failures.map((entry) => entry.message).join(" | ");
  const category = passed ? undefined : checkResult.failures[0]?.category;

  if (options.verifyLogPath) {
    await fs.appendFile(
      options.verifyLogPath,
      [
        `[${new Date().toISOString()}] gate=objective-contract code=${passed ? 0 : 1} category=${category ?? "ok"}`,
        details,
        ""
      ].join("\n"),
      "utf8"
    );
  }

  return {
    name: "objective-contract",
    passed,
    command: "runtime-contract-check",
    args: [],
    details,
    durationMs: Date.now() - startedAt,
    category
  };
}
