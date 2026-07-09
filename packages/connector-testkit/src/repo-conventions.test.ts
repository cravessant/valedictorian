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
    expect(readme).toContain("@valedictorian-connectors/internlist")
    expect(readme).toContain("@valedictorian-connectors/jobright")
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

  it("keeps current packages private and separated by dependency direction", () => {
    const rootPackage = readPackageJson("package.json")
    const corePackage = readPackageJson("packages/core/package.json")
    const harnessPackage = readPackageJson("packages/test-harness/package.json")
    const internListPackage = readPackageJson("packages/internlist/package.json")

    expect(rootPackage.private).toBe(true)
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
    expect(internListPackage).toMatchObject({
      name: "@valedictorian-connectors/internlist",
      private: true,
      version: "0.0.0",
    })
    expect(Object.keys(corePackage.dependencies ?? {})).not.toEqual(
      expect.arrayContaining([
        "@valedictorian-connectors/test-harness",
        "@valedictorian-connectors/internlist",
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
    expect(internListPackage.dependencies).toMatchObject({
      "@valedictorian-connectors/core": "workspace:*",
    })
    expect(Object.keys(internListPackage.dependencies ?? {})).not.toEqual(
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
    expect(internListPackage.devDependencies).toMatchObject({
      "@valedictorian-connectors/test-harness": "workspace:*",
    })
  })
})
