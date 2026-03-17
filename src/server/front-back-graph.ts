import { promises as fs } from "node:fs";
import path from "node:path";
import { extractOntologyTextSignalsFromTexts } from "./ontology-signals.js";

export interface FrontendRouteEntry {
  routePath: string;
  screenPath: string;
  sourceFile: string;
  screenCode?: string;
  notes?: string[];
  capabilityTags?: string[];
}

export interface FrontendHttpCall {
  method?: string;
  rawUrl: string;
  normalizedUrl: string;
  functionName?: string;
  source: "http-call" | "vuedoc-api";
}

export interface FrontendScreenEntry {
  filePath: string;
  screenCode?: string;
  componentName?: string;
  routePaths: string[];
  exportPaths: string[];
  apiPaths: string[];
  httpCalls: FrontendHttpCall[];
  labels?: string[];
  capabilityTags?: string[];
}

export interface FrontendCatalogSnapshot {
  version: 1;
  generatedAt: string;
  workspaceDir: string;
  routes: FrontendRouteEntry[];
  screens: FrontendScreenEntry[];
}

export interface BackendRouteEntry {
  path: string;
  internalPath?: string;
  controllerClass: string;
  controllerMethod: string;
  filePath: string;
  serviceHints: string[];
  labels?: string[];
  capabilityTags?: string[];
}

export interface FrontBackGraphLink {
  confidence: number;
  capabilityTags?: string[];
  frontend: {
    screenCode?: string;
    screenPath: string;
    routePath?: string;
  };
  api: {
    method?: string;
    rawUrl: string;
    normalizedUrl: string;
    functionName?: string;
    source: "http-call" | "vuedoc-api";
  };
  gateway: {
    path?: string;
    controllerMethod?: string;
  };
  backend: {
    path: string;
    controllerMethod: string;
    filePath: string;
    serviceHints: string[];
  };
  evidence: string[];
}

export interface FrontBackGraphSnapshot {
  version: 1;
  generatedAt: string;
  meta: {
    backendWorkspaceDir: string;
    frontendWorkspaceDirs: string[];
    asOfDate: string;
  };
  frontend: {
    routeCount: number;
    screenCount: number;
    apiCount: number;
    routes: FrontendRouteEntry[];
    screens: FrontendScreenEntry[];
  };
  backend: {
    routeCount: number;
    gatewayRoutes: BackendRouteEntry[];
    routes: BackendRouteEntry[];
  };
  links: FrontBackGraphLink[];
  diagnostics: {
    parseFailures: string[];
    unmatchedFrontendApis: string[];
    unmatchedFrontendScreens: string[];
  };
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".ohmyqwen"]);

function nowIso(): string {
  return new Date().toISOString();
}

function toForwardSlash(value: string): string {
  return value.replace(/\\/g, "/");
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function normalizeSlashPath(value: string): string {
  const normalized = toForwardSlash(value).replace(/\/+/g, "/");
  if (!normalized.startsWith("/")) {
    return `/${normalized}`.replace(/\/+/g, "/");
  }
  return normalized;
}

function joinUrlPath(left: string, right: string): string {
  const lhs = left.replace(/\/+$/, "");
  const rhs = right.replace(/^\/+/, "");
  if (!lhs) {
    return normalizeSlashPath(rhs);
  }
  if (!rhs) {
    return normalizeSlashPath(lhs);
  }
  return normalizeSlashPath(`${lhs}/${rhs}`);
}

function normalizeApiPath(raw: string): string {
  const trimmed = raw.trim().replace(/['"`]/g, "");
  if (!trimmed) {
    return "";
  }
  const withoutOrigin = trimmed.replace(/^https?:\/\/[^/]+/i, "");
  const withoutDevWrapper = withoutOrigin.replace(/^Vue\.getDevApiUrl\((.*)\)$/i, "$1").replace(/['"`]/g, "");
  const strippedGateway = withoutDevWrapper.replace(/^\/gw\/api(?=\/)/i, "").replace(/^gw\/api(?=\/)/i, "");
  return normalizeSlashPath(strippedGateway);
}

function extractQuotedValues(raw: string): string[] {
  return Array.from(raw.matchAll(/['"]([^'"]+)['"]/g)).map((match) => match[1] ?? "").filter(Boolean);
}

async function collectFiles(root: string, predicate: (relativePath: string) => boolean): Promise<string[]> {
  const output: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && !entry.name.startsWith(".env")) {
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) {
          continue;
        }
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          queue.push(absolute);
        }
        continue;
      }
      const relative = toForwardSlash(path.relative(root, absolute));
      if (predicate(relative)) {
        output.push(relative);
      }
    }
  }
  output.sort((a, b) => a.localeCompare(b));
  return output;
}

