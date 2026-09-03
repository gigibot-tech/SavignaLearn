const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = true;
config.resolver.assetExts = [...new Set([...(config.resolver.assetExts ?? []), 'wasm', 'onnx'])];
// WebGemma loads Transformers.js from CDN at runtime; keep ONNX out of the export bundle.
config.resolver.blockList = [
  ...(config.resolver.blockList ?? []),
  /node_modules[/\\]onnxruntime-web[/\\].*/,
  /node_modules[/\\]onnxruntime-node[/\\].*/,
  /node_modules[/\\]@huggingface[/\\]transformers[/\\].*/,
];

module.exports = config;
