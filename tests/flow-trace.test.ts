import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { traceLinkedFlowDownstream } from "../src/server/flow-trace.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("flow trace", () => {
  it("derives generic downstream DB/EAI steps from representative write/document service methods", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-flow-trace-"));
    tempDirs.push(workspace);

    const serviceDir = path.join(
      workspace,
      "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service"
    );
    await mkdir(serviceDir, { recursive: true });

    const servicePath = path.join(serviceDir, "AccBenefitClaimService.java");
    await writeFile(
      servicePath,
      `package com.samsunglife.dcp.insurance.internet.service;

public class AccBenefitClaimService {
  private static final String SERVICE_LAYOUT_ID_2 = "F13630020";
  private static final String SERVICE_LAYOUT_ID_3 = "F13630014";
  private ImclBrkdnDao imclBrkdnDao;
  private RedisDataSupport redisDataSupport;
  private RedisSessionSupport redisSessionSupport;
  private EaiExecuteService eaiExecuteService;

  public InsuranceCommonResponse saveBenefitClaim(InsuranceParameters parameters) throws Exception {
    AccBenefitClaimInqrRes redisData = getRedisInfo(parameters);
    int inRslt = this.saveClamDocument(parameters, redisData);
    return new InsuranceCommonResponse();
  }

  public ImclBrkdnDaoModel saveBenefitClaimDoc(InsuranceParameters parameters) throws Exception {
    AccBenefitClaimInqrRes redisData = getRedisInfo(parameters);
    redisDataSupport.set("img.check", parameters.getUserProxy().getCustId(), "Y", 1200);
    ImclBrkdnDaoModel docInfo = this.selectClamDocument(parameters, redisData);
    int fileSeq = imclBrkdnDao.selectFileSeq("cust");
    this.callMODC0008(parameters, "img", "FC/buLor", new String[][] {});
    this.moveConvertUploadFile(parameters, "cust", fileSeq, docInfo.getDcImclNo());
    this.callMODC0010(parameters, null);
    this.callF1FCZ0045(parameters, null, docInfo, "1");
    int fileRslt = this.saveClamDocumentFile(parameters, null);
    int upRslt = this.updateSubmitdate(parameters, docInfo);
    redisSessionSupport.deleteItem(parameters, "claim.base");
    return docInfo;
  }

  public void callMODC0008(InsuranceParameters parameters, String imgFileNm, String frmNo, String[][] data) throws Exception {
    String layoutId = SERVICE_LAYOUT_ID_2;
    eaiExecuteService.eaiExecute(null, Object.class);
  }

  public void callMODC0010(InsuranceParameters parameters, Object fileList) throws Exception {
    String layoutId = SERVICE_LAYOUT_ID_3;
    eaiExecuteService.eaiExecute(null, Object.class);
  }

  public void callF1FCZ0045(InsuranceParameters parameters, Object files, ImclBrkdnDaoModel docInfo, String type) throws Exception {
    String layoutId = "F1FCZ0045";
    eaiExecuteService.eaiExecute(null, Object.class);
  }

  public int saveClamDocument(InsuranceParameters parameters, AccBenefitClaimInqrRes redisData) throws Exception {
    return imclBrkdnDao.insertClamDocument(null);
  }

  public ImclBrkdnDaoModel selectClamDocument(InsuranceParameters parameters, AccBenefitClaimInqrRes redisData) throws Exception {
    return imclBrkdnDao.selectClamDocument(null);
  }

  public int saveClamDocumentFile(InsuranceParameters parameters, Object files) throws Exception {
    return imclBrkdnDao.insertClamDocumentFile(null);
  }

  public int updateSubmitdate(InsuranceParameters parameters, ImclBrkdnDaoModel docInfo) throws Exception {
    return imclBrkdnDao.updateSubmitdate(null);
  }

  public Object moveConvertUploadFile(InsuranceParameters parameters, String custSeq, int fileSeq, String dcImclNo) throws Exception {
    return null;
  }

  public AccBenefitClaimInqrRes getRedisInfo(InsuranceParameters parameters) {
    return null;
  }
}`,
      "utf8"
    );

    const traces = await traceLinkedFlowDownstream({
      workspaceDir: workspace,
      linkedFlowEvidence: [
        {
          apiUrl: "/gw/api/insurance/accBenefit/claim/insert",
          backendControllerMethod: "AccBenefitClaimController.insertBenefitClaim",
          serviceHints: ["AccBenefitClaimService.saveBenefitClaim"]
        },
        {
          apiUrl: "/gw/api/insurance/accBenefit/claim/doc/insert",
          backendControllerMethod: "AccBenefitClaimController.insertBenefitClaimDoc",
          serviceHints: ["AccBenefitClaimService.saveBenefitClaimDoc"]
        }
      ],
      structure: {
        entries: {
          "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java": {
            path: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java",
            classes: [{ name: "AccBenefitClaimService" }],
            methods: [
              { name: "saveBenefitClaim", className: "AccBenefitClaimService" },
              { name: "saveBenefitClaimDoc", className: "AccBenefitClaimService" },
              { name: "callMODC0008", className: "AccBenefitClaimService" },
              { name: "callMODC0010", className: "AccBenefitClaimService" },
              { name: "callF1FCZ0045", className: "AccBenefitClaimService" },
              { name: "saveClamDocument", className: "AccBenefitClaimService" },
              { name: "selectClamDocument", className: "AccBenefitClaimService" },
              { name: "saveClamDocumentFile", className: "AccBenefitClaimService" },
              { name: "updateSubmitdate", className: "AccBenefitClaimService" },
              { name: "moveConvertUploadFile", className: "AccBenefitClaimService" },
              { name: "getRedisInfo", className: "AccBenefitClaimService" }
            ],
            functions: []
          }
        }
      }
    });

    const claimInsert = traces.find((item) => item.phase === "action-write");
    const docInsert = traces.find((item) => item.phase === "action-document");

    expect(claimInsert?.steps.join(" ")).toContain("getRedisInfo");
    expect(claimInsert?.steps.join(" ")).toContain("saveClamDocument");
    expect(docInsert?.steps.join(" ")).toContain("callMODC0008");
    expect(docInsert?.steps.join(" ")).toContain("callF1FCZ0045");
    expect(docInsert?.steps.join(" ")).toContain("saveClamDocumentFile");
    expect(docInsert?.eaiInterfaces).toEqual(expect.arrayContaining(["F13630020", "F13630014", "F1FCZ0045"]));
  });

  it("traces downstream only from preferred canonical flows when preferredFlowKeys are provided", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-flow-trace-canonical-"));
    tempDirs.push(workspace);

    const insuranceServiceDir = path.join(
      workspace,
      "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service"
    );
    const loanServiceDir = path.join(
      workspace,
      "dcp-loan/src/main/java/com/samsunglife/dcp/loan/request/service"
    );
    await mkdir(insuranceServiceDir, { recursive: true });
    await mkdir(loanServiceDir, { recursive: true });

    const insuranceServicePath = path.join(insuranceServiceDir, "AccBenefitClaimService.java");
    const loanServicePath = path.join(loanServiceDir, "RealtyCollateralLoanV2StatusService.java");

    await writeFile(
      insuranceServicePath,
      `package com.samsunglife.dcp.insurance.internet.service;

public class AccBenefitClaimService {
  public void saveBenefitClaimDoc(InsuranceParameters parameters) throws Exception {
    getRedisInfo(parameters);
    saveClamDocumentFile(parameters, null);
  }

  public void getRedisInfo(InsuranceParameters parameters) {}

  public void saveClamDocumentFile(InsuranceParameters parameters, Object files) {}
}
`,
      "utf8"
    );

    await writeFile(
      loanServicePath,
      `package com.samsunglife.dcp.loan.request.service;

public class RealtyCollateralLoanV2StatusService {
  public void updateHomes(LoanParameters parameters) throws Exception {
    checkAuth(parameters);
    updateHomesFamilyList(parameters);
  }

  public void checkAuth(LoanParameters parameters) {}

  public void updateHomesFamilyList(LoanParameters parameters) {}
}
`,
      "utf8"
    );

    const traces = await traceLinkedFlowDownstream({
      workspaceDir: workspace,
      linkedFlowEvidence: [
        {
          apiUrl: "/gw/api/insurance/accBenefit/claim/doc/insert",
          backendControllerMethod: "AccBenefitClaimController.insertBenefitClaimDoc",
          serviceHints: ["AccBenefitClaimService.saveBenefitClaimDoc"]
        },
        {
          apiUrl: "/gw/api/loan/v2/realty/request/house/collateral/status/homes/update",
          backendControllerMethod: "RealtyCollateralLoanV2StatusController.updateHomes",
          serviceHints: ["RealtyCollateralLoanV2StatusService.updateHomes"]
        }
      ],
      preferredFlowKeys: [
        "/gw/api/insurance/accBenefit/claim/doc/insert|AccBenefitClaimController.insertBenefitClaimDoc"
      ],
      structure: {
        entries: {
          "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java": {
            path: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java",
            classes: [{ name: "AccBenefitClaimService" }],
            methods: [
              { name: "saveBenefitClaimDoc", className: "AccBenefitClaimService" },
              { name: "getRedisInfo", className: "AccBenefitClaimService" },
              { name: "saveClamDocumentFile", className: "AccBenefitClaimService" }
            ],
            functions: []
          },
          "dcp-loan/src/main/java/com/samsunglife/dcp/loan/request/service/RealtyCollateralLoanV2StatusService.java": {
            path: "dcp-loan/src/main/java/com/samsunglife/dcp/loan/request/service/RealtyCollateralLoanV2StatusService.java",
            classes: [{ name: "RealtyCollateralLoanV2StatusService" }],
            methods: [
              { name: "updateHomes", className: "RealtyCollateralLoanV2StatusService" },
              { name: "checkAuth", className: "RealtyCollateralLoanV2StatusService" },
              { name: "updateHomesFamilyList", className: "RealtyCollateralLoanV2StatusService" }
            ],
            functions: []
          }
        }
      }
    });

    expect(traces).toHaveLength(1);
    expect(traces[0]?.backendControllerMethod).toBe(
      "AccBenefitClaimController.insertBenefitClaimDoc"
    );
    expect(traces[0]?.serviceMethod).toBe("AccBenefitClaimService.saveBenefitClaimDoc");
    expect(traces[0]?.steps.join(" ")).toContain("getRedisInfo");
    expect(traces[0]?.steps.join(" ")).toContain("saveClamDocumentFile");
  });
});
