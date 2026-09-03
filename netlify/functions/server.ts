import path from 'node:path';
import { createRequestHandler } from 'expo-server/adapter/netlify';

/**
 * Expo Router server + API routes (`app/api/**/+api.ts`).
 * Must be a Netlify Functions 2.0 default export (not `handler`).
 */
export default createRequestHandler({
  build: path.join(__dirname, '../../dist/server'),
});
