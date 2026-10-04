import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const iconPath = path.join(appRoot, "icons", "icon.ico");
const mainPath = path.join(appRoot, "src", "main.ts");
const forgePath = path.join(appRoot, "forge.config.cjs");
const packagePath = path.join(appRoot, "package.json");
const bundlePath = path.join(appRoot, ".package", "dist", "main.cjs");
const requireBundle = process.argv.includes("--require-bundle");

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

// These checks intentionally operate on uncommented source. That prevents a
// commented-out implementation or an explanatory comment from satisfying a
// release gate. The relevant snippets do not contain comment markers in
// string literals.
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const icon = fs.readFileSync(iconPath);
assert.equal(icon.readUInt16LE(0), 0, "ICO reserved field must be zero");
assert.equal(icon.readUInt16LE(2), 1, "ICO must contain icon images");

const imageCount = icon.readUInt16LE(4);
assert.equal(imageCount, 9, "Windows ICO must contain exactly nine images");
const sizes = [];
for (let index = 0; index < imageCount; index += 1) {
  const offset = 6 + (16 * index);
  assert.ok(offset + 16 <= icon.length, `ICO directory entry ${index} must be complete`);
  const width = icon[offset] === 0 ? 256 : icon[offset];
  const height = icon[offset + 1] === 0 ? 256 : icon[offset + 1];
  assert.equal(width, height, `ICO frame ${index} must be square`);
  const imageLength = icon.readUInt32LE(offset + 8);
  const imageOffset = icon.readUInt32LE(offset + 12);
  assert.ok(imageLength > 0, `ICO frame ${index} must not be empty`);
  assert.ok(imageOffset >= 6 + (16 * imageCount), `ICO frame ${index} must follow its directory`);
  assert.ok(imageOffset + imageLength <= icon.length, `ICO frame ${index} must fit inside the file`);
  sizes.push(width);
}

const requiredSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
assert.deepEqual(sizes, requiredSizes, "Windows ICO must contain the complete ordered size set");

const mainSource = withoutComments(fs.readFileSync(mainPath, "utf8"));
const forgeSource = withoutComments(fs.readFileSync(forgePath, "utf8"));
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const identityDeclaration = "const WINDOWS_APP_USER_MODEL_ID = `com.squirrel.Rowboat-win32-${process.arch}.rowboat`;";
const identityCall = "app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);";
const windowsPackagedGuard = 'if (process.platform === "win32" && app.isPackaged) {';
const detailCall = "win.setAppDetails({";

assert.equal(countOccurrences(mainSource, identityDeclaration), 1, "Runtime must declare exactly one canonical Squirrel AppUserModelID");
assert.equal(countOccurrences(mainSource, identityCall), 1, "Runtime must set the canonical AppUserModelID exactly once");
assert.equal(countOccurrences(mainSource, detailCall), 1, "Runtime must set Windows taskbar details exactly once");
assert.ok(countOccurrences(mainSource, windowsPackagedGuard) >= 2, "Identity and taskbar details must each be guarded to packaged Windows");

const identityIndex = mainSource.indexOf(identityCall);
const singleInstanceIndex = mainSource.indexOf("app.requestSingleInstanceLock()");
const browserWindowIndex = mainSource.indexOf("new BrowserWindow(");
const detailIndex = mainSource.indexOf(detailCall);
const detailGuardIndex = mainSource.lastIndexOf(windowsPackagedGuard, detailIndex);

assert.ok(identityIndex > mainSource.indexOf(identityDeclaration), "AppUserModelID must be declared before it is set");
assert.ok(identityIndex < singleInstanceIndex, "AppUserModelID must be set before the single-instance lock");
assert.ok(identityIndex < browserWindowIndex, "AppUserModelID must be set before creating a BrowserWindow");
assert.ok(detailGuardIndex > browserWindowIndex, "Taskbar details must use their own packaged-Windows guard after window creation");
assert.ok(detailIndex > detailGuardIndex && detailIndex - detailGuardIndex < 1_500, "Taskbar details must be inside the nearby packaged-Windows guard");

