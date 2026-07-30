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

describe("connector repository conventions", () => {
  it("owns only provider-neutral packages", () => {
    const workspace = readText("pnpm-workspace.yaml")
    const readme = readText("README.md")

    expect(workspace).toContain('- "packages/core"')
    expect(workspace).toContain('- "packages/test-harness"')
    expect(workspace).not.toContain('packages/*')
    expect(fs.existsSync(path.resolve("packages/jobright"))).toBe(false)
    expect(readme).toContain("cravessant/valedictorian-connector-jobright")
    expect(readme).toContain("does not contain, build, pack, or publish Jobright")
    expect(readme).toMatch(/no\s+filesystem relationship/)
    expect(readme).toMatch(/Provider implementations\s+and provider-owned fixtures belong/)
  })

  it("keeps core and test-harness identities unchanged", () => {
    const rootPackage = readPackageJson("package.json")
    const corePackage = readPackageJson("packages/core/package.json")
    const harnessPackage = readPackageJson("packages/test-harness/package.json")

    expect(rootPackage.private).toBe(true)
    expect(rootPackage.scripts?.["test:local"]).toBeUndefined()
    expect(corePackage).toMatchObject({
      name: "@sparxie/valedictorian-connectors-core",
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org/",
      },
      files: ["dist"],
      license: "MIT",
      repository: {
        type: "git",
        url: "git+https://github.com/cravessant/valedictorian-connectors.git",
        directory: "packages/core",
      },
      types: "./dist/index.d.ts",
      version: "0.18.2",
    })
    expect(harnessPackage).toMatchObject({
      name: "@sparxie/valedictorian-connectors-test-harness",
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org/",
      },
      files: ["dist"],
      license: "MIT",
      repository: {
        type: "git",
        url: "git+https://github.com/cravessant/valedictorian-connectors.git",
        directory: "packages/test-harness",
      },
      types: "./dist/index.d.ts",
      version: "0.18.2",
    })
    for (const packageJson of [corePackage, harnessPackage]) {
      expect(packageJson.exports?.["."]).toEqual({
        import: "./dist/index.js",
        types: "./dist/index.d.ts",
      })
      expect(packageJson.scripts?.build).toContain("tsc -p tsconfig.build.json")
      expect(packageJson.scripts?.prepack).toBe("pnpm run build")
    }
    expect(corePackage.dependencies).toEqual({ "@sparxie/sdk": "0.29.0" })
    expect(harnessPackage.dependencies).toEqual({
      "@sparxie/valedictorian-connectors-core": "workspace:^0.18.2",
      "@sparxie/sdk": "0.29.0",
    })
  })

  it("publishes typed retry policy and host declarations", () => {
    const coreDeclarations = readPublishedDeclarations("packages/core")
    const harnessDeclarations = readPublishedDeclarations("packages/test-harness")
    const declarations = `${coreDeclarations}\n${harnessDeclarations}`

    expect(coreDeclarations).toContain("scheduleRetry")
    expect(coreDeclarations).toContain("RetryPolicyDependencies")
    expect(coreDeclarations).toContain("SourceExecutionScopeId")
    expect(coreDeclarations).toContain("ConnectorSynchronizationOutcome")
    expect(harnessDeclarations).toContain("retryHints: RetryAdvice | null")
    expect(declarations).not.toMatch(
      /ConnectorPolitenessDefaults|\bpoliteness\??:|browser_session|ConnectorBrowserSession/,
    )
  })

  it("builds and publishes only repository-owned packages", () => {
    const ciWorkflow = readText(".github/workflows/ci.yml")
    const publishWorkflow = readText(".github/workflows/publish.yml")
    const combined = `${ciWorkflow}\n${publishWorkflow}`

    expect(ciWorkflow).toContain("pnpm install --frozen-lockfile")
    expect(ciWorkflow).toContain(
      "pnpm --filter @sparxie/valedictorian-connectors-core pack --dry-run",
    )
    expect(ciWorkflow).toContain(
      "pnpm --filter @sparxie/valedictorian-connectors-test-harness pack --dry-run",
    )
    expect(publishWorkflow).toContain("id-token: write")
    expect(publishWorkflow).toContain("Verify npm trusted publishing prerequisites")
    expect(publishWorkflow).toContain(
      "pnpm --filter @sparxie/valedictorian-connectors-core pack --pack-destination .local/packs",
    )
    expect(publishWorkflow).toContain(
      "pnpm --filter @sparxie/valedictorian-connectors-test-harness pack --pack-destination .local/packs",
    )
    expect(publishWorkflow).toContain(
      'npm "${publish_args[@]}" .local/packs/sparxie-valedictorian-connectors-core-*.tgz',
    )
    expect(publishWorkflow).toContain(
      'npm "${publish_args[@]}" .local/packs/sparxie-valedictorian-connectors-test-harness-*.tgz',
    )
    expect(combined).not.toContain("valedictorian-connectors-jobright")
    expect(combined).not.toContain("packages/jobright")
    expect(publishWorkflow).not.toContain("NODE_AUTH_TOKEN")
    expect(publishWorkflow).not.toContain("NPM_TOKEN")
  })

  it("documents stack, publishing, and local agent-file conventions", () => {
    const readme = readText("README.md")
    const gitignore = readText(".gitignore")

    expect(readme).toContain("## Package Boundaries")
    expect(readme).toContain("Connectors are imported libraries, not mini servers")
    expect(readme).toContain("## Stack Conventions")
    expect(readme).toContain("stable TS 7 through `tsc`")
    expect(readme).toContain("Published packages export compiled `dist/index.js`")
    expect(readme).toContain("## Package Publishing")
    expect(readme).toContain("Core and test-harness remain at `0.18.2`")
    expect(readme).toContain("## Agent Files")
    expect(readme).toContain("`AGENTS.md` and `CLAUDE.md` are local-only")
    expect(gitignore).toContain(".local/")
    expect(gitignore).not.toContain("!AGENTS.md")
    expect(gitignore).not.toContain("!CLAUDE.md")
  })
})
