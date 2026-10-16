import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = name => crypto.createHash('sha256').update(name).digest('hex').slice(0, 24).toUpperCase();
const quote = value => JSON.stringify(value);
const files = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? files(full) : [path.relative(root, full).replaceAll('\\', '/')];
});
const appSources = files(path.join(root, 'RoomCanvas')).filter(file => file.endsWith('.swift')).sort();
const testSources = files(path.join(root, 'RoomCanvasTests')).filter(file => file.endsWith('.swift')).sort();
const resources = ['RoomCanvas/Assets.xcassets', 'RoomCanvas/PrivacyInfo.xcprivacy'];
const objects = [];
const add = (key, definition) => objects.push(`${id(key)} = { ${definition} };`);
const refs = array => `(${array.map(value => `${id(value)},`).join(' ')})`;
const settingString = settings => Object.entries(settings).map(([key, value]) => `${quote(key)} = ${Array.isArray(value) ? `(${value.map(quote).join(', ')},)` : quote(value)};`).join(' ');

for (const file of [...appSources, ...testSources, ...resources, 'RoomCanvas/Info.plist']) {
  const type = file.endsWith('.swift') ? 'sourcecode.swift' : file.endsWith('.xcassets') ? 'folder.assetcatalog' : file.endsWith('.xcprivacy') ? 'text.xml' : 'text.plist.xml';
  add(`ref:${file}`, `isa = PBXFileReference; lastKnownFileType = ${type}; path = ${quote(file)}; sourceTree = SOURCE_ROOT;`);
  if (!file.endsWith('Info.plist')) add(`build:${file}`, `isa = PBXBuildFile; fileRef = ${id(`ref:${file}`)};`);
}
add('product:app', 'isa = PBXFileReference; explicitFileType = wrapper.application; path = RoomCanvas.app; sourceTree = BUILT_PRODUCTS_DIR;');
add('product:tests', 'isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = RoomCanvasTests.xctest; sourceTree = BUILT_PRODUCTS_DIR;');
add('group:app', `isa = PBXGroup; name = RoomCanvas; children = ${refs([...appSources, ...resources, 'RoomCanvas/Info.plist'].map(file => `ref:${file}`))}; sourceTree = "<group>";`);
add('group:tests', `isa = PBXGroup; name = RoomCanvasTests; children = ${refs(testSources.map(file => `ref:${file}`))}; sourceTree = "<group>";`);
add('group:products', `isa = PBXGroup; name = Products; children = ${refs(['product:app', 'product:tests'])}; sourceTree = "<group>";`);
add('group:main', `isa = PBXGroup; children = ${refs(['group:app', 'group:tests', 'group:products'])}; sourceTree = "<group>";`);
for (const [target, sources] of [['app', appSources], ['tests', testSources]]) {
  add(`sources:${target}`, `isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ${refs(sources.map(file => `build:${file}`))}; runOnlyForDeploymentPostprocessing = 0;`);
  add(`frameworks:${target}`, 'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;');
  add(`resources:${target}`, `isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ${refs(target === 'app' ? resources.map(file => `build:${file}`) : [])}; runOnlyForDeploymentPostprocessing = 0;`);
}
add('test:proxy', `isa = PBXContainerItemProxy; containerPortal = ${id('project')}; proxyType = 1; remoteGlobalIDString = ${id('target:app')}; remoteInfo = RoomCanvas;`);
add('test:dependency', `isa = PBXTargetDependency; target = ${id('target:app')}; targetProxy = ${id('test:proxy')};`);
add('target:app', `isa = PBXNativeTarget; buildConfigurationList = ${id('configlist:app')}; buildPhases = ${refs(['sources:app', 'frameworks:app', 'resources:app'])}; buildRules = (); dependencies = (); name = RoomCanvas; productName = RoomCanvas; productReference = ${id('product:app')}; productType = "com.apple.product-type.application";`);
add('target:tests', `isa = PBXNativeTarget; buildConfigurationList = ${id('configlist:tests')}; buildPhases = ${refs(['sources:tests', 'frameworks:tests', 'resources:tests'])}; buildRules = (); dependencies = ${refs(['test:dependency'])}; name = RoomCanvasTests; productName = RoomCanvasTests; productReference = ${id('product:tests')}; productType = "com.apple.product-type.bundle.unit-test";`);

