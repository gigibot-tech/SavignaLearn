import path from 'node:path';
import { createRequestHandler } from 'expo-server/adapter/netlify';

// Expo Router server + API routes (app/api). Netlify Functions 2.0 default export.
export default createRequestHandler({
  build: path.join(__dirname, '../../dist/server'),
});
