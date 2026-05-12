# Tunnel Sentry — Tunnel AI Analytics Dashboard

A two-tier web application that visualizes per-device / per-app tunnel traffic
captured by the UEM agent, lets administrators inspect red-flag domains, and
publishes block / unblock rules back to the UEM (MDM) backend.

- **Web UI** — React 19 + Vite + Recharts
- **API service** — Node.js + Express + MSSQL (`mssql` / `msnodesqlv8`)
- **Hosting** — IIS sub-applications under the default site, with URL Rewrite
  reverse-proxying API traffic to the local Node process

Live sample environment:

| Surface | URL |
| ------- | --- |
| Web app | <https://snl.ssdevrd.com/snlweb/> |
| API (via IIS proxy) | <https://snl.ssdevrd.com/snlapi/api/<path>> |

---

## 1. Architecture

```
                         ┌──────────────────────────────────────────┐
                         │                  IIS                     │
                         │  (Default Web Site, host: snl.ssdevrd…)  │
Browser ── HTTPS ───────►│                                          │
                         │  /snlweb/  ──► C:\snl\web\  (static SPA) │
                         │                                          │
                         │  /snlapi/  ──► C:\snl\api\               │
                         │              (web.config only —          │
                         │               URL Rewrite proxy)         │
                         └─────────────────────┬────────────────────┘
                                               │  rewrite ^api/(.*)
                                               ▼
                                ┌──────────────────────────────┐
                                │  Node API (Express)          │
                                │  http://localhost:3001       │
                                │  C:\snl\api-src\server\      │
                                │  started via `npm start`     │
                                └───────────┬──────────────────┘
                                            │
                       ┌────────────────────┼────────────────────────┐
                       ▼                                             ▼
            ┌────────────────────┐                    ┌────────────────────────┐
            │ MS SQL Server      │                    │ UEM / MDM backend      │
            │ snl-db @           │                    │ snl.ssdevrd.com/API/   │
            │ 10.14.65.238       │                    │ mdm/tunnel/...         │
            └────────────────────┘                    └────────────────────────┘
```

The **service layer** (`server/index.js`) is responsible for two outbound
integrations:

1. **Database** — reads device, traffic-rule and rule-set data from
   `snl-db` over MSSQL (trusted/SQL auth, configured at the top of
   `server/index.js`).
2. **UEM / MDM backend** — calls the external rule-set configuration and
   v2 query APIs (e.g. `https://snl.ssdevrd.com/API/mdm/tunnel/...`) to
   insert traffic rules, bump rule-set versions, and read back the
   authoritative per-app blocked-domain state.

The browser **never** calls the UEM backend or the database directly — it
only talks to `/snlapi/api/*`, which IIS reverse-proxies to the Node service.

---

## 2. Tech stack

| Layer    | Library / runtime                                      |
| -------- | ------------------------------------------------------ |
| UI       | React 19, React Router 7, Recharts 3, React-Icons      |
| Build    | Vite 8 (`@vitejs/plugin-react`)                        |
| Lint     | ESLint 9 (`eslint-plugin-react-hooks`)                 |
| API      | Node.js 20 LTS+, Express 5, CORS                       |
| Database | `mssql` 12 (driver: `msnodesqlv8` for SQL auth on Win) |
| Hosting  | IIS + URL Rewrite (no ARR required, see §6.2)          |

---

## 3. Repository layout

```
tunnelsnl/
├── public/                    Static assets bundled by Vite
├── src/                       React app source
│   ├── components/            Shared UI primitives
│   ├── context/AppContext.jsx Global state + API client (uses /snlapi/api)
│   └── pages/                 Dashboard, Configuration, etc.
├── server/
│   ├── index.js               Express app + SQL + UEM integration
│   ├── data/                  JSON seed / snapshot files
│   └── package.json           Server-only dependencies
├── package.json               Web app (React + Vite)
├── vite.config.js
├── index.html
└── README.md                  (this file)
```

`package.json` sets `"homepage": "/snlweb"` so that Vite produces an
`index.html` whose asset URLs are prefixed with `/snlweb/`. **Do not remove
this** unless you change the IIS application alias.

---

## 4. Local development

Prerequisites: Node.js 20+ and (optionally) access to the SNL database or
the `data/*.json` snapshots (which the server falls back to automatically
if SQL is unreachable).

```powershell
# 1) Install web-app deps
npm ci

# 2) Install API deps
cd server
npm ci
cd ..

# 3) Start the API (terminal A) — listens on http://localhost:3001
cd server
npm start

# 4) Start the Vite dev server (terminal B) — http://localhost:5173
npm run dev
```

During local dev, the React app's API base is controlled in
`src/context/AppContext.jsx`:

```js
// Local dev
// const API_BASE = 'http://localhost:3001/api';
// Production behind IIS proxy
const API_BASE = 'https://snl.ssdevrd.com/snlapi/api';
```

Switch the two `API_BASE` lines depending on whether you're running the
build locally or deploying to IIS, then rebuild.

---

## 5. Build commands