const common = {
  SDKROOT: 'iphoneos', IPHONEOS_DEPLOYMENT_TARGET: '17.0', SWIFT_VERSION: '5.0',
  CLANG_ENABLE_MODULES: 'YES', CLANG_ENABLE_OBJC_ARC: 'YES', SWIFT_STRICT_CONCURRENCY: 'minimal',
  ENABLE_USER_SCRIPT_SANDBOXING: 'YES', GCC_C_LANGUAGE_STANDARD: 'gnu17',
  SWIFT_EMIT_LOC_STRINGS: 'YES', CODE_SIGN_STYLE: 'Automatic',
};
for (const kind of ['project', 'app', 'tests']) {
  for (const config of ['Debug', 'Release']) {
    let settings;
    if (kind === 'project') settings = { ...common, DEBUG_INFORMATION_FORMAT: config === 'Debug' ? 'dwarf' : 'dwarf-with-dsym',
      SWIFT_OPTIMIZATION_LEVEL: config === 'Debug' ? '-Onone' : '-O',
      SWIFT_ACTIVE_COMPILATION_CONDITIONS: config === 'Debug' ? 'DEBUG $(inherited)' : '$(inherited)',
      ENABLE_TESTABILITY: config === 'Debug' ? 'YES' : 'NO', ONLY_ACTIVE_ARCH: config === 'Debug' ? 'YES' : 'NO' };
    else if (kind === 'app') settings = {
      PRODUCT_NAME: '$(TARGET_NAME)', PRODUCT_BUNDLE_IDENTIFIER: 'app.roomcanvas.scanner',
      INFOPLIST_FILE: 'RoomCanvas/Info.plist', GENERATE_INFOPLIST_FILE: 'NO',
      ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon', ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: 'AccentColor',
      TARGETED_DEVICE_FAMILY: '1,2', SUPPORTED_PLATFORMS: 'iphoneos iphonesimulator',
      SUPPORTS_MACCATALYST: 'NO', SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD: 'NO',
      LD_RUNPATH_SEARCH_PATHS: ['$(inherited)', '@executable_path/Frameworks'],
    };
    else settings = {
      PRODUCT_NAME: '$(TARGET_NAME)', PRODUCT_BUNDLE_IDENTIFIER: 'app.roomcanvas.scanner.tests',
      GENERATE_INFOPLIST_FILE: 'YES', TARGETED_DEVICE_FAMILY: '1,2',
      TEST_HOST: '$(BUILT_PRODUCTS_DIR)/RoomCanvas.app/RoomCanvas',
      BUNDLE_LOADER: '$(TEST_HOST)', LD_RUNPATH_SEARCH_PATHS: ['$(inherited)', '@executable_path/Frameworks', '@loader_path/Frameworks'],
    };
    add(`config:${kind}:${config}`, `isa = XCBuildConfiguration; buildSettings = { ${settingString(settings)} }; name = ${config};`);
  }
  add(`configlist:${kind}`, `isa = XCConfigurationList; buildConfigurations = ${refs([`config:${kind}:Debug`, `config:${kind}:Release`])}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`);
}
add('project', `isa = PBXProject; attributes = { BuildIndependentTargetsInParallel = YES; LastSwiftUpdateCheck = 1600; LastUpgradeCheck = 1600; TargetAttributes = { ${id('target:app')} = { CreatedOnToolsVersion = 16.0; }; ${id('target:tests')} = { CreatedOnToolsVersion = 16.0; TestTargetID = ${id('target:app')}; }; }; }; buildConfigurationList = ${id('configlist:project')}; compatibilityVersion = "Xcode 14.0"; developmentRegion = zh-Hans; hasScannedForEncodings = 0; knownRegions = (en, "zh-Hans", Base); mainGroup = ${id('group:main')}; productRefGroup = ${id('group:products')}; projectDirPath = ""; projectRoot = ""; targets = ${refs(['target:app', 'target:tests'])};`);

const project = path.join(root, 'RoomCanvas.xcodeproj');
fs.mkdirSync(path.join(project, 'xcshareddata', 'xcschemes'), { recursive: true });
fs.writeFileSync(path.join(project, 'project.pbxproj'), `// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n${objects.join('\n')}\n}; rootObject = ${id('project')}; }\n`);
const reference = (target, product) => `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id(`target:${target}`)}" BuildableName="${product}" BlueprintName="${target === 'app' ? 'RoomCanvas' : 'RoomCanvasTests'}" ReferencedContainer="container:RoomCanvas.xcodeproj"/>`;
fs.writeFileSync(path.join(project, 'xcshareddata', 'xcschemes', 'RoomCanvas.xcscheme'), `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.7">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
<BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${reference('app', 'RoomCanvas.app')}</BuildActionEntry>
</BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">${reference('tests', 'RoomCanvasTests.xctest')}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">${reference('app', 'RoomCanvas.app')}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${reference('app', 'RoomCanvas.app')}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>\n`);
console.log(`Generated RoomCanvas.xcodeproj (${appSources.length} app sources, ${testSources.length} test sources).`);
