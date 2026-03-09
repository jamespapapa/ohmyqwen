import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildEaiDictionaryEntries } from "../src/server/eai-dictionary.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

function serviceXml(input: {
  interfaceId: string;
  serviceName: string;
  serviceDescription?: string;
  reqSystemIds?: string[];
  respSystemId?: string;
  targetType?: string;
  parameterName?: string;
  serviceId?: string;
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<services>
  <service>
    <layoutId>${input.interfaceId}</layoutId>
    ${input.serviceId ? `<serviceId>${input.serviceId}</serviceId>` : ""}
    <serviceName>${input.serviceName}</serviceName>
    <serviceDescription>${input.serviceDescription ?? input.serviceName}</serviceDescription>
    <reqSystemCodes>
      ${(input.reqSystemIds ?? []).map((id) => `<reqSystemId>${id}</reqSystemId>`).join("")}
    </reqSystemCodes>
    <targetType>${input.targetType ?? "ERP"}</targetType>
    <respSystemId>${input.respSystemId ?? "A000100"}</respSystemId>
    <requestInfo>
      <parameterName>${input.parameterName ?? `vo.${input.interfaceId}`}</parameterName>
    </requestInfo>
  </service>
</services>
`;
}

describe("eai dictionary", () => {
  it("dedupes base/env duplicates before max-entry capping and keeps later unique interfaces", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-eai-dict-"));
    tempDirs.push(workspace);

    const baseDir = path.join(workspace, "resources/eai/io/sli/ea2");
    const envDir = path.join(workspace, "resources/eai/env/dev/io/sli/ea2");
    await mkdir(baseDir, { recursive: true });
    await mkdir(envDir, { recursive: true });

    await writeFile(
      path.join(baseDir, "F10480011_service.xml"),
      serviceXml({
        interfaceId: "F10480011",
        serviceName: "퇴직보험금 청구대상자 조회",
        reqSystemIds: ["F1129"],
        targetType: "LEGACY",
        serviceId: "CLOUEWA5"
      }),
      "utf8"
    );
    await writeFile(
      path.join(envDir, "F10480011_service.xml"),
      serviceXml({
        interfaceId: "F10480011",
        serviceName: "퇴직보험금 청구대상자 조회 DEV",
        reqSystemIds: ["F1129"],
        targetType: "LEGACY",
        serviceId: "CLOUEWA5"
      }),
      "utf8"
    );
    await writeFile(
      path.join(baseDir, "F1FCZ0045_service.xml"),
      serviceXml({
        interfaceId: "F1FCZ0045",
        serviceName: "홈페이지 사고보험금접수 명세 반영",
        reqSystemIds: ["F1129", "F1131"],
        targetType: "ERP"
      }),
      "utf8"
    );

    const entries = await buildEaiDictionaryEntries({
      workspaceDir: workspace,
      files: [
        "resources/eai/env/dev/io/sli/ea2/F10480011_service.xml",
        "resources/eai/io/sli/ea2/F10480011_service.xml",
        "resources/eai/io/sli/ea2/F1FCZ0045_service.xml"
      ],
      maxEntries: 2
    });

    expect(entries.map((entry) => entry.interfaceId)).toEqual(["F10480011", "F1FCZ0045"]);
    expect(entries[0]?.sourcePath).toBe("resources/eai/io/sli/ea2/F10480011_service.xml");
    expect(entries[0]?.envPaths).toContain("resources/eai/env/dev/io/sli/ea2/F10480011_service.xml");
  });

  it("extracts interface metadata and java reverse-links from dcp-style service code", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-eai-links-"));
    tempDirs.push(workspace);

    const baseDir = path.join(workspace, "resources/eai/io/sli/ea2");
    const javaDir = path.join(
      workspace,
      "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service"
    );
    await mkdir(baseDir, { recursive: true });
    await mkdir(javaDir, { recursive: true });

    await writeFile(
      path.join(baseDir, "F1FCZ0045_service.xml"),
      serviceXml({
        interfaceId: "F1FCZ0045",
        serviceName: "홈페이지 사고보험금접수건 반영",
        reqSystemIds: ["F1129", "F1131"],
        respSystemId: "A000100",
        targetType: "ERP",
        parameterName: "sli.in.ea2.vo.a0001fc.EAF1FCZ0045ReqVO"
      }),
      "utf8"
    );

    await writeFile(
      path.join(javaDir, "AccBenefitClaimService.java"),
      `package com.samsunglife.dcp.insurance.internet.service;

public class AccBenefitClaimService {
  private static final String SERVICE_LAYOUT_ID_4 = "F1FCZ0045";

  public void saveBenefitClaimDoc(Object parameters) throws Exception {
    this.callF1FCZ0045(parameters);
  }

  public Object callF1FCZ0045(Object parameters) throws Exception {
    String layoutId = SERVICE_LAYOUT_ID_4;
    String serviceId = EaiServiceIdUtils.INSTANCE.generateServiceId(layoutId, "S", "pc");
    EaiParams eaiParams = new EaiParams.Builder(serviceId, parameters).build();
    return eaiExecuteService.eaiExecute(eaiParams, EAF1FCZ0045ReqVO.class);
  }
}
`,
      "utf8"
    );

    const entries = await buildEaiDictionaryEntries({
      workspaceDir: workspace,
      files: [
        "resources/eai/io/sli/ea2/F1FCZ0045_service.xml",
        "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java"
      ]
    });

    const entry = entries.find((item) => item.interfaceId === "F1FCZ0045");
    expect(entry).toBeTruthy();
    expect(entry?.reqSystemIds).toEqual(["F1129", "F1131"]);
    expect(entry?.respSystemId).toBe("A000100");
    expect(entry?.targetType).toBe("ERP");
    expect(entry?.parameterName).toBe("sli.in.ea2.vo.a0001fc.EAF1FCZ0045ReqVO");
    expect(entry?.moduleUsagePaths).toContain(
      "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java"
    );
    expect(entry?.javaCallSites.some((site) => site.methodName === "callF1FCZ0045")).toBe(true);
    expect(entry?.javaCallSites.some((site) => site.methodName === "saveBenefitClaimDoc")).toBe(true);
  });

  it("prioritizes module code files for reverse-link scanning even when service xml dominates the file list", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-eai-priority-"));
    tempDirs.push(workspace);

    const baseDir = path.join(workspace, "resources/eai/io/sli/ea2");
    const envDir = path.join(workspace, "resources/eai/env/dev/io/sli/ea2");
    const javaDir = path.join(
      workspace,
      "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service"
    );
    await mkdir(baseDir, { recursive: true });
    await mkdir(envDir, { recursive: true });
    await mkdir(javaDir, { recursive: true });

    await writeFile(
      path.join(baseDir, "F1FCZ0046_service.xml"),
      serviceXml({
        interfaceId: "F1FCZ0046",
        serviceName: "홈페이지 사고보험금접수 가능구분 조회",
        reqSystemIds: ["F1129"]
      }),
      "utf8"
    );
    await writeFile(
      path.join(envDir, "F10480011_service.xml"),
      serviceXml({
        interfaceId: "F10480011",
        serviceName: "퇴직보험금 청구대상자 조회",
        reqSystemIds: ["F1129"]
      }),
      "utf8"
    );
    await writeFile(
      path.join(javaDir, "AccBenefitClaimService.java"),
      `package com.samsunglife.dcp.insurance.internet.service;

public class AccBenefitClaimService {
  public Object checkApply(Object parameters) throws Exception {
    return callF1FCZ0046S(parameters);
  }

  public Object callF1FCZ0046S(Object parameters) throws Exception {
    String layoutId = "F1FCZ0046";
    String serviceId = EaiServiceIdUtils.INSTANCE.generateServiceId(layoutId, "S", "pc");
    return eaiExecuteService.eaiExecute(new EaiParams.Builder(serviceId, parameters).build(), Object.class);
  }
}
`,
      "utf8"
    );

    const entries = await buildEaiDictionaryEntries({
      workspaceDir: workspace,
      files: [
        "resources/eai/io/sli/ea2/F1FCZ0046_service.xml",
        "resources/eai/env/dev/io/sli/ea2/F10480011_service.xml",
        "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java"
      ],
      maxSearchableFiles: 2
    });

    const entry = entries.find((item) => item.interfaceId === "F1FCZ0046");
    expect(entry?.javaCallSites.some((site) => site.methodName === "callF1FCZ0046S")).toBe(true);
    expect(entry?.javaCallSites.some((site) => site.methodName === "checkApply")).toBe(true);
    expect(entry?.moduleUsagePaths).toContain(
      "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java"
    );
  });

});