```powershell
# Lint
npm run lint

# Production build → dist\
npm run build

# Preview the production build locally
npm run preview
```

`npm run build` emits a fully hashed, minified SPA into `dist\`:

```
dist/
├── index.html
└── assets/
    ├── index-<hash>.js
    └── index-<hash>.css
```

---

## 6. Deployment to IIS

This is the exact topology used for the live sample environment.

```
Default Web Site (https://snl.ssdevrd.com)
├── snlweb   ──►  C:\snl\web    (static SPA — copy of dist\)
└── snlapi   ──►  C:\snl\api    (web.config only — reverse proxy)

Node API process (out of band, anywhere on disk, e.g. C:\snl\api-src\server)
└── http://localhost:3001
```

### 6.1 One-time prerequisites on the server

Run PowerShell **as Administrator**:

```powershell
# Enable IIS basics
Enable-WindowsOptionalFeature -Online -All -FeatureName `
  IIS-WebServerRole, IIS-WebServer, IIS-CommonHttpFeatures, `
  IIS-StaticContent, IIS-DefaultDocument, IIS-RequestFiltering, `
  IIS-ManagementConsole

# Install URL Rewrite (required for the proxy rule)
winget install Microsoft.URLRewrite

# Install Node.js LTS (v20+)
winget install OpenJS.NodeJS.LTS
```

> Because the rewrite target is `http://localhost:...` on the *same* box,
> **Application Request Routing (ARR) is not strictly required** — URL
> Rewrite alone will proxy to localhost. If you ever move the API to a
> different host you'll need to install ARR and enable its proxy toggle
> (IIS Manager → server node → *Application Request Routing Cache* →
> *Server Proxy Settings* → check **Enable proxy**).

### 6.2 Create the folders

```powershell
New-Item -ItemType Directory -Force C:\snl\web | Out-Null
New-Item -ItemType Directory -Force C:\snl\api | Out-Null
```

### 6.3 Deploy the web app (`snlweb`)

1. On your dev machine, build:

   ```powershell
   cd C:\path\to\tunnelsnl
   npm ci
   npm run build
   ```

2. Copy the contents of `dist\` into `C:\snl\web\`:

   ```powershell
   robocopy .\dist C:\snl\web /E
   ```

3. In **IIS Manager**:

   - Right-click **Default Web Site** → **Add Application…**
   - **Alias:** `snlweb`
   - **Physical path:** `C:\snl\web`
   - Pick (or create) an app pool with **No Managed Code**.

Browse to <https://snl.ssdevrd.com/snlweb/> — the dashboard should load.
(It may show an error banner until §6.4 is finished, since the API isn't
reachable yet.)

### 6.4 Deploy the API proxy (`snlapi`)

1. Drop the following file at **`C:\snl\api\web.config`** — this is the
   only file that lives in `C:\snl\api`. It tells IIS to rewrite every
   request matching `^api/(.*)` to the local Node process on port 3001:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <configuration>
     <system.webServer>
       <rewrite>
         <rules>
           <rule name="ProxyApiToLocalhost3001" stopProcessing="true">
             <match url="^api/(.*)" />
             <action
               type="Rewrite"
               url="http://localhost:3001/api/{R:1}"
               appendQueryString="true" />
           </rule>
         </rules>
       </rewrite>
     </system.webServer>
   </configuration>
   ```

2. In **IIS Manager**:

   - Right-click **Default Web Site** → **Add Application…**
   - **Alias:** `snlapi`
   - **Physical path:** `C:\snl\api`
   - Same app pool as `snlweb` is fine (No Managed Code).

3. Start the Node API (see §6.5). Then verify the proxy end-to-end:

   ```powershell
   curl https://snl.ssdevrd.com/snlapi/api/traffic-rules
   # should return a JSON array of traffic rules from SQL Server
   ```

### 6.5 Run the API service

The Node service is **not** hosted by IIS — IIS only forwards requests to
it. Copy the `server/` folder anywhere on the server box (e.g.
`C:\snl\api-src\server`), install deps, and start it:

```powershell
# Copy source to the server (example: from a release zip)
Expand-Archive .\server.zip -DestinationPath C:\snl\api-src -Force

cd C:\snl\api-src\server
npm ci --omit=dev

# Start the API — it listens on http://localhost:3001
npm start
```

For production, run it as a Windows service so it survives reboots and
crashes. The simplest option is [NSSM](https://nssm.cc/):

```powershell
winget install NSSM.NSSM

nssm install TunnelSNL-API "C:\Program Files\nodejs\node.exe" `
  "C:\snl\api-src\server\index.js"

nssm set TunnelSNL-API AppDirectory   "C:\snl\api-src\server"
nssm set TunnelSNL-API AppStdout      "C:\snl\api-src\server\logs\out.log"
nssm set TunnelSNL-API AppStderr      "C:\snl\api-src\server\logs\err.log"
nssm set TunnelSNL-API Start          SERVICE_AUTO_START

New-Item -ItemType Directory -Force C:\snl\api-src\server\logs | Out-Null
nssm start TunnelSNL-API

# Sanity check
Invoke-WebRequest http://localhost:3001/api/traffic-rules -UseBasicParsing |
  Select-Object -ExpandProperty StatusCode
```

Useful service commands:

```powershell
nssm restart TunnelSNL-API
nssm stop    TunnelSNL-API
nssm remove  TunnelSNL-API confirm   # uninstall
```

### 6.6 Configure database / UEM endpoints

Open `server/index.js` and review the top of the file:

```js
const sqlConfig = {
  server: '10.14.65.238',
  database: 'snl-db',
  // ...
  authentication: {
    type: 'default',
    options: { domain: '', userName: 'sa', password: '...' },
  },
};
```

For UEM endpoints the service honours these environment variables (set
them via `nssm set TunnelSNL-API AppEnvironmentExtra KEY=VALUE`):

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `EXTERNAL_BLOCK_API_BASE` | `https://snl.ssdevrd.com/API/mdm/tunnel/configuration-actions/device-traffic-rule-sets` | UEM rule-set configuration endpoint |
| `EXTERNAL_BLOCK_OG_UUID`  | `15269a42-...118205` | OG / tenant UUID used by the UEM API |
| `EXTERNAL_BLOCK_AUTH`     | _(empty)_ | Bearer / basic auth header forwarded to UEM |
| `MDM_V2_LIST_URL`         | `https://snl.ssdevrd.com/API/mdm/tunnel/v2/device-traffic-rule-sets` | UEM v2 query endpoint for current blocked-domain state |

---

## 7. End-to-end smoke test

From the server box:

```powershell
# Node API directly
Invoke-WebRequest http://localhost:3001/api/traffic-rules -UseBasicParsing

# API via IIS reverse proxy
Invoke-WebRequest https://snl.ssdevrd.com/snlapi/api/traffic-rules -UseBasicParsing

# Static SPA
Start-Process https://snl.ssdevrd.com/snlweb/
```

From any client machine, browse to
<https://snl.ssdevrd.com/snlweb/> and confirm:

- The dashboard renders with device counts and charts.
- The **Network** tab shows requests to
  `https://snl.ssdevrd.com/snlapi/api/...` returning HTTP 200.
- Clicking **Block** / **Unblock** on a domain triggers a UEM publish and
  the chart re-renders with the updated state.

---

## 8. Redeploy / update cycle

```powershell
# --- on dev machine ---
npm ci
npm run build

# --- copy artifacts to the server ---
# Web (overwrite static files, but keep nothing else in C:\snl\web)
robocopy .\dist           \\SERVER\c$\snl\web /E /MIR

# Server source (skip node_modules — we'll reinstall on the box)
robocopy .\server         \\SERVER\c$\snl\api-src\server /E /XD node_modules

# --- on the server ---
cd C:\snl\api-src\server
npm ci --omit=dev
nssm restart TunnelSNL-API
iisreset /noforce
```

> If you don't use NSSM and instead started the API with `npm start` in an
> interactive shell, you must stop and restart that shell after copying
> new server code.

---

## 9. Troubleshooting

| Symptom | Likely cause / fix |
| ------- | ------------------ |
| `/snlweb/` shows IIS default page or 403 | The `snlweb` IIS application wasn't created, or `C:\snl\web\index.html` is missing. Re-run §6.3. |
| Assets 404 with paths like `/assets/...` | `package.json` `homepage` is not `/snlweb`, or you copied `dist\index.html` but not the rest of `dist\`. Rebuild and recopy. |
| `/snlapi/api/*` returns **500.19** | Web.config is malformed or **URL Rewrite** is not installed on the IIS box. Install it (§6.1) and reset IIS. |
| `/snlapi/api/*` returns **502 / 504** | The Node API isn't running. Check `Get-Service TunnelSNL-API` or run `npm start` in `C:\snl\api-src\server`. |
| Dashboard loads but every chart says **"No data"** | API is up but SQL is unreachable — the server falls back to seed JSON. Inspect `server\logs\err.log`. |
| Block / Unblock returns success but UEM state doesn't change | Either `EXTERNAL_BLOCK_AUTH` is empty / expired, or the UEM endpoint is unreachable from the API box. |
| CORS errors in browser DevTools | The build is still pointing at `http://localhost:3001/api`. Flip `API_BASE` in `src/context/AppContext.jsx` to `https://snl.ssdevrd.com/snlapi/api`, rebuild, redeploy. |

---

## 10. Quick command reference

```powershell
# Build
npm ci
npm run build
cd server ; npm ci --omit=dev ; cd ..

# Deploy (single box; adjust paths as needed)
robocopy .\dist   C:\snl\web              /E /MIR
robocopy .\server C:\snl\api-src\server   /E /XD node_modules
cd C:\snl\api-src\server ; npm ci --omit=dev ; cd \

# Start API (interactive)
cd C:\snl\api-src\server
npm start
# …or as a service:
nssm restart TunnelSNL-API

# Reload IIS
iisreset /noforce
```

---

## 11. License

Internal project. All rights reserved.
