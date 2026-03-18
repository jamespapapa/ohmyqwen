import { afterEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { buildDeterministicExactTraceAnswer } from "../src/server/projects.js";

describe("deterministic exact trace answer", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("derives exact endpoint and workflow-sequence traces from controller and service code", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-deterministic-trace-"));
    const controllerDir = path.join(
      tempDir,
      "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/controller"
    );
    const serviceDir = path.join(
      tempDir,
      "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service"
    );
    await mkdir(controllerDir, { recursive: true });
    await mkdir(serviceDir, { recursive: true });

    const controllerPath = path.join(controllerDir, "AccBenefitClaimController.java");
    const servicePath = path.join(serviceDir, "AccBenefitClaimService.java");

    await writeFile(
      controllerPath,
      `package com.example;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
public class AccBenefitClaimController {
  private AccBenefitClaimService accBenefitClaimService;
  @RequestMapping(value = "/accBenefit/claim/spotSave", method = {RequestMethod.POST})
  public JsonResult spotSave(InsuranceParameters parameters) throws Exception {
    AccBenefitClaimInqrRes res = accBenefitClaimService.spotSave(parameters);
    return resolveResponse(res);
  }
  @RequestMapping(value = "/accBenefit/claim/validate", method = {RequestMethod.POST})
  public JsonResult validateAccBenefitClaimInfo(InsuranceParameters parameters) throws Exception {
    InsuranceCommonResponse rslt = accBenefitClaimService.getRedisInfo(parameters);
    return resolveResponse(rslt);
  }
  @RequestMapping(value = "/accBenefit/claim/insert", method = {RequestMethod.POST})
  public JsonResult insertBenefitClaim(InsuranceParameters parameters) throws Exception {
    InsuranceCommonResponse rslt = accBenefitClaimService.saveBenefitClaim(parameters);
    return resolveResponse(rslt);
  }
  @RequestMapping(value = "/accBenefit/claim/doc/insert", method = {RequestMethod.POST})
  public JsonResult insertBenefitClaimDoc(InsuranceParameters parameters) throws Exception {
    if (StringUtil.isNullOrEmpty(parameters.getUploadKey())) {
      accBenefitClaimService.sendLmsTok(parameters);
      throw new BizMessageException("FAIL");
    }
    try {
      accBenefitClaimService.saveBenefitClaimDoc(parameters);
    } catch (Exception e) {
      redisDataSupport.delete("REDIS_IMG_CHECK", parameters.getUserProxy().getCustId());
      accBenefitClaimService.sendLmsTok(parameters);
      throw e;
    }
    redisDataSupport.delete("REDIS_IMG_CHECK", parameters.getUserProxy().getCustId());
    return resolveResponse(1);
  }
}
`,
      "utf8"
    );

    await writeFile(
      servicePath,
      `package com.example;
public class AccBenefitClaimService {
  public AccBenefitClaimInqrRes spotSave(InsuranceParameters parameters) throws Exception {
    AccBenefitClaimInqrRes redisData = getRedisInfo(parameters);
    setRedis(parameters, redisData);
    return redisData;
  }
  public InsuranceCommonResponse saveBenefitClaim(InsuranceParameters parameters) throws Exception {
    AccBenefitClaimInqrRes redisData = getRedisInfo(parameters);
    int inRslt = saveClamDocument(parameters, redisData);
    return resolveInsuranceCommonResponse(inRslt);
  }
  public ImclBrkdnDaoModel saveBenefitClaimDoc(InsuranceParameters parameters) throws Exception {
    AccBenefitClaimInqrRes redisData = getRedisInfo(parameters);
    selectClamDocument(parameters, redisData);
    callMODC0008(parameters);
    moveConvertUploadFile(parameters);
    callMODC0010(parameters);
    callF1FCZ0045(parameters);
    saveClamDocumentFile(parameters);
    updateSubmitdate(parameters);
    deleteRedis(parameters);
    return new ImclBrkdnDaoModel();
  }
}
`,
      "utf8"
    );

    const structure = {
      version: 1,
      generatedAt: "2026-03-18T00:00:00.000Z",
      workspaceDir: tempDir,
      stats: {
        fileCount: 2,
        packageCount: 1,
        classCount: 2,
        methodCount: 7,
        changedFiles: 2,
        reusedFiles: 0
      },
      topPackages: [],
      topMethods: [],
      entries: {
        "controller": {
          path: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/controller/AccBenefitClaimController.java",
          size: 1,
          mtimeMs: 1,
          hash: "controller",
          packageName: "com.example",
          classes: [{ name: "AccBenefitClaimController", line: 3 }],
          methods: [
            { name: "spotSave", line: 6, className: "AccBenefitClaimController" },
            { name: "validateAccBenefitClaimInfo", line: 11, className: "AccBenefitClaimController" },
            { name: "insertBenefitClaim", line: 16, className: "AccBenefitClaimController" },
            { name: "insertBenefitClaimDoc", line: 21, className: "AccBenefitClaimController" }
          ],
          functions: [],
          calls: [],
          summary: "controller"
        },
        "service": {
          path: "dcp-insurance/src/main/java/com/samsunglife/dcp/insurance/internet/service/AccBenefitClaimService.java",
          size: 1,
          mtimeMs: 1,
          hash: "service",
          packageName: "com.example",
          classes: [{ name: "AccBenefitClaimService", line: 2 }],
          methods: [
            { name: "spotSave", line: 3, className: "AccBenefitClaimService" },
            { name: "saveBenefitClaim", line: 8, className: "AccBenefitClaimService" },
            { name: "saveBenefitClaimDoc", line: 13, className: "AccBenefitClaimService" }
          ],
          functions: [],
          calls: [],
          summary: "service"
        }
      }
    } as any;

    const result = await buildDeterministicExactTraceAnswer({
      project: { workspaceDir: tempDir } as any,
      question:
        "보험금 청구 로직 내에서, AccBenefitClaimController 안에 claim/doc/insert api가 있어. 이 api가 하는 일을 면밀히 분석해줘. 또 그 api를 호출하기 전에, spotSave, validate, insert, doc/insert 순으로 호출하는데, 이 흐름도 면밀히 분석해줘",
      structure
    });

    expect(result?.kind).toBe("exact-trace");
    expect(result?.symbol).toBe("AccBenefitClaimController.insertBenefitClaimDoc");
    expect(result?.answer).toContain("/accBenefit/claim/doc/insert");
    expect(result?.answer).toContain("AccBenefitClaimService.saveBenefitClaimDoc");
    expect(result?.answer).toContain("spotSave");
    expect(result?.answer).toContain("validate");
    expect(result?.answer).toContain("/accBenefit/claim/insert");
    expect(result?.answer).toContain("callF1FCZ0045");
    expect(result?.answer).toContain("sendLmsTok");
    expect(result?.answer).not.toContain("insertBenefitClaimDoc`: 저장/등록 단계");
    expect(result?.hydratedEvidence).toHaveLength(2);
    expect(result?.hydratedEvidence[0]?.reason).toBe("symbol:AccBenefitClaimController.insertBenefitClaimDoc");
    expect(result?.hydratedEvidence[1]?.reason).toBe("callee:AccBenefitClaimService.saveBenefitClaimDoc");
  });
});
