const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// react-native-fast-tflite loads the .tflite model as a bundled asset via
// require() — Metro treats unknown extensions as source code by default,
// so without this it tries to parse the binary model file as JS and fails.
config.resolver.assetExts.push('tflite');

module.exports = config;

