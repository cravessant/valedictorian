import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function readText(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8")
}

function readPublishedDeclarations(packageDirectory: string) {
  return fs
    .readdirSync(path.resolve(packageDirectory, "dist"))
    .filter((entry) => entry.endsWith(".d.ts"))
    .sort()
    .map((entry) => readText(path.join(packageDirectory, "dist", entry)))
    .join("\n")
}

function readPackageJson(relativePath: string) {
  return JSON.parse(readText(relativePath)) as {
    dependencies?: Record<string, string>
    exports?: { "."?: { import?: string; types?: string } }
    files?: string[]
    homepage?: string
    license?: string
    name?: string
    private?: boolean
    publishConfig?: { access?: string; registry?: string }
    repository?: { directory?: string; type?: string; url?: string }
    scripts?: Record<string, string>
    types?: string
    version?: string
  }
}

function readProviderNeutralSources() {
  const sources: string[] = []
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(path.resolve(directory), { withFileTypes: true })) {
      const relativePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        visit(relativePath)
      } else if (entry.name.endsWith(".ts") && entry.name !== "repo-conventions.test.ts") {
        sources.push(relativePath)
      }
    }
  }
  visit("packages/connector-api/src")
  visit("packages/connector-testkit/src")
  return sources
}

describe("connector repository conventions", () => {
  it("owns only provider-neutral packages", () => {
    const workspace = readText("pnpm-workspace.yaml")

    expect(workspace).toContain('- "packages/connector-api"')
    expect(workspace).toContain('- "packages/connector-testkit"')
    expect(workspace).not.toContain('- "packages/api"')
    expect(workspace).not.toContain('- "packages/testkit"')
    expect(workspace).not.toContain('packages/*')
    expect(fs.existsSync(path.resolve("packages/connector-api"))).toBe(true)
    expect(fs.existsSync(path.resolve("packages/connector-testkit"))).toBe(true)
    expect(fs.existsSync(path.resolve("packages/jobright"))).toBe(false)
  })

  it("keeps destination paths while retaining package identities", () => {
    const rootPackage = readPackageJson("package.json")
    const corePackage = readPackageJson("packages/connector-api/package.json")
    const harnessPackage = readPackageJson("packages/connector-testkit/package.json")

    expect(rootPackage.private).toBe(true)
    expect(rootPackage.scripts?.["test:local"]).toBeUndefined()
    expect(corePackage).toMatchObject({
      name: "@sparxie/valedictorian-connectors-core",
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org/",
      },
      files: ["dist"],
      homepage: "https://github.com/cravessant/valedictorian#readme",
      license: "MIT",
      repository: {
        type: "git",
        url: "git+https://github.com/cravessant/valedictorian.git",
        directory: "packages/connector-api",
      },
      types: "./dist/index.d.ts",
      version: "0.19.0",
    })
    expect(harnessPackage).toMatchObject({
      name: "@sparxie/valedictorian-connectors-test-harness",
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org/",
      },
      files: ["dist"],
      homepage: "https://github.com/cravessant/valedictorian#readme",
      license: "MIT",
      repository: {
        type: "git",
        url: "git+https://github.com/cravessant/valedictorian.git",
        directory: "packages/connector-testkit",
      },
      types: "./dist/index.d.ts",
      version: "0.19.0",
    })
    for (const packageJson of [corePackage, harnessPackage]) {
      expect(packageJson.exports?.["."]).toEqual({
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      })
      expect(packageJson.scripts?.build).toContain("tsc -p tsconfig.build.json")
      expect(packageJson.scripts?.prepack).toBe("pnpm run build")
    }
    expect(corePackage.dependencies).toEqual({ zod: "^4.4.3" })
    expect(harnessPackage.dependencies).toEqual({
      "@sparxie/valedictorian-connectors-core": "workspace:^0.19.0",
    })
  })

  it("keeps the API and testkit source closures provider-neutral", () => {
    const forbidden = [
      "@sparxie/sdk",
      "valedictorian-app",
      "jobright_",
      "packages/jobright",
    ]
    for (const relativePath of readProviderNeutralSources()) {
      const source = readText(relativePath)
      for (const token of forbidden) {
        expect(source, `${relativePath} contains ${token}`).not.toContain(token)
      }
    }
    const definition = readText("packages/connector-api/src/connector-definition.ts")
    expect(definition).not.toMatch(
      /\b(?:apiVersion|minAppVersion|marketplace|registry|publisher|platform|permission|loader)\b/,
    )
  })

  it("publishes the connector-owned ABI without app run projections", () => {
    const coreDeclarations = readPublishedDeclarations("packages/connector-api")
    const harnessDeclarations = readPublishedDeclarations("packages/connector-testkit")
    const declarations = `${coreDeclarations}\n${harnessDeclarations}`

    for (const identifier of [
      "ConnectorHistoricalBackfillState",
      "ConnectorNewestFrontierState",
      "ConnectorVersionedRendererSchema",
      "installedConnectorDescriptorSchema",
      "sourceAdapterKinds",
    ]) {
      expect(coreDeclarations).toContain(identifier)
    }
    expect(coreDeclarations).toContain("scheduleRetry")
    expect(coreDeclarations).toContain("RetryPolicyDependencies")
    expect(coreDeclarations).toContain("SourceExecutionScopeId")
    expect(coreDeclarations).toContain("createCaptureInputSchema")
    expect(harnessDeclarations).not.toContain("assertValidConnectorRunSummary")
    expect(declarations).not.toMatch(/@sparxie\/sdk|jobright_/i)
    expect(declarations).not.toMatch(/connectorRunSummarySchema|ConnectorRunSummary/)
    expect(declarations).not.toMatch(
      /ConnectorPolitenessDefaults|\bpoliteness\??:|browser_session|ConnectorBrowserSession/,
    )
  })

  it("builds and publishes only repository-owned packages", () => {
    const packageDirectories = ["packages/connector-api", "packages/connector-testkit"]
    for (const directory of packageDirectories) {
      const packageJson = readPackageJson(`${directory}/package.json`)
      const buildConfig = JSON.parse(readText(`${directory}/tsconfig.build.json`)) as {
        extends?: string
        compilerOptions?: { outDir?: string; rootDir?: string }
      }

      expect(packageJson.files).toEqual(["dist"])
      expect(packageJson.scripts?.build).toContain("tsc -p tsconfig.build.json")
      expect(packageJson.scripts?.prepack).toBe("pnpm run build")
      expect(buildConfig.extends).toBe("../tsconfig.connectors.json")
      expect(buildConfig.compilerOptions).toMatchObject({
        outDir: "dist",
        rootDir: "src",
      })
      expect(JSON.stringify(packageJson)).not.toMatch(/jobright|@sparxie\/sdk/i)
    }
    expect(fs.existsSync(path.resolve("packages/jobright"))).toBe(false)
  })

  it("documents shared connector compiler and workspace conventions", () => {
    const compilerConfig = JSON.parse(readText("packages/tsconfig.connectors.json")) as {
      compilerOptions?: Record<string, unknown>
    }
    const compilerOptions = compilerConfig.compilerOptions ?? {}
    expect(compilerOptions).toMatchObject({
      declaration: true,
      declarationMap: true,
      exactOptionalPropertyTypes: true,
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noEmit: true,
      noUncheckedIndexedAccess: true,
      strict: true,
      target: "ES2024",
      types: ["node"],
    })

    const gitignore = readText(".gitignore")
    expect(gitignore).toContain(".local/")
    expect(gitignore).not.toContain("!AGENTS.md")
    expect(gitignore).not.toContain("!CLAUDE.md")
  })
})