function deriveRouteBaseFromFile(relativePath: string): string {
  const normalized = toForwardSlash(relativePath);
  const marker = "src/router/";
  const start = normalized.indexOf(marker);
  const body = start >= 0 ? normalized.slice(start + marker.length) : normalized;
  const withoutTail = body.replace(/\/route\.js$/i, "").replace(/\/index\.js$/i, "");
  return normalizeSlashPath(withoutTail);
}

function extractTrailingLineComments(before: string, limit = 3): string[] {
  const lines = before.split(/\r?\n/).slice(-12);
  const comments = lines
    .map((line) => line.match(/\/\/\s*(.+?)\s*$/)?.[1]?.trim() ?? "")
    .filter(Boolean);
  return unique(comments.slice(-limit));
}

function extractHeaderTitles(content: string): string[] {
  return unique(
    Array.from(content.matchAll(/headerTitle\s*:\s*['"]([^'"]+)['"]/g))
      .map((match) => match[1]?.trim() ?? "")
      .filter(Boolean)
  );
}

function deriveScreenCode(filePath: string, componentName?: string): string | undefined {
  const base = path.basename(filePath, path.extname(filePath));
  if (/^[A-Z]{3,}-[A-Z0-9]+$/i.test(base)) {
    return base;
  }
  if (componentName && /^[A-Z]{3,}-[A-Z0-9]+$/i.test(componentName)) {
    return componentName;
  }
  return base || componentName;
}

