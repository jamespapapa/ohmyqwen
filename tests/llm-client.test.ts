import { afterEach, describe, expect, it, vi } from "vitest";
import { packContext } from "../src/context/packer.js";
import { OpenAICompatibleLlmClient } from "../src/llm/client.js";

const baseInput = {
  taskId: "llm-test",
  objective: "test basic auth",
  constraints: [],
  files: [],
  symbols: [],
  errorLogs: [],
  diffSummary: [],
  contextTier: "small" as const,
  contextTokenBudget: 1200,
  retryPolicy: {
    maxAttempts: 2,
    backoffMs: 0,
    sameFailureLimit: 2,
    rollbackOnVerifyFail: false
  },
  mode: "feature" as const,
  clarificationAnswers: [],
  dryRun: false
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenAICompatibleLlmClient auth headers", () => {
  it("sends Basic auth header when basicAuth is provided (user/password format)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"summary":"ok","steps":["1"]}' } }]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      basicAuth: "opencode/mypassword"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "PLAN"
    });

    await client.proposePlan({
      input: baseInput,
      context
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;
    const expected = Buffer.from("opencode:mypassword", "utf8").toString("base64");

    expect(headers.Authorization).toBe(`Basic ${expected}`);
  });

  it("falls back to Bearer token when Basic auth is not configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"summary":"ok","steps":["1"]}' } }]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      apiKey: "secret-token"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "PLAN"
    });

    await client.proposePlan({
      input: baseInput,
      context
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;

    expect(headers.Authorization).toBe("Bearer secret-token");
  });

  it("surfaces OpenCode provider errors when message response has no text parts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<!doctype html><html></html>", {
          status: 200,
          headers: { "content-type": "text/html;charset=utf-8" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "ses_demo" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            info: {
              error: {
                name: "UnknownError",
                data: {
                  message: "Error: Token refresh failed: 401"
                }
              },
              modelID: "gpt-5.3-codex",
              providerID: "openai"
            },
            parts: []
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      basicAuth: "opencode/mypassword"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "PLAN"
    });

    await expect(
      client.proposePlan({
        input: baseInput,
        context
      })
    ).rejects.toThrow(
      "OpenCode response has no text parts: Error: Token refresh failed: 401 (openai:gpt-5.3-codex)"
    );
  });

  it("auto-detects OpenCode server and uses session/message API when /v1 returns html", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<!doctype html><html></html>", {
          status: 200,
          headers: { "content-type": "text/html;charset=utf-8" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "ses_demo" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            parts: [{ type: "text", text: '{"summary":"ok","steps":["1"]}' }]
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      basicAuth: "opencode/mypassword"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "PLAN"
    });

    const result = await client.proposePlan({
      input: baseInput,
      context
    });

    expect(result.trace.endpoint).toContain("/session/{sessionId}/message");
    expect(result.output.summary).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/v1/chat/completions");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/session");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("/session/ses_demo/message");
  });

  it("coerces plan arrays when model returns object items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "plan",
                  steps: [{ title: "step-1" }, { text: "step-2" }],
                  risks: [{ summary: "risk-1" }]
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "PLAN"
    });

    const result = await client.proposePlan({
      input: baseInput,
      context
    });

    expect(result.output.steps).toEqual(["step-1", "step-2"]);
    expect(result.output.risks).toEqual(["risk-1"]);
  });

  it("repairs malformed json with unquoted localized values", async () => {
    const malformed =
      '{"summary":"ok","steps":["s1"],"risks":[{"impact": 초기화/실행 불가}],"targetSymbols":[],"successCriteria":[]}';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: malformed
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "PLAN"
    });

    const result = await client.proposePlan({
      input: baseInput,
      context
    });

    expect(result.output.summary).toBe("ok");
    expect(result.output.risks).toEqual(["초기화/실행 불가"]);
  });

  it("repairs malformed json with unescaped quotes/newlines inside strings", async () => {
    const malformed =
      '{\n  "summary":"ok",\n  "steps":[{"id":1,"name":"사전 점검 "Node 버전" 확인\n완료"}],\n  "risks":[],\n  "targetSymbols":[],\n  "successCriteria":[]\n}';

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: malformed
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "PLAN"
    });

    const result = await client.proposePlan({
      input: baseInput,
      context
    });

    expect(result.output.summary).toBe("ok");
    expect(result.output.steps[0]).toContain("사전 점검");
    expect(result.output.steps[0]).toContain("Node 버전");
  });

  it("coerces implement output when model uses alternate field names", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "impl",
                  changes: [
                    { file: "package.json", change: "add start script" },
                    { file: "index.js", change: "add hello world" }
                  ],
                  actions: [
                    { action: "create_file", file: "index.js", text: "console.log('Hello World')" },
                    {
                      action: "patch",
                      file: "package.json",
                      old: "\"scripts\": {}",
                      new: "\"scripts\": {\"start\":\"node index.js\"}"
                    },
                    { action: "run", command: "npm", args: ["run", "start"] }
                  ],
                  notes: [{ text: "keep changes minimal" }]
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    const result = await client.proposeImplementation({
      input: baseInput,
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    expect(result.output.changes).toHaveLength(2);
    expect(result.output.actions).toHaveLength(3);
    expect(result.output.actions[0]?.type).toBe("write_file");
    expect(result.output.actions[1]?.type).toBe("patch_file");
    expect(result.output.actions[2]?.type).toBe("run_command");
    if (result.output.actions[2]?.type === "run_command") {
      expect(result.output.actions[2].command).toBe("npm");
      expect(result.output.actions[2].args).toEqual(["run", "start"]);
    }
  });

  it("normalizes pnpm prefix options before script command and strips shell control tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "impl",
                  changes: [{ file: "hello-world-node/package.json", change: "create script" }],
                  actions: [
                    { action: "run", command: "node", args: ["-v", "&&", "npm", "-v"] },
                    { action: "run", command: "pnpm", args: ["run", "start", "--prefix", "hello-world-node"] }
                  ],
                  notes: []
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    const result = await client.proposeImplementation({
      input: baseInput,
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    expect(result.output.actions).toHaveLength(2);
    expect(result.output.actions[0]?.type).toBe("run_command");
    expect(result.output.actions[1]?.type).toBe("run_command");

    if (result.output.actions[0]?.type === "run_command") {
      expect(result.output.actions[0].command).toBe("node");
      expect(result.output.actions[0].args).toEqual(["-v"]);
    }

    if (result.output.actions[1]?.type === "run_command") {
      expect(result.output.actions[1].command).toBe("npm");
      expect(result.output.actions[1].args).toEqual(["--prefix", "hello-world-node", "run", "start"]);
    }
  });

  it("normalizes env-assignment command prefixes and drops blocked curl actions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "impl",
                  changes: [{ file: "hello-world-node/server.js", change: "create file" }],
                  actions: [
                    {
                      action: "run",
                      command: "PORT=3001",
                      args: ["pnpm", "run", "start", "--prefix", "hello-world-node"]
                    },
                    { action: "run", command: "curl", args: ["http://localhost:3001"] }
                  ],
                  notes: []
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    const result = await client.proposeImplementation({
      input: baseInput,
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    expect(result.output.actions).toHaveLength(1);
    expect(result.output.actions[0]?.type).toBe("run_command");
    if (result.output.actions[0]?.type === "run_command") {
      expect(result.output.actions[0].command).toBe("npm");
      expect(result.output.actions[0].args).toEqual(["--prefix", "hello-world-node", "run", "start"]);
    }
  });

  it("normalizes npm pkg commands without converting them to run scripts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "impl",
                  changes: [{ file: "package.json", change: "set start script" }],
                  actions: [{ action: "run", command: "npm", args: ["pkg", "set", "scripts.start=node index.js"] }],
                  notes: []
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    const result = await client.proposeImplementation({
      input: baseInput,
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    expect(result.output.actions).toHaveLength(1);
    expect(result.output.actions[0]?.type).toBe("run_command");
    if (result.output.actions[0]?.type === "run_command") {
      expect(result.output.actions[0].command).toBe("npm");
      expect(result.output.actions[0].args).toEqual(["pkg", "set", "scripts.start=node index.js"]);
    }
  });

  it("drops inline node -e run actions from LLM output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "impl",
                  changes: [{ file: "index.js", change: "print hello world" }],
                  actions: [
                    { action: "run", command: "node", args: ["-e", "const a='x'; console.log(a);"] },
                    { action: "run", command: "pnpm", args: ["run", "start"] }
                  ],
                  notes: []
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    const result = await client.proposeImplementation({
      input: baseInput,
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    expect(result.output.actions).toHaveLength(1);
    expect(result.output.actions[0]?.type).toBe("run_command");
    if (result.output.actions[0]?.type === "run_command") {
      expect(result.output.actions[0].command).toBe("npm");
      expect(result.output.actions[0].args).toEqual(["run", "start"]);
    }
  });

  it("adds server-oriented objective hints when express API requirements are explicit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "impl",
                  changes: [],
                  actions: [{ action: "run", command: "pnpm", args: ["run", "start"] }],
                  notes: []
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const context = packContext({
      objective:
        "Node.js로 Hello World 프로젝트를 만들고 express 최신버전 REST API /hello를 만들고 npm run start로 실행.",
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    await client.proposeImplementation({
      input: {
        ...baseInput,
        objective:
          "Node.js로 Hello World 프로젝트를 만들고 express 최신버전 REST API /hello를 만들고 npm run start로 실행."
      },
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = payload.messages.find((entry) => entry.role === "user");
    expect(userMessage).toBeTruthy();

    const userPayload = JSON.parse(userMessage?.content ?? "{}") as {
      objectiveHints?: string[];
    };

    expect(userPayload.objectiveHints?.some((hint) => hint.includes("API/server behavior"))).toBe(true);
    expect(userPayload.objectiveHints?.some((hint) => hint.includes("minimal CLI hello-world"))).toBe(
      false
    );
  });

  it("adds Spring-specific objective hints and avoids express bias for Spring objectives", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "impl",
                  changes: [],
                  actions: [],
                  notes: []
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const objective =
      "springboot 기본 프로젝트를 생성하고 /hello 엔드포인트를 추가한다음 Hello World! 라고 출력해줘. 빌드는 gradle, springboot는 3 이상";

    const context = packContext({
      objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    await client.proposeImplementation({
      input: {
        ...baseInput,
        objective
      },
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = payload.messages.find((entry) => entry.role === "user");
    expect(userMessage).toBeTruthy();

    const userPayload = JSON.parse(userMessage?.content ?? "{}") as {
      objectiveHints?: string[];
    };

    expect(
      userPayload.objectiveHints?.some((hint) => hint.includes("Spring Boot/Java"))
    ).toBe(true);
    expect(
      userPayload.objectiveHints?.some((hint) => hint.includes("express-based server files"))
    ).toBe(false);
  });

  it("includes dependencyPolicy and allowlist hint when availableLibraries are provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "impl",
                  changes: [],
                  actions: [],
                  notes: []
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const objective = "Node.js REST API를 만들고 /hello를 제공해.";
    const context = packContext({
      objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    await client.proposeImplementation({
      input: {
        ...baseInput,
        objective,
        availableLibraries: ["express", "zod"]
      },
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = payload.messages.find((entry) => entry.role === "user");
    const userPayload = JSON.parse(userMessage?.content ?? "{}") as {
      objectiveHints?: string[];
      dependencyPolicy?: { allowlistOnly?: boolean; availableLibraries?: string[] };
    };

    expect(userPayload.dependencyPolicy?.allowlistOnly).toBe(true);
    expect(userPayload.dependencyPolicy?.availableLibraries).toEqual(["express", "zod"]);
    expect(
      userPayload.objectiveHints?.some((hint) => hint.includes("Dependency allowlist is active"))
    ).toBe(true);
  });

  it("removes run_command actions for Spring objective during IMPLEMENT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "impl",
                  changes: [{ path: "build.gradle", summary: "configure spring boot" }],
                  actions: [
                    { type: "write_file", path: "build.gradle", content: "plugins {}" },
                    { type: "run_command", command: "gradle", args: ["wrapper", "--gradle-version", "8.10.2"] },
                    { type: "run_command", command: "./gradlew", args: ["clean", "build"] }
                  ],
                  notes: []
                })
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const objective =
      "springboot 기본 프로젝트를 생성하고, /hello 엔드포인트를 추가한다음. Hello World! 라고 출력해줘. 빌드는 gradle, springboot는 3 이상 버전";

    const context = packContext({
      objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    const result = await client.proposeImplementation({
      input: {
        ...baseInput,
        objective
      },
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    expect(result.output.actions).toHaveLength(1);
    expect(result.output.actions[0]?.type).toBe("write_file");
    expect(result.output.notes.some((note) => note.includes("removed for Spring objective"))).toBe(true);
  });

  it("retries once when implementation response is invalid JSON and succeeds on repaired response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{ "summary": "bad", "changes": [ { "path": "package.json", "summary": "x" } ], "actions": ['
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "impl",
                    changes: [{ path: "package.json", summary: "add start script" }],
                    actions: [{ type: "run_command", command: "npm", args: ["run", "start"] }],
                    notes: []
                  })
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const context = packContext({
      objective: baseInput.objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    const result = await client.proposeImplementation({
      input: baseInput,
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    expect(result.output.summary).toBe("impl");
    expect(result.output.actions[0]?.type).toBe("run_command");
    if (result.output.actions[0]?.type === "run_command") {
      expect(result.output.actions[0].command).toBe("npm");
      expect(result.output.actions[0].args).toEqual(["run", "start"]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to deterministic implementation when both attempts return invalid JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{ "summary": "bad", "changes": [ { "path": "package.json", "summary": "x" } ], "actions": ['
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "{ \"summary\": \"still bad\", \"actions\": ["
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const context = packContext({
      objective:
        "Node.js로 Hello World 프로젝트를 생성해줘. express 최신버전 rest api와 /hello endpoint, npm run start 요구.",
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    const result = await client.proposeImplementation({
      input: {
        ...baseInput,
        objective:
          "Node.js로 Hello World 프로젝트를 생성해줘. express 최신버전 rest api와 /hello endpoint, npm run start 요구."
      },
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    expect(result.output.summary).toContain("Implementation fallback");
    expect(result.output.actions.some((action) => action.type === "write_file")).toBe(true);
    expect(result.output.actions.some((action) => action.type === "run_command")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to Spring Boot baseline when spring objective responses are invalid JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{ "summary": "bad", "changes": [ { "path": "build.gradle", "summary": "x" } ],'
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "{ \"summary\": \"still bad\", \"actions\": ["
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const objective =
      "springboot 기본 프로젝트를 생성하고, /hello 엔드포인트를 추가한다음. Hello World! 라고 출력해줘. 빌드는 gradle, springboot는 3 이상 버전";

    const context = packContext({
      objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    const result = await client.proposeImplementation({
      input: {
        ...baseInput,
        objective
      },
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    expect(result.output.summary).toContain("Spring Boot baseline");
    expect(result.output.actions.every((action) => action.type === "write_file")).toBe(true);
    expect(result.output.actions.some((action) => action.type === "run_command")).toBe(false);
    expect(result.output.changes.some((change) => change.path === "build.gradle")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("defaults Spring fallback to Maven when build tool is not explicitly requested", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{ "summary": "bad", "changes": [ { "path": "pom.xml", "summary": "x" } ],'
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "{ \"summary\": \"still bad\", \"actions\": ["
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const objective = "springboot 3을 사용해서 /hello 엔드포인트가 있는 hello world 프로젝트를 만들어줘";

    const context = packContext({
      objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    const result = await client.proposeImplementation({
      input: {
        ...baseInput,
        objective
      },
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    expect(result.output.summary).toContain("Spring Boot baseline (maven)");
    expect(result.output.actions.every((action) => action.type === "write_file")).toBe(true);
    expect(result.output.changes.some((change) => change.path === "pom.xml")).toBe(true);
  });

  it("builds member CRUD Spring fallback for member+h2+jpa objectives", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{ "summary": "bad", "changes": [ { "path": "pom.xml", "summary": "x" } ],'
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "{ \"summary\": \"still bad\", \"actions\": ["
                }
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenAICompatibleLlmClient({
      baseUrl: "http://localhost:4096",
      model: "openai/gpt-5.2",
      endpointKind: "openai"
    });

    const objective =
      "springboot 3을 사용해서 기본 helloworld 프로젝트를 만들어줘. member를 h2DB 로 저장하고, 수정/삭제/조회 할 수 있는 기본 CRUD 애플리케이션이어야해. JPA를 사용해줘.";

    const context = packContext({
      objective,
      constraints: [],
      symbols: [],
      errorLogs: [],
      diffSummary: [],
      tier: "small",
      tokenBudget: 1000,
      stage: "IMPLEMENT"
    });

    const result = await client.proposeImplementation({
      input: {
        ...baseInput,
        objective
      },
      plan: {
        summary: "plan",
        steps: ["step-1"],
        risks: [],
        targetSymbols: [],
        successCriteria: []
      },
      context,
      patchAttempt: 0,
      strategy: "focused-fix"
    });

    expect(result.output.actions.every((action) => action.type === "write_file")).toBe(true);
    expect(result.output.changes.some((change) => change.path.includes("MemberController"))).toBe(true);
    expect(result.output.changes.some((change) => change.path.includes("MemberRepository"))).toBe(true);
    expect(result.output.changes.some((change) => change.path === "src/main/resources/application.properties")).toBe(
      true
    );
  });
});
