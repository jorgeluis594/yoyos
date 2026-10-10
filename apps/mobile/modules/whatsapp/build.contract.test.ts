/**
 * WA-14 (review M3): the parts of IT-BLD-06 and IT-BLD-08 that need no SDK, Gradle, Xcode or device. Expo's own
 * autolinking resolves the module from the app's lockfile-installed packages; the repository ignores every
 * generated artifact; the consuming builds refuse to continue without them. Whether Gradle or CocoaPods then
 * load the module is NOT demonstrated here (no native build was run).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const moduleDir = __dirname;
const appDir = join(moduleDir, "../..");
const read = (path: string) => readFileSync(join(moduleDir, path), "utf8");

describe("IT-BLD-06 the local module is integrated with the app's own packages", () => {
  const resolve = (platform: "android" | "ios") => {
    const raw = execFileSync(join(appDir, "node_modules/.bin/expo-modules-autolinking"), ["resolve", "--platform", platform, "--json"], { cwd: appDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const modules = (JSON.parse(raw) as { modules: { packageName: string }[] }).modules;
    return modules.find((entry) => entry.packageName === "@yoyos/whatsapp") as Record<string, unknown> | undefined;
  };

  test("Expo autolinking registers the Android module class and project", () => {
    const found = resolve("android") as { projects: { sourceDir: string; modules: { classifier: string }[] }[] } | undefined;
    expect(found?.projects[0].sourceDir).toBe(join(moduleDir, "android"));
    expect(found?.projects[0].modules.map((entry) => entry.classifier)).toEqual(["expo.modules.whatsapp.WhatsAppModule"]);
  });

  test("Expo autolinking registers the iOS pod and module class", () => {
    const found = resolve("ios") as { pods: { podName: string; podspecDir: string }[]; modules: { class: string }[] } | undefined;
    expect(found?.pods).toEqual([{ podName: "WhatsApp", podspecDir: join(moduleDir, "ios") }]);
    expect(found?.modules.map((entry) => entry.class)).toEqual(["WhatsAppModule"]);
  });

  test("the module brings no second React Native or package installation", () => {
    expect(existsSync(join(moduleDir, "node_modules"))).toBe(false);
    expect(existsSync(join(moduleDir, "pnpm-lock.yaml"))).toBe(false);
    expect(existsSync(join(moduleDir, "package-lock.json"))).toBe(false);
    const manifest = JSON.parse(read("package.json")) as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) expect(manifest[field]).toBeUndefined();
    expect(existsSync(join(appDir, "pnpm-lock.yaml"))).toBe(true); // the app's lockfile is the only one
  });

  test("the consuming builds vendor the local artifacts and stop when they are missing", () => {
    expect(read("android/build.gradle")).toContain("file('libs/WhatsAppGo.aar')");
    expect(read("android/build.gradle")).toMatch(/throw new GradleException\('WhatsAppGo\.aar is missing/);
    expect(read("android/build.gradle")).toContain("implementation(name: 'WhatsAppGo', ext: 'aar')");
    expect(read("ios/WhatsApp.podspec")).toContain("s.vendored_frameworks = 'Frameworks/WhatsAppGo.xcframework'");
    expect(read("ios/WhatsApp.podspec")).toMatch(/raise 'WhatsAppGo\.xcframework is missing/);
    expect(JSON.parse(read("expo-module.config.json"))).toEqual({
      platforms: ["android", "ios"], android: { modules: ["expo.modules.whatsapp.WhatsAppModule"] }, ios: { modules: ["WhatsAppModule"] },
    });
  });
});

describe("IT-BLD-08 generated artifacts and tool output stay out of Git", () => {
  const ignored = (path: string) => {
    try { execFileSync("git", ["check-ignore", "-q", path], { cwd: moduleDir }); return true; } catch { return false; }
  };
  test.each(["android/libs/WhatsAppGo.aar", "ios/Frameworks/WhatsAppGo.xcframework", "ios/Frameworks/WhatsAppGo.xcframework/Info.plist", ".generated/build-info.txt", ".generated/build.ABC123/gomobile"])("%s is ignored", (path) => {
    expect(ignored(path)).toBe(true);
  });
  test("nothing generated is tracked", () => {
    const tracked = execFileSync("git", ["ls-files", "android/libs", "ios/Frameworks", ".generated"], { cwd: moduleDir, encoding: "utf8" });
    expect(tracked).toBe("");
  });
  test("the build records the effective sources and tools, not a claim about the binaries", () => {
    const script = read("scripts/build-go.sh");
    for (const needle of ['echo "Go: $(go version)"', 'echo "whatsmeow: $expected_meow"', 'echo "x/mobile: $expected_mobile"', "source: $(git -C", 'echo "command: $android_bind"', "go version -m", "source-tree:"]) expect(script).toContain(needle);
  });
});
