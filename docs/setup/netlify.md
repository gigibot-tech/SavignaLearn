# Netlify (web production)

SavignaLearn is **not** a Vite SPA. It is Expo Router with `web.output: "server"` so `/api/*` routes exist in production. fourSome’s Netlify site is a **static Expo SPA** (`web.output: "single"`). Copying fourSome’s publish dir / SPA fallback would drop OpenAI, on-prem, fourSome, and health proxies.

## Dashboard (connect Git or CLI)

| Setting | Value |
|---------|--------|
| **Base directory** | repo root (`SavignaLearn`) |
| **Build command** | `npm run build:web` (`expo export -p web`) |
| **Publish directory** | `dist/client` |
| **Functions directory** | `netlify/functions` |
| **Node** | 22 (`netlify.toml` sets `NODE_VERSION`; required by `@supabase/supabase-js` realtime) |

`netlify.toml` already encodes build, publish, functions, and the 404 fallback to `/.netlify/functions/server`. Do not add `public/_redirects` with `/* /index.html 200` — that intercepts `/api/*`.

Local production check:

```bash
npm run build:web
npm run serve:web
```

Then `netlify deploy` / `netlify deploy --prod` (or Git-connected continuous deploy).

## Environment variables

`EXPO_PUBLIC_*` are **inlined at build time** into the client bundle. Change them → rebuild.

Set these in Netlify → Site configuration → Environment variables (build **and** functions):

| Variable | When |
|----------|------|
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | SavignaLearn `savigna_*` chat tables |
| `EXPO_PUBLIC_IDO_SUPABASE_*` | iDO sign-in + `ai-assist` |
| `EXPO_PUBLIC_FOURSOME_SUPABASE_*` | fourSome sign-in |
| `EXPO_PUBLIC_AI_BACKEND` | default chip (`demo` if unset). Marked as a Netlify secret would fail the build because `demo` appears throughout the repo; `netlify.toml` omits this key (and `EXPO_PUBLIC_OPENAI_MODEL` / `EXPO_PUBLIC_CHAT_COMPLETION_URL`) from secrets scanning. Do not omit API keys. |
| `EXPO_PUBLIC_OPENAI_API_KEY` | client “key configured” + native OpenAI |
| `OPENAI_API_KEY` | **server** `/api/openai/chat` (preferred; not `EXPO_PUBLIC_`) |
| `EXPO_PUBLIC_OPENAI_MODEL` | optional, default `gpt-4o-mini` |
| `EXPO_PUBLIC_ONPREM_CHAT_URL` | only if the on-prem host is reachable **from Netlify**, not `127.0.0.1` |
| `EXPO_PUBLIC_ENABLE_WEB_GEMMA` | in-tab WebGPU (client only) |

`OPENAI_API_KEY` must exist at **function runtime**. Build-only is not enough.

### Secrets scanning (false positives)

Netlify can mark env vars as **Contains secret values**, then fail the deploy if that **value** appears in the repo. That is not a leaked API key when the values are public config:

- `EXPO_PUBLIC_AI_BACKEND` = `demo`
- `EXPO_PUBLIC_OPENAI_MODEL` = `gpt-4o-mini`
- `EXPO_PUBLIC_CHAT_COMPLETION_URL` = the public fourSome chat URL

In **Project configuration → Environment variables**, edit those three and **turn off Contains secret values**. Keep it on for `OPENAI_API_KEY`, `EXPO_PUBLIC_OPENAI_API_KEY`, and Supabase keys.

`netlify.toml` also sets `SECRETS_SCAN_OMIT_KEYS` for the same three. If a team-level secret scan still fails, add that variable in the Netlify UI as well (same comma-separated list).

On-prem `localhost` URLs work with `expo start --web` on your machine. They do **not** work from Netlify’s cloud.

## Expo API routes on Netlify

`app/api/**/+api.ts` is **not** served from the static `dist/client` tree. Production web uses:

- `netlify/functions/server.ts` → `expo-server/adapter/netlify`
- `publish = dist/client`
- `[[redirects]]` `/*` → `/.netlify/functions/server` **status 404** (static files first; API + dynamic HTML via the function)

Routes that must hit the function:

- `POST /api/openai/chat` — browsers cannot call `api.openai.com` (CORS)
- `POST /api/onprem/chat`
- `POST /api/foursome/chat`
- `GET /api/health`

Without that adapter, a static Netlify site would 404 those paths. Demo / iDO / in-tab WebGPU Gemma can still work client-side.

`app.json` `expo-router` `origin` is `http://localhost:8081` for local web. Browser `fetch('/api/...')` is same-origin on Netlify. Point `origin` at the Netlify URL only if **native** clients should call this host.

Expo’s Netlify adapter is third-party and not continuously tested by Expo. EAS Hosting is the first-party alternative.

## Side by side with fourSome

| | fourSome (`frontend/`) | SavignaLearn |
|---|------------------------|--------------|
| Framework | Expo Router + Metro | Expo Router + Metro (**not Vite**) |
| `web.output` | `"single"` (one `index.html`) | `"server"` (client HTML + server bundle + API routes) |
| `netlify.toml` / `_redirects` in repo | **None** (live app is `4some.netlify.app`; settings live in the Netlify UI) | **This repo** (`netlify.toml` + `netlify/functions/server.ts`) |
| GitHub Actions | None | None |
| Build command | Not in `package.json`; typical Expo SPA: `npx expo export -p web` | `npm run build:web` → `expo export -p web` |
| Publish directory | `dist` (SPA root) | `dist/client` |
| SPA fallback | `/*` → `/index.html` **200** (Expo `public/_redirects` pattern) | **Do not use.** 404 → `/.netlify/functions/server` |
| Backend | Separate Python GiGi (`*.code.run`), OpenAI from the **client** via `EXPO_PUBLIC_OPENAI_API_KEY` | Expo `/api/*` on the same origin; `OPENAI_API_KEY` on the server function |
| Help/legal static site | `4some-help.netlify.app` (`4-some-policy/`, publish `out`) | n/a |

Related in-monorepo Netlify (not fourSome): GigolingoConcept uses `publish = dist` + SPA `/*` → `/index.html` and optional `/.netlify/functions`. That matches **static** Expo, not SavignaLearn’s server output.
