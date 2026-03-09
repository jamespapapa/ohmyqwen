import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFrontBackGraph,
  buildFrontendCatalog,
  extractBackendRouteEntries
} from "../src/server/front-back-graph.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("front-back graph", () => {
  it("extracts screen routes, vue @api metadata, and http calls into a frontend catalog", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-front-catalog-"));
    tempDirs.push(workspace);

    const routerDir = path.join(workspace, "src/router/mo/mysamsunglife/insurance/give");
    const viewDir = path.join(workspace, "src/views/mo/mysamsunglife/insurance/give");
    await mkdir(routerDir, { recursive: true });
    await mkdir(viewDir, { recursive: true });

    await writeFile(
      path.join(routerDir, "route.js"),
      `let routeInfo = {
  path: 'give',
  children: [
    {
      path: 'MDP-MYINT022231M',
      name: 'MDP-MYINT022231M',
      components: Object.assign({ content: () => import('@/views/mo/mysamsunglife/insurance/give/MDP-MYINT022231M.vue') }, {})
    }
  ]
}
export default routeInfo;
`,
      "utf8"
    );

    await writeFile(
      path.join(viewDir, "MDP-MYINT022231M.vue"),
      `<script>
/**
 * @exports /mo/mysamsunglife/insurance/give/MDP-MYINT022231M
 * @api insurance/division/appexpiry/inqury 분할/만기보험금 조회
 */
export default {
  name: 'MDP-MYINT022231M',
  methods: {
    loadAppSbSearch () {
      const apiLoanDivision = '/gw/api/insurance/division/appexpiry/inqury'
      return this.$http.post(apiLoanDivision, { nextKey: null })
    }
  }
}
</script>
`,
      "utf8"
    );

    const catalog = await buildFrontendCatalog(workspace);
    expect(catalog.screens).toHaveLength(1);
    expect(catalog.routes[0]?.routePath).toBe("/mo/mysamsunglife/insurance/give/MDP-MYINT022231M");
    expect(catalog.screens[0]?.screenCode).toBe("MDP-MYINT022231M");
    expect(catalog.screens[0]?.exportPaths).toContain("/mo/mysamsunglife/insurance/give/MDP-MYINT022231M");
    expect(catalog.screens[0]?.routePaths).toContain("/mo/mysamsunglife/insurance/give/MDP-MYINT022231M");
    expect(catalog.screens[0]?.apiPaths).toContain("/insurance/division/appexpiry/inqury");
    expect(catalog.screens[0]?.httpCalls[0]?.functionName).toBe("loadAppSbSearch");
    expect(catalog.screens[0]?.httpCalls[0]?.rawUrl).toBe("/gw/api/insurance/division/appexpiry/inqury");
    expect(catalog.screens[0]?.httpCalls[0]?.normalizedUrl).toBe("/insurance/division/appexpiry/inqury");
  });

  it("captures _self.$http calls and resolves the nearest local api url variable per function", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-front-catalog-http-owner-"));
    tempDirs.push(workspace);

    const viewDir = path.join(workspace, "src/views/mo/mysamsunglife/insurance/give");
    await mkdir(viewDir, { recursive: true });

    await writeFile(
      path.join(viewDir, "MDP-MYINT022231M.vue"),
      `<script>
export default {
  name: 'MDP-MYINT022231M',
  methods: {
    loadSbSearch () {
      let apiLoanDivision = '/gw/api/insurance/division/expiry/inqury'
      return _self.$http.post(apiLoanDivision, { nextKey: null })
    },
    loadAppSbSearch () {
      let apiLoanDivision = '/gw/api/insurance/division/appexpiry/inqury'
      return _self.$http.post(apiLoanDivision, { nextKey: null })
    }
  }
}
</script>
`,
      "utf8"
    );

    const catalog = await buildFrontendCatalog(workspace);
    const screen = catalog.screens.find((entry) => entry.screenCode === "MDP-MYINT022231M");
    expect(screen?.httpCalls.map((entry) => entry.rawUrl)).toEqual(
      expect.arrayContaining([
        "/gw/api/insurance/division/expiry/inqury",
        "/gw/api/insurance/division/appexpiry/inqury"
      ])
    );
    expect(screen?.httpCalls.map((entry) => entry.functionName)).toEqual(
      expect.arrayContaining(["loadSbSearch", "loadAppSbSearch"])
    );
  });

  it("extracts backend request mappings and service call hints from controller code", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-backend-routes-"));
    tempDirs.push(workspace);

    const controllerDir = path.join(
      workspace,
      "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/give/controller"
    );
    await mkdir(controllerDir, { recursive: true });

    await writeFile(
      path.join(controllerDir, "DivisionExpController.java"),
      `package com.samsunglife.dcp.insurance.give.controller;

@RequestMapping(path = {"/", "/monimo"})
public class DivisionExpController {
  private final DivisionExpService divisionExpService;

  @RequestMapping(value = {"/division/appexpiry/inqury", "/division/appexpiry/proc"}, method = {RequestMethod.POST})
  public JsonResult insertDivisionExp(InsuranceParameters parameters) throws Exception {
    return JsonResult.ok(divisionExpService.saveDivisionExpiry(parameters));
  }
}
`,
      "utf8"
    );

    const routes = await extractBackendRouteEntries(workspace);
    const inqury = routes.find((entry) => entry.path === "/insurance/division/appexpiry/inqury");
    const monimoProc = routes.find((entry) => entry.path === "/monimo/insurance/division/appexpiry/proc");

    expect(inqury).toBeTruthy();
    expect(inqury?.controllerClass).toBe("DivisionExpController");
    expect(inqury?.controllerMethod).toBe("insertDivisionExp");
    expect(inqury?.serviceHints).toContain("DivisionExpService.saveDivisionExpiry");
    expect(monimoProc).toBeTruthy();
  });

  it("builds high-confidence links from vue screen -> gateway api -> backend controller", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-front-back-graph-"));
    tempDirs.push(root);

    const front = path.join(root, "dcp-front-develop");
    const back = path.join(root, "dcp-services-mevelop");

    await mkdir(path.join(front, "src/router/mo/mysamsunglife/insurance/give"), { recursive: true });
    await mkdir(path.join(front, "src/views/mo/mysamsunglife/insurance/give"), { recursive: true });
    await mkdir(path.join(back, "dcp-gateway/src/main/java/com/samsunglife/dcp/gateway/controller"), {
      recursive: true
    });
    await mkdir(path.join(back, "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/give/controller"), {
      recursive: true
    });

    await writeFile(
      path.join(front, "src/router/mo/mysamsunglife/insurance/give/route.js"),
      `export default { children: [{ path: 'MDP-MYINT022231M', name: 'MDP-MYINT022231M', components: { content: () => import('@/views/mo/mysamsunglife/insurance/give/MDP-MYINT022231M.vue') } }] };`,
      "utf8"
    );

    await writeFile(
      path.join(front, "src/views/mo/mysamsunglife/insurance/give/MDP-MYINT022231M.vue"),
      `<script>
/**
 * @exports /mo/mysamsunglife/insurance/give/MDP-MYINT022231M
 * @api insurance/division/appexpiry/inqury 분할/만기보험금 조회
 */
export default {
  name: 'MDP-MYINT022231M',
  methods: {
    loadAppSbSearch () {
      const apiLoanDivision = '/gw/api/insurance/division/appexpiry/inqury'
      return this.$http.post(apiLoanDivision, { nextKey: null })
    }
  }
}
</script>
`,
      "utf8"
    );

    await writeFile(
      path.join(back, "dcp-gateway/src/main/java/com/samsunglife/dcp/gateway/controller/RouteController.java"),
      `package com.samsunglife.dcp.gateway.controller;

public class RouteController {
  @RequestMapping(value = "/api/**", method = {RequestMethod.POST, RequestMethod.GET})
  public Object route() { return null; }
}
`,
      "utf8"
    );

    await writeFile(
      path.join(back, "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/give/controller/DivisionExpController.java"),
      `package com.samsunglife.dcp.insurance.give.controller;

@RequestMapping(path = {"/", "/monimo"})
public class DivisionExpController {
  private final DivisionExpService divisionExpService;

  @RequestMapping(value = "/division/appexpiry/inqury", method = {RequestMethod.POST})
  public JsonResult inqury(InsuranceParameters parameters) throws Exception {
    return JsonResult.ok(divisionExpService.selectDivisionExpiry(parameters));
  }
}
`,
      "utf8"
    );

    const graph = await buildFrontBackGraph({
      backendWorkspaceDir: back,
      frontendWorkspaceDirs: [front]
    });

    expect(graph.frontend.screenCount).toBe(1);
    expect(graph.backend.routeCount).toBeGreaterThanOrEqual(2);
    expect(graph.links.length).toBeGreaterThanOrEqual(1);
    expect(graph.links[0]?.frontend.screenCode).toBe("MDP-MYINT022231M");
    expect(graph.links[0]?.api.rawUrl).toBe("/gw/api/insurance/division/appexpiry/inqury");
    expect(graph.links[0]?.backend.path).toBe("/insurance/division/appexpiry/inqury");
    expect(graph.links[0]?.backend.controllerMethod).toBe("DivisionExpController.inqury");
    expect(graph.links[0]?.gateway.controllerMethod).toBe("RouteController.route");
    expect(graph.links[0]?.confidence).toBeGreaterThan(0.9);
    expect(graph.links[0]?.evidence).toEqual(
      expect.arrayContaining(["frontend-route", "frontend-http-call", "backend-request-mapping", "gateway-api-proxy"])
    );
  });
});
