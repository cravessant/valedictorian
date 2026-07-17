import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function readText(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8")
}

function readPackageJson(relativePath: string) {
  return JSON.parse(readText(relativePath)) as {
    dependencies?: Record<string, string>
    description?: string
    devDependencies?: Record<string, string>
    exports?: {
      "."?: {
        import?: string
        types?: string
      }
    }
    files?: string[]
    homepage?: string
    license?: string
    name?: string
    private?: boolean
    publishConfig?: {
      access?: string
      registry?: string
    }
    repository?: {
      directory?: string
      type?: string
      url?: string
    }
    scripts?: Record<string, string>
    types?: string
    version?: string
  }
}

describe("connector repository conventions", () => {
  it("documents package boundaries and the API-only Jobright architecture", () => {
    const readme = readText("README.md")

    expect(readme).toContain("## Package Boundaries")
    expect(readme).toContain("@sparxie/valedictorian-connectors-core")
    expect(readme).toContain("@sparxie/valedictorian-connectors-test-harness")
    expect(readme).toContain("@sparxie/valedictorian-connectors-jobright")
    expect(readme).not.toContain("@sparxie/valedictorian-connectors-browser-session")
    expect(readme).toContain("Connectors are imported libraries, not mini servers")
    expect(readme).toContain("reserves a unique connector run id before execution")
    expect(readme).toContain("fixed sanitized failure warning")
    expect(readme).toContain("The app imports connector packages and calls `connector.refresh(...)`")
    expect(readme).toContain("optional `connector.validateAuth(...)`")
    expect(readme).toContain("Hosts own encrypted credential persistence and grant resolution")
    expect(readme).toContain("connectors own upstream authentication semantics")
    expect(readme).toContain("`@sparxie/valedictorian-connectors-core` is the app-to-adapter ABI")
    expect(readme).toContain("`sparxie` remains the owner and public HTTP/client contract")
    expect(readme).toContain("core reuses and re-exports Sparxie-owned raw-sourcing, resolver, retry, and source-execution identities")
    expect(readme).toContain("InternList/Internslist was reconnaissance only")
    expect(readme).not.toContain("@sparxie/valedictorian-connectors-internlist")
    expect(readme).not.toContain("the first real public discovery source package")
    expect(readme).toContain("Hosts own scheduling, auth persistence, run state, and upsert")
    expect(readme).toContain("Source packages must not depend on valedictorian-app")
    expect(readme).toContain("## Jobright Architecture")
    expect(readme).toContain("authentication, discovery, and raw capture are API-only")
    expect(readme).toContain("registered `connector.providerUrlResolver`")
    expect(readme).toContain("Discover authenticated search results through `POST /swan/recommend/search")
    expect(readme).toContain("`runtime.rawSourceIntake.capture(...)`")
    expect(readme).toContain("complete bounded provider batch")
    expect(readme).toContain("collect only acknowledged revision/occurrence receipts")
    expect(readme).toContain("Sparse, malformed, irrelevant, and source-duplicate rows remain raw facts")
    expect(readme).toContain("The provider URL resolver is deterministic at its public seam")
    expect(readme).toContain("host-interrupted (`cancelled`/`runtime_limit`) evidence")
    expect(readme).toContain("auth-port wait shares the bounded resolver deadline")
    expect(readme).toContain("typed `operation_timeout` retryable evidence")
    expect(readme).toContain("returned byte-for-byte exactly as supplied by Jobright")
    expect(readme).toContain("leading/trailing/control whitespace")
    expect(readme).toContain("Retry attempts, backoff, and persistence belong to the host normalization/scheduler layer")
    expect(readme).toContain("No connector-owned fit, review, dedupe, cutoff, or queue state is inferred from filters or used to discard a provider row")
    expect(readme).toContain("do not report connector-owned sourcing-fit or result-goal fields")
    expect(readme).toContain("Pending-resolution and resolved destination counts remain zero")
    expect(readme).toContain("Optional Jobright auth-only validation (`validateAuth`)")
    expect(readme).toContain("calls only `POST /swan/auth/login/pwd` and `GET /swan/auth/newinfo`")
    expect(readme).toContain("returns sanitized status/reason metadata")
    expect(readme).toContain("the host single-flights, fences, and persists a ready session")
    expect(readme).toContain("does not run sourcing refresh, authenticated-search discovery, provider URL resolution, application calls")
    expect(readme).toContain("must not launch or control Electron `BrowserWindow`")
    expect(readme).toContain("must not scrape HTML, inspect the DOM, depend on Cheerio, accept browser-backed auth grants")
    expect(readme).toContain("visitor-list")
    expect(readme).toContain("## Bounded Jobright Backfill")
    expect(readme).toContain("Newest-frontier checking and historical backfill advance independently")
    expect(readme).toContain("without imposing a fixed count termination")
    expect(readme).toContain("`jobright-capture-checkpoint@1`")
    expect(readme).toContain("only schema emitted by refresh")
    expect(readme).toContain("`jobright-resolution-checkpoint@5` is parsed tolerantly for migration")
    expect(readme).toContain("resolver ledgers, per-item retries, destination fields, and resolver counters are discarded")
    expect(readme).toContain("`invalid_discovery_position`")
    expect(readme).toContain("before every costly upstream transition")
    expect(readme).toContain("Historical coverage ends only at `coverage.start`")
    expect(readme).toContain("remaining invocation lease")
    expect(readme).toContain("non-progressing cursor")
    expect(readme).toContain("### Jobright stop precedence")
    expect(readme).toContain("source exhaustion")
    expect(readme).toContain("Capture retry advice remains owned by the discovery cursor")
    expect(readme).toContain("closed synchronization outcome")
    expect(readme).toContain("exact host execution scope")
    expect(readme).toContain("## Sanitized Connector Progress")
    expect(readme).toContain("optional `runtime.progress.report(...)`")
    expect(readme).toContain("`authenticating`, `discovering`, and `finalizing`")
    expect(readme).toContain("awaits async reports in order")
    expect(readme).toContain("best-effort")
    expect(readme).toContain("`connector_progress_reporting_failed`")
    expect(readme).toContain("one-second settlement deadline")
    expect(readme).toContain("30-second settlement deadline")
    expect(readme).toContain("completed refresh batch")
  })

  it("documents stack and local agent-file conventions", () => {
    const readme = readText("README.md")
    const agents = readText("AGENTS.md")

    expect(readme).toContain("## Stack Conventions")
    expect(readme).toContain("pnpm")
    expect(readme).toContain("mise")
    expect(readme).toContain("TS 7")
    expect(readme).toContain("tsgo")
    expect(readme).toContain("oxlint")
    expect(readme).toContain("Vitest")
    expect(readme).toContain("Zod")
    expect(readme).toContain("Published npm packages must export compiled `dist/index.js`")
    expect(readme).toContain("## Agent Files")
    expect(readme).toContain("`.local/` is gitignored")
    expect(readme).toContain("`AGENTS.md` is the committed pointer")
    expect(agents).toContain("agent-owned support files in `.local/`, which is intentionally gitignored")
  })

  it("limits release-age exceptions to internal sparxie packages", () => {
    const workspace = readText("pnpm-workspace.yaml")

    expect(workspace).toContain("minimumReleaseAgeExclude:")
    expect(workspace).toContain("  - sparxie")
    expect(workspace).toContain("  - '@sparxie/*'")
    expect(workspace).not.toMatch(/minimumReleaseAge:\s*0/)
    expect(workspace).not.toContain("sparxie@0.9.0")
  })

  it("documents connector package publishing and versioning expectations", () => {
    const readme = readText("README.md")

    expect(readme).toContain("## Package Publishing")
    expect(readme).toContain("Release `@sparxie/valedictorian-connectors-core` first")
    expect(readme).toContain("Adapter ABI changes require a new core version")
    expect(readme).toContain("Concrete connector packages declare a compatible core range")
    expect(readme).toContain("The app bumps concrete connector packages directly")
    expect(readme).toContain("Do not release or bump `sparxie` for adapter ABI changes")
    expect(readme).toContain("HTTP/client exposure is a separate `sparxie` change")
    expect(readme).toContain("The current breaking release tree is `0.14.1`")
    expect(readme).toContain("exact `workspace:^0.14.1` internal compatibility ranges")
    expect(readme).toContain("Packages publish publicly to npm under the `@sparxie` scope")
    expect(readme).toContain("CI publishes packages from `.github/workflows/publish.yml`")
    expect(readme).toContain("Workflow filename: `publish.yml`")
    expect(readme).toContain("publishes the tarballs with the npm CLI for OIDC support")
    expect(readme).toContain("Provenance is intentionally not requested while this GitHub repo is private")
  })

  it("keeps current packages public and separated by dependency direction", () => {
    const rootPackage = readPackageJson("package.json")
    const corePackage = readPackageJson("packages/core/package.json")
    const harnessPackage = readPackageJson("packages/test-harness/package.json")
    const jobrightPackage = readPackageJson("packages/jobright/package.json")

    expect(rootPackage.private).toBe(true)
    expect(fs.existsSync(path.resolve("packages/internlist"))).toBe(false)
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
        url: "git+https://github.com/KennyKeni/valedictorian-connectors.git",
        directory: "packages/core",
      },
      types: "./dist/index.d.ts",
      version: "0.14.1",
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
        url: "git+https://github.com/KennyKeni/valedictorian-connectors.git",
        directory: "packages/test-harness",
      },
      types: "./dist/index.d.ts",
      version: "0.14.1",
    })
    expect(jobrightPackage).toMatchObject({
      name: "@sparxie/valedictorian-connectors-jobright",
      publishConfig: {
        access: "public",
        registry: "https://registry.npmjs.org/",
      },
      files: ["dist"],
      license: "MIT",
      repository: {
        type: "git",
        url: "git+https://github.com/KennyKeni/valedictorian-connectors.git",
        directory: "packages/jobright",
      },
      types: "./dist/index.d.ts",
      version: "0.14.1",
    })
    for (const packageJson of [corePackage, harnessPackage, jobrightPackage]) {
      expect(packageJson.exports?.["."]).toEqual({
        import: "./dist/index.js",
        types: "./dist/index.d.ts",
      })
      expect(packageJson.scripts?.build).toContain("tsgo -p tsconfig.build.json")
      expect(packageJson.scripts?.prepack).toBe("pnpm run build")
    }
    expect(Object.keys(corePackage.dependencies ?? {})).not.toEqual(
      expect.arrayContaining([
        "@sparxie/valedictorian-connectors-test-harness",
        "better-sqlite3",
        "drizzle-orm",
        "electron",
        "playwright",
        "valedictorian-app",
      ]),
    )
    expect(corePackage.dependencies).toEqual({
      sparxie: "^0.15.0",
    })
    expect(harnessPackage.dependencies).toEqual({
      "@sparxie/valedictorian-connectors-core": "workspace:^0.14.1",
      sparxie: "^0.15.0",
    })
    expect(jobrightPackage.dependencies).toEqual({
      "@sparxie/valedictorian-connectors-core": "workspace:^0.14.1",
    })
    expect(Object.keys(jobrightPackage.dependencies ?? {})).not.toEqual(
      expect.arrayContaining([
        "@sparxie/valedictorian-connectors-test-harness",
        "better-sqlite3",
        "cheerio",
        "drizzle-orm",
        "electron",
        "playwright",
        "valedictorian-app",
      ]),
    )
    expect(jobrightPackage.devDependencies).toMatchObject({
      "@sparxie/valedictorian-connectors-test-harness": "workspace:^0.14.1",
    })
  })

  it("provides an explicit local test path that runs the Jobright live contract", () => {
    const rootPackage = readPackageJson("package.json")

    expect(rootPackage.scripts?.test).not.toContain("JOBRIGHT_LIVE")
    expect(rootPackage.scripts?.["test:local"]).toBe(
      "pnpm run build && JOBRIGHT_LIVE=1 node --env-file=.env node_modules/vitest/vitest.mjs run --passWithNoTests",
    )
  })

  it("publishes typed retry policy and host declarations", () => {
    const coreDeclarations = readText("packages/core/dist/index.d.ts")
    const harnessDeclarations = readText("packages/test-harness/dist/index.d.ts")
    const jobrightDeclarations = readText("packages/jobright/dist/index.d.ts")

    expect(coreDeclarations).toContain("scheduleRetry")
    expect(coreDeclarations).toContain("RetryPolicyDependencies")
    expect(coreDeclarations).toContain("retryHints?: RetryAdvice | null")
    expect(coreDeclarations).toContain("sourceExecutionScopeIdSchema")
    expect(coreDeclarations).toContain("SourceExecutionScopeId")
    expect(coreDeclarations).toContain("SourceOperationOutcome")
    expect(coreDeclarations).toContain("ConnectorHistoricalBackfillState")
    expect(coreDeclarations).toContain("ConnectorNewestFrontierState")
    expect(coreDeclarations).toContain("ConnectorSynchronizationOutcome")
    expect(coreDeclarations).toContain('status: "interrupted"')
    expect(coreDeclarations).toContain('reason: "cancelled" | "runtime_limit"')
    expect(coreDeclarations).toContain('from "sparxie"')
    expect(harnessDeclarations).toContain("retryHints: RetryAdvice | null")
    expect(jobrightDeclarations).not.toContain('from "sparxie"')
  })

  it("publishes the forward-only connector ABI without retired host contracts", () => {
    const coreDeclarations = readText("packages/core/dist/index.d.ts")
    const harnessDeclarations = readText("packages/test-harness/dist/index.d.ts")
    const declarations = `${coreDeclarations}\n${harnessDeclarations}`

    expect(declarations).not.toMatch(
      /ConnectorPolitenessDefaults|\bpoliteness\??:|\bbudget\??:|browser_session|ConnectorBrowserSession|\bbrowserSession\??:|\busesBrowserSession\??:/,
    )
  })

  it("publishes from GitHub OIDC workflows", () => {
    const rootPackage = readPackageJson("package.json")
    const ciWorkflow = readText(".github/workflows/ci.yml")
    const publishWorkflow = readText(".github/workflows/publish.yml")

    expect(rootPackage.scripts?.["publish:public"]).toBeUndefined()
    expect(ciWorkflow).toContain("pnpm install --frozen-lockfile")
    expect(ciWorkflow).toContain("cancel-in-progress: true")
    expect(ciWorkflow.match(/run: pnpm build/g)).toHaveLength(1)
    expect(ciWorkflow).toContain("pnpm exec vitest run --passWithNoTests")
    expect(ciWorkflow).toContain("pnpm exec tsgo --noEmit")
    expect(ciWorkflow).toContain("pnpm --filter @sparxie/valedictorian-connectors-core pack --dry-run")
    expect(publishWorkflow).toContain("id-token: write")
    expect(publishWorkflow).toContain("group: npm-publish-${{ github.ref }}")
    expect(publishWorkflow).toContain("registry-url: https://registry.npmjs.org")
    expect(publishWorkflow).toContain("Verify npm trusted publishing prerequisites")
    expect(publishWorkflow).toContain("need npm 11.5.1 or newer")
    expect(publishWorkflow.match(/run: pnpm build/g)).toHaveLength(1)
    expect(publishWorkflow).toContain("pnpm exec vitest run --passWithNoTests")
    expect(publishWorkflow).toContain("pnpm exec tsgo --noEmit")
    expect(publishWorkflow).toContain("pnpm --filter @sparxie/valedictorian-connectors-core pack --pack-destination .local/packs")
    expect(publishWorkflow).toContain("npm publish \"$package_file\" --access public --dry-run")
    expect(publishWorkflow).toContain("npm \"${publish_args[@]}\" .local/packs/sparxie-valedictorian-connectors-core-*.tgz")
    expect(publishWorkflow).toContain("npm \"${publish_args[@]}\" .local/packs/sparxie-valedictorian-connectors-test-harness-*.tgz")
    expect(publishWorkflow).toContain("npm \"${publish_args[@]}\" .local/packs/sparxie-valedictorian-connectors-jobright-*.tgz")
    expect(publishWorkflow).not.toContain("--provenance")
    expect(publishWorkflow).not.toContain("NODE_AUTH_TOKEN")
    expect(publishWorkflow).not.toContain("NPM_TOKEN")
  })
})
