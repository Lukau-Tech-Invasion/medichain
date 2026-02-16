const { getDefaultConfig } = require('expo/metro-config');
const defaultConfig = getDefaultConfig(__dirname);

defaultConfig.resolver.extraNodeModules = {
  buffer: require.resolve('buffer/'),
  stream: require.resolve('stream-browserify'),
  crypto: require.resolve('react-native-crypto'),
  process: require.resolve('process/browser'),
};

module.exports = defaultConfig;
