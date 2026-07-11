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
    expect(readme).toContain("core reuses its released raw-sourcing and resolver value types")
    expect(readme).toContain("InternList was reconnaissance")
    expect(readme).not.toContain("@sparxie/valedictorian-connectors-internlist")
    expect(readme).not.toContain("the first real public discovery source package")
    expect(readme).toContain("Hosts own scheduling, auth persistence, run state, and upsert")
    expect(readme).toContain("Source packages must not depend on valedictorian-app")
    expect(readme).toContain("## Jobright Architecture")
    expect(readme).toContain("authentication, discovery, and application-link normalization are API-only")
    expect(readme).toContain("Discover `internslist` jobs through `POST /swan/recommend/visitor-list/jobs")
    expect(readme).toContain("Resolve pending intermediary jobs with authenticated `GET /swan/share/job/{jobId}`")
    expect(readme).toContain("`runtime.rawSourceIntake.capture(...)`")
    expect(readme).toContain("complete bounded provider batch")
    expect(readme).toContain("collect only acknowledged revision/occurrence receipts")
    expect(readme).toContain("Sparse, malformed, irrelevant, non-internship, source-duplicate, and later-unresolvable rows remain raw facts")
    expect(readme).toContain("Only after every row in the bounded batch is acknowledged")
    expect(readme).toContain("`runtime.normalization.run(...)`")
    expect(readme).toContain("do not alter that request, reject returned rows")
    expect(readme).toContain("They do not report `eligible` or fit-filtered buckets")
    expect(readme).toContain("External hostname alone is never employer evidence")
    expect(readme).toContain("jobright_application_url_unclassified")
    expect(readme).toContain("Optional Jobright auth-only validation (`validateAuth`)")
    expect(readme).toContain("calls only `POST /swan/auth/login/pwd` and `GET /swan/auth/newinfo`")
    expect(readme).toContain("returns sanitized status/reason metadata")
    expect(readme).toContain("does not persist the session cookie")
    expect(readme).toContain("does not run refresh, visitor-list discovery, job-detail normalization, application calls")
    expect(readme).toContain("must not launch or control Electron `BrowserWindow`")
    expect(readme).toContain("must not scrape HTML, inspect the DOM, depend on Cheerio, require `browser_session`")
    expect(readme).toContain("browser-session resolution behavior present in the `v0.3.1` implementation")
    expect(readme).toContain("deprecated architecture")
    expect(readme).toContain("username_password")
    expect(readme).toContain("SESSION_ID")
    expect(readme).toContain("visitor-list")
    expect(readme).toContain("## Bounded Jobright Backfill")
    expect(readme).toContain("useful target defaults to 100")
    expect(readme).toContain("`soft_batch_boundary`")
    expect(readme).toContain("`jobright-resolution-checkpoint@3`")
    expect(readme).toContain("processed source ids")
    expect(readme).toContain("bounded retry/defer state")
    expect(readme).toContain("canonical `jobright.public:<job-id>`")
    expect(readme).toContain("`invalid_discovery_position`")
    expect(readme).toContain("does not reuse observations from the terminal cycle")
    expect(readme).toContain("before every costly upstream transition")
    expect(readme).toContain("ECMAScript date bounds")
    expect(readme).toContain("absolute per-request ingestion cap")
    expect(readme).toContain("`runtime.cancellation.signal`")
    expect(readme).toContain("resumable `cancelled`")
    expect(readme).toContain("connector-owned timer fallback")
    expect(readme).toContain("opaque cycle id")
    expect(readme).toContain("matching active cycle id")
    expect(readme).toContain("cumulative attempt capacity")
    expect(readme).toContain("before normalization")
    expect(readme).toContain("Response-body cancellation aborts")
    expect(readme).toContain("earliest deadline wins")
    expect(readme).toContain("persisted stop reason is never authoritative")
    expect(readme).toContain("Only the released v2 count-only shape")
    expect(readme).toContain("within canonical attempt capacity")
    expect(readme).toContain("current page length is never substituted")
    expect(readme).toContain("full page with an unknown total")
    expect(readme).toContain("empty or short page")
    expect(readme).toContain("request size that produced that page")
    expect(readme).toContain("unexplained processed ids are removed")
    expect(readme).toContain("capacity-blocked discovery-record")
    expect(readme).toContain("schema hard ceilings")
    expect(readme).toContain("without visitor-list rediscovery")
    expect(readme).toContain("final allowed detail attempt")
    expect(readme).toContain("current per-source retry setting")
    expect(readme).toContain("never clears unrelated retry entries")
    expect(readme).toContain("### Jobright stop precedence")
    expect(readme).toContain("Cumulative cycle-attempt ceiling reached")
    expect(readme).toContain("schema-hard retry")
    expect(readme).toContain("## Sanitized Connector Progress")
    expect(readme).toContain("optional `runtime.progress.report(...)`")
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
      version: "0.6.0",
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
      version: "0.6.0",
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
      version: "0.6.0",
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
      sparxie: "^0.9.0",
    })
    expect(harnessPackage.dependencies).toEqual({
      "@sparxie/valedictorian-connectors-core": "workspace:^",
    })
    expect(jobrightPackage.dependencies).toEqual({
      "@sparxie/valedictorian-connectors-core": "workspace:^",
    })
    expect(Object.keys(jobrightPackage.dependencies ?? {})).not.toEqual(
      expect.arrayContaining([
        "@sparxie/valedictorian-connectors-test-harness",
        "better-sqlite3",
        "cheerio",
        "drizzle-orm",
        "electron",
        "playwright",
        "sparxie",
        "valedictorian-app",
      ]),
    )
    expect(jobrightPackage.devDependencies).toMatchObject({
      "@sparxie/valedictorian-connectors-test-harness": "workspace:^",
    })
  })

  it("publishes from GitHub OIDC workflows", () => {
    const rootPackage = readPackageJson("package.json")
    const ciWorkflow = readText(".github/workflows/ci.yml")
    const publishWorkflow = readText(".github/workflows/publish.yml")

    expect(rootPackage.scripts?.["publish:public"]).toBeUndefined()
    expect(ciWorkflow).toContain("pnpm install --frozen-lockfile")
    expect(ciWorkflow).toContain("pnpm --filter @sparxie/valedictorian-connectors-core pack --dry-run")
    expect(publishWorkflow).toContain("id-token: write")
    expect(publishWorkflow).toContain("group: npm-publish-${{ github.ref }}")
    expect(publishWorkflow).toContain("registry-url: https://registry.npmjs.org")
    expect(publishWorkflow).toContain("Verify npm trusted publishing prerequisites")
    expect(publishWorkflow).toContain("need npm 11.5.1 or newer")
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
