const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const sharedDirectory = path.resolve(__dirname, '../../shared');
config.watchFolders = [...config.watchFolders, sharedDirectory, path.resolve(__dirname, '../../docs')];
// shared/ is compiled by Node with explicit `.js` extensions on relative imports; Metro looks for the TypeScript source.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromShared = context.originModulePath.startsWith(sharedDirectory);
  return context.resolveRequest(context, fromShared && /^\.{1,2}\/.*\.js$/.test(moduleName) ? moduleName.slice(0, -3) : moduleName, platform);
};

module.exports = withNativeWind(config, {
  input: './src/global.css',
});
