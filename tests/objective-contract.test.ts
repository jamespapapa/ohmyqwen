import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runObjectiveContractGate } from "../src/gates/objective-contract.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("objective contract gate", () => {
  it("passes for express hello endpoint contract when scripts and source are aligned", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-objective-pass-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });

    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify(
        {
          name: "hello-world-express",
          version: "1.0.0",
          scripts: {
            start: "node src/server.js"
          },
          dependencies: {
            express: "latest"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await writeFile(
      path.join(workspace, "src/server.js"),
      "const express = require('express'); const app = express(); app.get('/hello', (_req, res) => res.send('Hello World!')); app.listen(process.env.PORT || 3000);",
      "utf8"
    );

    const gate = await runObjectiveContractGate({
      objective:
        "Node.js로 Hello World 프로젝트를 생성해줘. express 최신버전 rest api, /hello 엔드포인트에서 Hello World! 리턴. npm run start로 기동.",
      cwd: workspace,
      runSmoke: false
    });

    expect(gate).toBeTruthy();
    expect(gate?.name).toBe("objective-contract");
    expect(gate?.passed).toBe(true);
  });

  it("fails when objective requires npm run start but scripts.start is missing", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-objective-no-start-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });

    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify(
        {
          name: "hello-world-express",
          version: "1.0.0",
          scripts: {},
          dependencies: {
            express: "latest"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await writeFile(
      path.join(workspace, "src/server.js"),
      "const express = require('express'); const app = express(); app.get('/hello', (_req, res) => res.send('Hello World!'));",
      "utf8"
    );

    const gate = await runObjectiveContractGate({
      objective: "express REST API를 만들고 npm run start 실행 시 서버가 떠야 한다.",
      cwd: workspace,
      runSmoke: false
    });

    expect(gate).toBeTruthy();
    expect(gate?.passed).toBe(false);
    expect(gate?.details.toLowerCase()).toContain("scripts.start");
  });

  it("fails when objective requires npm run serve but scripts.serve is missing", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-objective-no-serve-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });

    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify(
        {
          name: "hello-world-express",
          version: "1.0.0",
          scripts: {
            start: "node src/server.js"
          },
          dependencies: {
            express: "latest"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await writeFile(
      path.join(workspace, "src/server.js"),
      "const express = require('express'); const app = express(); app.get('/hello', (_req, res) => res.send('Hello World!')); app.listen(process.env.PORT || 3000);",
      "utf8"
    );

    const gate = await runObjectiveContractGate({
      objective: "express API를 만들고 npm run serve 로 서버가 떠야 한다.",
      cwd: workspace,
      runSmoke: false
    });

    expect(gate).toBeTruthy();
    expect(gate?.passed).toBe(false);
    expect(gate?.details.toLowerCase()).toContain("scripts.serve");
  });

  it("fails when endpoint response text required by objective is missing from source", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-objective-body-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src"), { recursive: true });

    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify(
        {
          name: "hello-world-express",
          version: "1.0.0",
          scripts: {
            start: "node src/server.js"
          },
          dependencies: {
            express: "latest"
          }
        },
        null,
        2
      ),
      "utf8"
    );

    await writeFile(
      path.join(workspace, "src/server.js"),
      "const express = require('express'); const app = express(); app.get('/hello', (_req, res) => res.send('Hi')); app.listen(process.env.PORT || 3000);",
      "utf8"
    );

    const gate = await runObjectiveContractGate({
      objective:
        "/hello 엔드포인트가 존재하며, Hello World! 라는 텍스트를 리턴한다. npm run start로 구동.",
      cwd: workspace,
      runSmoke: false
    });

    expect(gate).toBeTruthy();
    expect(gate?.passed).toBe(false);
    expect(gate?.details).toContain("Hello World!");
  });

  it("supports Spring Boot + Gradle objective without requiring package.json", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-objective-spring-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src/main/java/com/example/demo"), { recursive: true });
    await mkdir(path.join(workspace, "src/test/java/com/example/demo"), { recursive: true });

    await writeFile(
      path.join(workspace, "build.gradle"),
      [
        "plugins {",
        "  id 'java'",
        "  id 'org.springframework.boot' version '3.3.2'",
        "  id 'io.spring.dependency-management' version '1.1.6'",
        "}",
        "repositories { mavenCentral() }",
        "dependencies { implementation 'org.springframework.boot:spring-boot-starter-web' }"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(workspace, "src/main/java/com/example/demo/HelloController.java"),
      [
        "package com.example.demo;",
        "import org.springframework.web.bind.annotation.GetMapping;",
        "import org.springframework.web.bind.annotation.RestController;",
        "@RestController",
        "public class HelloController {",
        "  @GetMapping(\"/hello\")",
        "  public String hello() { return \"Hello World!\"; }",
        "}"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(workspace, "src/test/java/com/example/demo/HelloControllerTest.java"),
      [
        "package com.example.demo;",
        "import org.junit.jupiter.api.Test;",
        "class HelloControllerTest {",
        "  @Test",
        "  void contract() {",
        "    String endpoint = \"/hello\";",
        "    String expected = \"Hello World!\";",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );

    const gate = await runObjectiveContractGate({
      objective:
        "springboot 기본 프로젝트를 생성하고 /hello 엔드포인트에서 Hello World! 출력, gradle 빌드 사용, springboot 3 이상",
      cwd: workspace,
      runSmoke: false
    });

    expect(gate).toBeTruthy();
    expect(gate?.passed).toBe(true);
  });

  it("accepts Hello World text without exclamation for Spring objective", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-objective-spring-plain-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src/main/java/com/example/demo"), { recursive: true });
    await mkdir(path.join(workspace, "src/test/java/com/example/demo"), { recursive: true });

    await writeFile(
      path.join(workspace, "pom.xml"),
      [
        "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"",
        "         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"",
        "         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">",
        "  <modelVersion>4.0.0</modelVersion>",
        "  <parent>",
        "    <groupId>org.springframework.boot</groupId>",
        "    <artifactId>spring-boot-starter-parent</artifactId>",
        "    <version>3.3.2</version>",
        "    <relativePath/>",
        "  </parent>",
        "  <groupId>com.example</groupId>",
        "  <artifactId>demo</artifactId>",
        "  <version>0.0.1-SNAPSHOT</version>",
        "</project>"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(workspace, "src/main/java/com/example/demo/HelloController.java"),
      [
        "package com.example.demo;",
        "import org.springframework.web.bind.annotation.GetMapping;",
        "import org.springframework.web.bind.annotation.RestController;",
        "@RestController",
        "public class HelloController {",
        "  @GetMapping(\"/hello\")",
        "  public String hello() { return \"Hello World\"; }",
        "}"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(workspace, "src/test/java/com/example/demo/HelloControllerTest.java"),
      [
        "package com.example.demo;",
        "import org.junit.jupiter.api.Test;",
        "class HelloControllerTest {",
        "  @Test",
        "  void contract() {",
        "    String endpoint = \"/hello\";",
        "    String expected = \"Hello World\";",
        "  }",
        "}"
      ].join("\n"),
      "utf8"
    );

    const gate = await runObjectiveContractGate({
      objective:
        "springboot 3을 사용해서 기본 helloworld 프로젝트를 만들어줘. /hello 엔드포인트가 존재하고, Hello World 텍스트를 출력해야해.",
      cwd: workspace,
      runSmoke: false
    });

    expect(gate).toBeTruthy();
    expect(gate?.passed).toBe(true);
  });

  it("fails when Spring objective has no endpoint contract test", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-objective-spring-no-test-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src/main/java/com/example/demo"), { recursive: true });

    await writeFile(
      path.join(workspace, "pom.xml"),
      [
        "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"",
        "         xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"",
        "         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">",
        "  <modelVersion>4.0.0</modelVersion>",
        "  <parent>",
        "    <groupId>org.springframework.boot</groupId>",
        "    <artifactId>spring-boot-starter-parent</artifactId>",
        "    <version>3.3.2</version>",
        "    <relativePath/>",
        "  </parent>",
        "  <groupId>com.example</groupId>",
        "  <artifactId>demo</artifactId>",
        "  <version>0.0.1-SNAPSHOT</version>",
        "</project>"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(workspace, "src/main/java/com/example/demo/HelloController.java"),
      [
        "package com.example.demo;",
        "import org.springframework.web.bind.annotation.GetMapping;",
        "import org.springframework.web.bind.annotation.RestController;",
        "@RestController",
        "public class HelloController {",
        "  @GetMapping(\"/hello\")",
        "  public String hello() { return \"Hello World!\"; }",
        "}"
      ].join("\n"),
      "utf8"
    );

    const gate = await runObjectiveContractGate({
      objective:
        "springboot 3을 사용해서 기본 helloworld 프로젝트를 만들어줘. /hello 엔드포인트가 존재하고, Hello World 텍스트를 출력해야해.",
      cwd: workspace,
      runSmoke: false
    });

    expect(gate).toBeTruthy();
    expect(gate?.passed).toBe(false);
    expect(gate?.details).toContain("automated test");
  });

  it("fails member CRUD objective when JPA/H2/CRUD requirements are missing", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "ohmyqwen-objective-spring-member-miss-"));
    tempDirs.push(workspace);
    await mkdir(path.join(workspace, "src/main/java/com/example/demo"), { recursive: true });
    await mkdir(path.join(workspace, "src/test/java/com/example/demo"), { recursive: true });

    await writeFile(
      path.join(workspace, "pom.xml"),
      [
        "<project xmlns=\"http://maven.apache.org/POM/4.0.0\">",
        "  <modelVersion>4.0.0</modelVersion>",
        "  <groupId>com.example</groupId>",
        "  <artifactId>demo</artifactId>",
        "  <version>0.0.1-SNAPSHOT</version>",
        "</project>"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(workspace, "src/main/java/com/example/demo/HelloController.java"),
      [
        "package com.example.demo;",
        "import org.springframework.web.bind.annotation.GetMapping;",
        "import org.springframework.web.bind.annotation.RestController;",
        "@RestController",
        "public class HelloController {",
        "  @GetMapping(\"/hello\")",
        "  public String hello() { return \"Hello World\"; }",
        "}"
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      path.join(workspace, "src/test/java/com/example/demo/HelloControllerTest.java"),
      [
        "package com.example.demo;",
        "import org.junit.jupiter.api.Test;",
        "class HelloControllerTest {",
        "  @Test void smoke() {}",
        "}"
      ].join("\n"),
      "utf8"
    );

    const gate = await runObjectiveContractGate({
      objective:
        "springboot 3을 사용해서 기본 helloworld 프로젝트를 만들어줘. member를 h2DB 로 저장하고, 수정/삭제/조회 할 수 있는 기본 CRUD 애플리케이션이어야해. JPA를 사용해줘.",
      cwd: workspace,
      runSmoke: false
    });

    expect(gate).toBeTruthy();
    expect(gate?.passed).toBe(false);
    expect(gate?.details).toMatch(/JPA requirement|H2 requirement|CRUD requirement|Member/);
  });
});
