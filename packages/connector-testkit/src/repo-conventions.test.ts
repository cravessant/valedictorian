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
  it("documents package boundaries before source-specific connectors depend on them", () => {
    const readme = readText("README.md")

    expect(readme).toContain("## Package Boundaries")
    expect(readme).toContain("@sparxie/valedictorian-connectors-core")
    expect(readme).toContain("@sparxie/valedictorian-connectors-test-harness")
    expect(readme).toContain("@sparxie/valedictorian-connectors-browser-session")
    expect(readme).toContain("@sparxie/valedictorian-connectors-jobright")
    expect(readme).toContain("Connectors are imported libraries, not mini servers")
    expect(readme).toContain("The app imports connector packages and calls `connector.refresh(...)`")
    expect(readme).toContain("`@sparxie/valedictorian-connectors-core` is the app-to-adapter ABI")
    expect(readme).toContain("`sparxie` is not the connector runtime contract")
    expect(readme).toContain("InternList was reconnaissance")
    expect(readme).not.toContain("@sparxie/valedictorian-connectors-internlist")
    expect(readme).not.toContain("the first real public discovery source package")
    expect(readme).toContain("Hosts own scheduling, auth persistence, run state, and upsert")
    expect(readme).toContain("Source packages must not depend on valedictorian-app")
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
      version: "0.1.0",
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
      version: "0.1.0",
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
      version: "0.1.0",
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
        "sparxie",
        "valedictorian-app",
      ]),
    )
    expect(harnessPackage.dependencies).toEqual({
      "@sparxie/valedictorian-connectors-core": "workspace:^",
    })
    expect(jobrightPackage.dependencies).toMatchObject({
      "@sparxie/valedictorian-connectors-core": "workspace:^",
    })
    expect(Object.keys(jobrightPackage.dependencies ?? {})).not.toEqual(
      expect.arrayContaining([
        "@sparxie/valedictorian-connectors-test-harness",
        "better-sqlite3",
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
