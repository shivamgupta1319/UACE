# Publishing UACE

UACE ships as **two artifacts**:

1. **`uace-mcp`** — the MCP server, published to **npm**. Any AI tool can use it, and the
   VS Code extension installs it on first run.
2. **`uace-dashboard`** — the VS Code extension, published to the **VS Code Marketplace**.
   It bootstraps the server, registers it with VS Code's Copilot agent, and shows the
   dashboard.

> Before publishing, replace placeholder identity fields with your own:
> - Root `package.json`: `name` (`uace-mcp` must be free on npm, or use a scope like
>   `@yourname/uace-mcp`), `author`, `repository`, `homepage`.
> - `extension/package.json`: `publisher` (your **Marketplace publisher id**), `repository`.
> - If you change the server package name, update `SERVER_PACKAGE` in
>   `extension/src/serverBootstrap.ts`.

---

## 1. Publish the server to npm

```bash
# from the repo root
npm login                      # one-time; create an account at npmjs.com first
npm run build
npm publish --access public    # 'prepublishOnly' rebuilds automatically
```

Verify: `npm view uace-mcp version`. Any tool can now run it via
`npx -y uace-mcp` or `claude mcp add uace -- npx -y uace-mcp`.

Keep `SERVER_VERSION` in `extension/src/serverBootstrap.ts` in sync with the published
version so the extension installs the matching server.

## 2. Publish the extension to the VS Code Marketplace

One-time setup:

1. Create a **publisher** at <https://marketplace.visualstudio.com/manage> (the id goes in
   `extension/package.json` → `publisher`).
2. Create an **Azure DevOps Personal Access Token** with **Marketplace → Manage** scope:
   <https://dev.azure.com> → User settings → Personal access tokens.
3. (Recommended) Add a 128×128 PNG `extension/media/icon.png` and reference it via
   `"icon": "media/icon.png"` in `extension/package.json` — Marketplace listings look much
   better with one.

Publish:

```bash
cd extension
npm install
npx @vscode/vsce login <your-publisher-id>   # paste the PAT
npx @vscode/vsce publish                      # builds via 'vscode:prepublish' and uploads
```

Or package locally and upload the `.vsix` manually at the Marketplace manage page:

```bash
cd extension
npx @vscode/vsce package        # produces uace-dashboard-<version>.vsix
```

## 3. Order of operations

Publish **npm first**, then the extension — the extension's first-run bootstrap installs
`uace-mcp@<SERVER_VERSION>` from npm, so that version must exist.

## 4. Local development / pre-publish testing

To run the extension via F5 **before** publishing to npm, point it at your local server
build so it skips the npm install:

1. `npm run build` (repo root) to produce `dist/server.js`.
2. In the Extension Development Host, set **`uace.serverPath`** to the absolute path of
   `…/UACE/dist/server.js`.

## 5. Optional: automate with CI

A tag-triggered GitHub Actions workflow can run `npm publish` and `vsce publish` together.
Store `NPM_TOKEN` and `VSCE_PAT` as repository secrets.