export async function buildFrontendCatalog(
  workspaceDir: string
): Promise<FrontendCatalogSnapshot> {
  const routeFiles = await collectFiles(workspaceDir, (relativePath) => /(^|\/)src\/router\/.*\/route\.js$/i.test(relativePath));
  const vueFiles = await collectFiles(workspaceDir, (relativePath) => /(^|\/)src\/views\/.*\.vue$/i.test(relativePath));

  const routes: FrontendRouteEntry[] = [];
  for (const relativePath of routeFiles) {
    const absolutePath = path.resolve(workspaceDir, relativePath);
    const content = await fs.readFile(absolutePath, "utf8");
    const routeBase = deriveRouteBaseFromFile(relativePath);
    for (const match of content.matchAll(/@\/views\/([^'"]+\.vue)/g)) {
      const viewPath = match[1]?.trim() ?? "";
      const before = content.slice(Math.max(0, (match.index ?? 0) - 1200), match.index ?? 0);
      const pathMatches = Array.from(before.matchAll(/path\s*:\s*['"]([^'"]+)['"]/g));
      const nameMatches = Array.from(before.matchAll(/name\s*:\s*['"]([^'"]+)['"]/g));
      const childPath = pathMatches[pathMatches.length - 1]?.[1]?.trim() ?? "";
      const name = nameMatches[nameMatches.length - 1]?.[1]?.trim() ?? "";
      if (!childPath || !viewPath) {
        continue;
      }
      const routeNotes = extractTrailingLineComments(before);
      const routePath = childPath.startsWith("/") ? normalizeSlashPath(childPath) : joinUrlPath(routeBase, childPath);
      routes.push({
        routePath,
        screenPath: toForwardSlash(path.join("src/views", viewPath)),
        sourceFile: relativePath,
        screenCode: name || deriveScreenCode(viewPath),
        notes: routeNotes,
        capabilityTags: extractOntologyTextSignalsFromTexts([routePath, viewPath, name, ...routeNotes])
      });
    }
  }

  const routesByScreenPath = new Map<string, FrontendRouteEntry[]>();
  for (const route of routes) {
    const list = routesByScreenPath.get(route.screenPath) ?? [];
    list.push(route);
    routesByScreenPath.set(route.screenPath, list);
  }

  const screens: FrontendScreenEntry[] = [];
  for (const relativePath of vueFiles) {
    const absolutePath = path.resolve(workspaceDir, relativePath);
    const content = await fs.readFile(absolutePath, "utf8");
    const componentName = content.match(/\bname\s*:\s*['"]([^'"]+)['"]/i)?.[1]?.trim();
    const exportPaths = unique(
      Array.from(content.matchAll(/@exports\s+([^\s*]+)/g)).map((match) => normalizeSlashPath(match[1] ?? "")).filter(Boolean)
    );
    const apiDocPaths = unique(
      Array.from(content.matchAll(/@api\s+([^\s*]+)/g))
        .map((match) => normalizeApiPath(match[1] ?? ""))
        .filter(Boolean)
    );
    const variableDecls = Array.from(
      content.matchAll(/(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*['"]([^'"]+)['"]/g)
    )
      .map((match) => ({
        name: match[1]?.trim() ?? "",
        value: match[2]?.trim() ?? "",
        index: match.index ?? 0
      }))
      .filter((entry) => entry.name && entry.value);

    const functionMatches = Array.from(content.matchAll(/(?:^|\n)\s*(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/g));
    const functionAt = (index: number): string | undefined => {
      let current: string | undefined;
      for (const match of functionMatches) {
        if ((match.index ?? 0) > index) {
          break;
        }
        current = match[1]?.trim();
      }
      return current;
    };

    const httpCalls: FrontendHttpCall[] = [];
    const resolveVariableAt = (name: string, index: number): string | undefined => {
      for (let cursor = variableDecls.length - 1; cursor >= 0; cursor -= 1) {
        const candidate = variableDecls[cursor];
        if (candidate.index > index) {
          continue;
        }
        if (candidate.name === name) {
          return candidate.value;
        }
      }
      return undefined;
    };

    const httpPattern =
      /(?:\b(?:this|[A-Za-z_$][A-Za-z0-9_$]*)\.\$http|axios)\.(get|post|put|delete|patch)\s*\(\s*(?:['"]([^'"]+)['"]|([A-Za-z_$][A-Za-z0-9_$]*))/g;
    for (const match of content.matchAll(httpPattern)) {
      const rawFromLiteral = match[2]?.trim();
      const rawFromVariable = match[3]?.trim();
      const rawUrl =
        rawFromLiteral ||
        (rawFromVariable ? resolveVariableAt(rawFromVariable, match.index ?? 0) : "") ||
        "";
      if (!rawUrl) {
        continue;
      }
      httpCalls.push({
        method: (match[1] ?? "").toUpperCase(),
        rawUrl,
        normalizedUrl: normalizeApiPath(rawUrl),
        functionName: functionAt(match.index ?? 0),
        source: "http-call"
      });
    }

    for (const apiPath of apiDocPaths) {
      if (!httpCalls.some((entry) => entry.normalizedUrl === apiPath)) {
        httpCalls.push({
          rawUrl: apiPath,
          normalizedUrl: apiPath,
          source: "vuedoc-api"
        });
      }
    }

    const routeEntries = routesByScreenPath.get(relativePath) ?? [];
    const routePaths = unique(routeEntries.map((entry) => entry.routePath));
    const apiPaths = unique([...apiDocPaths, ...httpCalls.map((entry) => entry.normalizedUrl).filter(Boolean)]);
    const labels = unique([
      ...routeEntries.flatMap((entry) => entry.notes ?? []),
      ...extractHeaderTitles(content)
    ]);

    if (routePaths.length === 0 && exportPaths.length === 0 && apiPaths.length === 0 && httpCalls.length === 0) {
      continue;
    }

    screens.push({
      filePath: relativePath,
      screenCode: deriveScreenCode(relativePath, componentName),
      componentName,
      routePaths,
      exportPaths,
      apiPaths,
      httpCalls,
      labels,
      capabilityTags: extractOntologyTextSignalsFromTexts([
        relativePath,
        deriveScreenCode(relativePath, componentName),
        componentName,
        ...routePaths,
        ...exportPaths,
        ...apiPaths,
        ...httpCalls.flatMap((entry) => [entry.rawUrl, entry.normalizedUrl, entry.functionName]),
        ...labels
      ])
    });
  }

  return {
    version: 1,
    generatedAt: nowIso(),
    workspaceDir,
    routes: routes.sort((a, b) => a.routePath.localeCompare(b.routePath)),
    screens: screens.sort((a, b) => a.filePath.localeCompare(b.filePath))
  };
}

function extractMappingPaths(annotationArgs: string): string[] {
  const explicit: string[] = [];
  for (const match of annotationArgs.matchAll(/\b(?:value|path)\s*=\s*(\{[\s\S]*?\}|['"][^'"]+['"])/g)) {
    explicit.push(...extractQuotedValues(match[1] ?? ""));
  }
  if (explicit.length > 0) {
    return unique(explicit.map((entry) => normalizeSlashPath(entry)));
  }
  const fallback = extractQuotedValues(annotationArgs.split(",")[0] ?? "");
  return unique(fallback.map((entry) => normalizeSlashPath(entry)));
}

function extractMethodBlock(content: string, bodyStart: number): string {
  let depth = 0;
  for (let index = bodyStart; index < content.length; index += 1) {
    const char = content[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(bodyStart, index + 1);
      }
    }
  }
  return content.slice(bodyStart);
}

function extractModulePrefix(relativePath: string): string | undefined {
  const normalized = toForwardSlash(relativePath);
  const first = normalized.split("/").find(Boolean) ?? "";
  const match = first.match(/^dcp-([a-z0-9-]+)$/i);
  return match?.[1]?.toLowerCase();
}

function buildPublicRoutePath(modulePrefix: string | undefined, routePath: string): string {
  const normalized = normalizeSlashPath(routePath);
  if (!modulePrefix || modulePrefix === "gateway" || normalized === "/api/**") {
    return normalized;
  }
  if (normalized === "/" || normalized === "") {
    return `/${modulePrefix}`;
  }
  if (normalized.startsWith(`/${modulePrefix}/`) || normalized === `/${modulePrefix}`) {
    return normalized;
  }
  if (normalized.startsWith("/monimo/")) {
    const tail = normalized.slice("/monimo".length);
    return joinUrlPath(`/monimo/${modulePrefix}`, tail);
  }
  return joinUrlPath(`/${modulePrefix}`, normalized);
}

export async function extractBackendRouteEntries(
  workspaceDir: string
): Promise<BackendRouteEntry[]> {
  const controllerFiles = await collectFiles(
    workspaceDir,
    (relativePath) => /controller\/.*\.java$/i.test(relativePath)
  );
  const routes: BackendRouteEntry[] = [];

  for (const relativePath of controllerFiles) {
    const absolutePath = path.resolve(workspaceDir, relativePath);
    const content = await fs.readFile(absolutePath, "utf8");
    const className = content.match(/\bclass\s+([A-Z][A-Za-z0-9_]*)/i)?.[1]?.trim();
    if (!className) {
      continue;
    }
    const classIndex = content.indexOf(`class ${className}`);
    const classHeader = classIndex > 0 ? content.slice(0, classIndex) : content;
    const classRequestMappings = Array.from(classHeader.matchAll(/@(?:RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping)\s*\(([\s\S]*?)\)/g));
    const classPaths = classRequestMappings.length > 0 ? extractMappingPaths(classRequestMappings[classRequestMappings.length - 1]?.[1] ?? "") : ["/"];

    const serviceFieldTypes = new Map<string, string>();
    for (const match of content.matchAll(/(?:private|protected|public)\s+(?:final\s+)?([A-Z][A-Za-z0-9_]*(?:Service|Manager|Support|Client|Dao|Mapper|Repository))\s+([a-z][A-Za-z0-9_]*)\s*(?:[;=])/g)) {
      const type = match[1]?.trim();
      const name = match[2]?.trim();
      if (type && name) {
        serviceFieldTypes.set(name, type);
      }
    }

    const classBody = classIndex >= 0 ? content.slice(classIndex) : content;
    const methodPattern = /@(?:RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping)\s*\(([\s\S]*?)\)\s*(?:@[A-Za-z0-9_$.()\s,=\"{}-]+\s*)*(?:public|protected|private)\s+[^{;]+?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\{/g;
    for (const match of classBody.matchAll(methodPattern)) {
      const annotationArgs = match[1] ?? "";
      const methodName = match[2]?.trim() ?? "";
      if (!methodName) {
        continue;
      }
      const methodPaths = extractMappingPaths(annotationArgs);
      const signature = match[0] ?? "";
      const braceIndex = classIndex + (match.index ?? 0) + signature.lastIndexOf("{");
      const block = extractMethodBlock(content, braceIndex);
      const serviceHints = unique(
        Array.from(block.matchAll(/\b([a-z][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g))
          .map((call) => {
            const owner = call[1]?.trim() ?? "";
            const method = call[2]?.trim() ?? "";
            const type = serviceFieldTypes.get(owner);
            if (!type || !method) {
              return "";
            }
            return `${type}.${method}`;
          })
          .filter(Boolean)
      );
      const labels = unique([
        ...Array.from(classHeader.matchAll(/@(?:name|note)\s+([^\n*]+)/g)).map((entry) => entry[1]?.trim() ?? "").filter(Boolean),
        ...Array.from(signature.matchAll(/@ApiOperation\(value\s*=\s*"([^"]+)"/g)).map((entry) => entry[1]?.trim() ?? "").filter(Boolean),
        ...Array.from(classHeader.matchAll(/description\s*=\s*"([^"]+)"/g)).map((entry) => entry[1]?.trim() ?? "").filter(Boolean)
      ]);
      const modulePrefix = extractModulePrefix(relativePath);
      for (const classPath of classPaths) {
        for (const methodPath of methodPaths) {
          const combined = classPath === "/" ? normalizeSlashPath(methodPath) : joinUrlPath(classPath, methodPath);
          const publicPath = buildPublicRoutePath(modulePrefix, combined);
          routes.push({
            path: publicPath,
            internalPath: normalizeSlashPath(combined),
            controllerClass: className,
            controllerMethod: methodName,
            filePath: relativePath,
            serviceHints,
            labels,
            capabilityTags: extractOntologyTextSignalsFromTexts([
              relativePath,
              className,
              methodName,
              publicPath,
              normalizeSlashPath(combined),
              ...serviceHints,
              ...labels
            ])
          });
        }
      }
    }
  }

  return routes.sort((a, b) => (a.path !== b.path ? a.path.localeCompare(b.path) : a.filePath.localeCompare(b.filePath)));
}

function normalizeComparableBackendPath(value: string): string {
  const normalized = normalizeSlashPath(value);
  if (normalized.startsWith("/monimo/")) {
    return normalized.slice("/monimo".length) || "/";
  }
  return normalized;
}

function gatewayRouteForUrl(rawUrl: string, gatewayRoutes: BackendRouteEntry[]): BackendRouteEntry | undefined {
  if (!/^\/gw\/api\//i.test(rawUrl)) {
    return undefined;
  }
  return gatewayRoutes.find((entry) => entry.path === "/api/**");
}

function chooseBestBackendRoute(normalizedUrl: string, routes: BackendRouteEntry[]): BackendRouteEntry | undefined {
  const comparable = normalizeComparableBackendPath(normalizedUrl);
  const exact = routes.find((entry) => normalizeComparableBackendPath(entry.path) === comparable);
  if (exact) {
    return exact;
  }
  return routes.find((entry) => normalizeComparableBackendPath(entry.internalPath ?? entry.path) === comparable.replace(/^\/[a-z0-9-]+(?=\/)/i, ""));
}

export async function buildFrontBackGraph(options: {
  backendWorkspaceDir: string;
  frontendWorkspaceDirs: string[];
}): Promise<FrontBackGraphSnapshot> {
  const frontendCatalogs = await Promise.all(
    options.frontendWorkspaceDirs.map((dir) => buildFrontendCatalog(dir))
  );
  const routes = frontendCatalogs.flatMap((catalog) => catalog.routes);
  const screens = frontendCatalogs.flatMap((catalog) => catalog.screens);
  const backendRoutesAll = await extractBackendRouteEntries(options.backendWorkspaceDir);
  const gatewayRoutes = backendRoutesAll.filter((entry) => entry.path === "/api/**" || /dcp-gateway\//.test(entry.filePath));
  const backendRoutes = backendRoutesAll.filter((entry) => !gatewayRoutes.includes(entry));

  const links: FrontBackGraphLink[] = [];
  const unmatchedFrontendApis: string[] = [];
  const unmatchedFrontendScreens: string[] = [];

  for (const screen of screens) {
    if (screen.httpCalls.length === 0 && screen.routePaths.length === 0) {
      unmatchedFrontendScreens.push(screen.filePath);
      continue;
    }
    for (const call of screen.httpCalls) {
      const backendRoute = chooseBestBackendRoute(call.normalizedUrl, backendRoutes);
      if (!backendRoute) {
        unmatchedFrontendApis.push(call.rawUrl || call.normalizedUrl);
        continue;
      }
      const gatewayRoute = gatewayRouteForUrl(call.rawUrl, gatewayRoutes);
      const evidence = unique(
        [
          screen.routePaths.length > 0 ? "frontend-route" : "",
          screen.exportPaths.length > 0 ? "frontend-export" : "",
          call.source === "http-call" ? "frontend-http-call" : "frontend-vuedoc-api",
          "backend-request-mapping",
          gatewayRoute ? "gateway-api-proxy" : "",
          backendRoute.serviceHints.length > 0 ? "backend-service-call" : ""
        ].filter(Boolean)
      );
      let confidence = 0.55;
      confidence += call.source === "http-call" ? 0.18 : 0.12;
      if (screen.routePaths.length > 0) confidence += 0.08;
      if (screen.exportPaths.length > 0) confidence += 0.05;
      if (gatewayRoute) confidence += 0.07;
      if (backendRoute.serviceHints.length > 0) confidence += 0.12;
      if (normalizeComparableBackendPath(backendRoute.path) === normalizeComparableBackendPath(call.normalizedUrl)) {
        confidence += 0.1;
      }
      const capabilityTags = unique([
        ...(backendRoute.capabilityTags ?? []),
        ...extractOntologyTextSignalsFromTexts([
          screen.filePath,
          screen.screenCode,
          screen.routePaths[0],
          ...(screen.labels ?? []),
          call.rawUrl,
          call.normalizedUrl,
          call.functionName,
          gatewayRoute?.path,
          gatewayRoute ? `${gatewayRoute.controllerClass}.${gatewayRoute.controllerMethod}` : undefined
        ])
      ]);
      links.push({
        confidence: Math.min(0.99, Number(confidence.toFixed(2))),
        capabilityTags,
        frontend: {
          screenCode: screen.screenCode,
          screenPath: screen.filePath,
          routePath: screen.routePaths[0] ?? screen.exportPaths[0]
        },
        api: {
          method: call.method,
          rawUrl: call.rawUrl,
          normalizedUrl: call.normalizedUrl,
          functionName: call.functionName,
          source: call.source
        },
        gateway: {
          path: gatewayRoute?.path,
          controllerMethod: gatewayRoute ? `${gatewayRoute.controllerClass}.${gatewayRoute.controllerMethod}` : undefined
        },
        backend: {
          path: backendRoute.path,
          controllerMethod: `${backendRoute.controllerClass}.${backendRoute.controllerMethod}`,
          filePath: backendRoute.filePath,
          serviceHints: backendRoute.serviceHints
        },
        evidence
      });
    }
  }

  links.sort((a, b) => (b.confidence !== a.confidence ? b.confidence - a.confidence : a.api.normalizedUrl.localeCompare(b.api.normalizedUrl)));

  return {
    version: 1,
    generatedAt: nowIso(),
    meta: {
      backendWorkspaceDir: options.backendWorkspaceDir,
      frontendWorkspaceDirs: [...options.frontendWorkspaceDirs],
      asOfDate: nowIso().slice(0, 10)
    },
    frontend: {
      routeCount: routes.length,
      screenCount: screens.length,
      apiCount: screens.reduce((sum, screen) => sum + screen.apiPaths.length, 0),
      routes,
      screens
    },
    backend: {
      routeCount: backendRoutes.length + gatewayRoutes.length,
      gatewayRoutes,
      routes: backendRoutes
    },
    links,
    diagnostics: {
      parseFailures: [],
      unmatchedFrontendApis: unique(unmatchedFrontendApis),
      unmatchedFrontendScreens: unique(unmatchedFrontendScreens)
    }
  };
}
