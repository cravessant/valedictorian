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
    name?: string
    private?: boolean
    version?: string
  }
}

describe("connector repository conventions", () => {
  it("documents package boundaries before source-specific connectors depend on them", () => {
    const readme = readText("README.md")

    expect(readme).toContain("## Package Boundaries")
    expect(readme).toContain("@valedictorian-connectors/core")
    expect(readme).toContain("@valedictorian-connectors/test-harness")
    expect(readme).toContain("@valedictorian-connectors/browser-session")
    expect(readme).toContain("@valedictorian-connectors/jobright")
    expect(readme).toContain("Connectors are imported libraries, not mini servers")
    expect(readme).toContain("The app imports connector packages and calls `connector.refresh(...)`")
    expect(readme).toContain("`@valedictorian-connectors/core` is the app-to-adapter ABI")
    expect(readme).toContain("`sparxie` is not the connector runtime contract")
    expect(readme).toContain("InternList was reconnaissance")
    expect(readme).not.toContain("@valedictorian-connectors/internlist")
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
    expect(readme).toContain("## Agent Files")
    expect(readme).toContain("`.local/` is gitignored")
    expect(readme).toContain("`AGENTS.md` is the committed pointer")
    expect(agents).toContain("agent-owned support files in `.local/`, which is intentionally gitignored")
  })

  it("documents connector package publishing and versioning expectations", () => {
    const readme = readText("README.md")

    expect(readme).toContain("## Package Publishing")
    expect(readme).toContain("Release `@valedictorian-connectors/core` first")
    expect(readme).toContain("Adapter ABI changes require a new core version")
    expect(readme).toContain("Concrete connector packages declare a compatible core range")
    expect(readme).toContain("The app bumps concrete connector packages directly")
    expect(readme).toContain("Do not release or bump `sparxie` for adapter ABI changes")
    expect(readme).toContain("HTTP/client exposure is a separate `sparxie` change")
  })

  it("keeps current packages private and separated by dependency direction", () => {
    const rootPackage = readPackageJson("package.json")
    const corePackage = readPackageJson("packages/core/package.json")
    const harnessPackage = readPackageJson("packages/test-harness/package.json")
    const jobrightPackage = readPackageJson("packages/jobright/package.json")

    expect(rootPackage.private).toBe(true)
    expect(fs.existsSync(path.resolve("packages/internlist"))).toBe(false)
    expect(corePackage).toMatchObject({
      name: "@valedictorian-connectors/core",
      private: true,
      version: "0.0.0",
    })
    expect(harnessPackage).toMatchObject({
      name: "@valedictorian-connectors/test-harness",
      private: true,
      version: "0.0.0",
    })
    expect(jobrightPackage).toMatchObject({
      name: "@valedictorian-connectors/jobright",
      private: true,
      version: "0.0.0",
    })
    expect(Object.keys(corePackage.dependencies ?? {})).not.toEqual(
      expect.arrayContaining([
        "@valedictorian-connectors/test-harness",
        "better-sqlite3",
        "drizzle-orm",
        "electron",
        "playwright",
        "sparxie",
        "valedictorian-app",
      ]),
    )
    expect(harnessPackage.dependencies).toEqual({
      "@valedictorian-connectors/core": "workspace:*",
    })
    expect(jobrightPackage.dependencies).toMatchObject({
      "@valedictorian-connectors/core": "workspace:*",
    })
    expect(Object.keys(jobrightPackage.dependencies ?? {})).not.toEqual(
      expect.arrayContaining([
        "@valedictorian-connectors/test-harness",
        "better-sqlite3",
        "drizzle-orm",
        "electron",
        "playwright",
        "sparxie",
        "valedictorian-app",
      ]),
    )
    expect(jobrightPackage.devDependencies).toMatchObject({
      "@valedictorian-connectors/test-harness": "workspace:*",
    })
  })
})