const identityGuardSlice = mainSource.slice(mainSource.lastIndexOf(windowsPackagedGuard, identityIndex), identityIndex + identityCall.length);
assert.match(
  identityGuardSlice,
  /if \(process\.platform === "win32" && app\.isPackaged\) \{\s*app\.setAppUserModelId\(WINDOWS_APP_USER_MODEL_ID\);/,
  "AppUserModelID call must execute directly inside its packaged-Windows guard",
);

const detailSlice = mainSource.slice(detailIndex, detailIndex + 650);
for (const [label, pattern] of [
  ["appId", /appId:\s*WINDOWS_APP_USER_MODEL_ID/],
  ["quoted relaunchCommand", /relaunchCommand:\s*`"\$\{relaunchExecutable\}"`/],
  ["relaunchDisplayName", /relaunchDisplayName:\s*"Rowboat"/],
  ["appIconPath", /appIconPath:\s*relaunchIcon/],
  ["appIconIndex", /appIconIndex:\s*0/],
]) {
  assert.match(detailSlice, pattern, `setAppDetails must include ${label}`);
}

for (const pattern of [
  /path\.join\(squirrelInstallRoot, "rowboat\.exe"\)/,
  /path\.join\(squirrelInstallRoot, "app\.ico"\)/,
  /fs\.existsSync\(installedLauncher\)\s*\?\s*installedLauncher\s*:\s*process\.execPath/,
  /fs\.existsSync\(installedIcon\)\s*\?\s*installedIcon\s*:\s*process\.execPath/,
]) {
  assert.match(mainSource, pattern, "Stable Squirrel launcher/icon paths and safe fallbacks must remain present");
}

assert.match(forgeSource, /executableName:\s*'rowboat'/, "Executable basename must stay aligned with the AUMID");
assert.match(forgeSource, /name:\s*`Rowboat-win32-\$\{arch\}`/, "Squirrel package name must stay aligned with the AUMID");
assert.match(forgeSource, /setupIcon:\s*path\.join\(__dirname, 'icons\/icon\.ico'\)/, "Squirrel setup must use the multiresolution icon");
assert.equal(
  packageJson.scripts?.["verify:windows-packaging"],
  "node scripts/verify-windows-packaging.mjs",
  "The source-level verifier must remain available as a package script",
);

const bundleCommand = "node scripts/verify-windows-packaging.mjs --require-bundle";
assert.equal(countOccurrences(forgeSource, bundleCommand), 1, "Windows packaging must run the regression verifier exactly once");
const bundleBuildIndex = forgeSource.indexOf("node bundle.mjs");
const bundleVerifyIndex = forgeSource.indexOf(bundleCommand);
const bundlePlatformGuardIndex = forgeSource.lastIndexOf("if (platform === 'win32') {", bundleVerifyIndex);
assert.ok(bundleVerifyIndex > bundleBuildIndex, "Windows regression verification must run after main-process bundling");
assert.ok(bundlePlatformGuardIndex > bundleBuildIndex && bundleVerifyIndex - bundlePlatformGuardIndex < 800, "Bundle verification must be inside a nearby Windows-only packaging guard");

let bundleChecked = false;
if (fs.existsSync(bundlePath)) {
  const bundle = fs.readFileSync(bundlePath, "utf8");
  const requiredBundleFragments = [
    "com.squirrel.Rowboat-win32-${process.arch}.rowboat",
    ".setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)",
    ".setAppDetails({",
    "appId: WINDOWS_APP_USER_MODEL_ID",
    'relaunchCommand: `"${relaunchExecutable}"`',
    'relaunchDisplayName: "Rowboat"',
    "appIconPath: relaunchIcon",
    "appIconIndex: 0",
    '"rowboat.exe"',
    '"app.ico"',
  ];
  for (const fragment of requiredBundleFragments) {
    assert.ok(bundle.includes(fragment), `Built bundle must contain: ${fragment}`);
  }
  const bundleIdentityIndex = bundle.indexOf(".setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)");
  const bundleLockIndex = bundle.indexOf(".requestSingleInstanceLock()");
  const bundleWindowIndex = bundle.indexOf(".BrowserWindow(");
  const bundleDetailsIndex = bundle.indexOf(".setAppDetails({");
  assert.ok(bundleIdentityIndex >= 0 && bundleIdentityIndex < bundleLockIndex, "Built bundle must set AppUserModelID before the single-instance lock");
  assert.ok(bundleWindowIndex >= 0 && bundleDetailsIndex > bundleWindowIndex, "Built bundle must set taskbar details after creating its BrowserWindow");
  bundleChecked = true;
} else {
  assert.equal(requireBundle, false, `Required built bundle is missing: ${bundlePath}`);
}

console.log(JSON.stringify({
  verdict: "PASS_WINDOWS_PACKAGING_REGRESSION_CHECKS",
  appUserModelIdTemplate: "com.squirrel.Rowboat-win32-${arch}.rowboat",
  iconFrames: sizes,
  sourceChecks: true,
  packagingHookCheck: true,
  builtBundleCheck: bundleChecked,
}, null, 2));
