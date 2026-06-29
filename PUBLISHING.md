# Publishing UACE

UACE ships as **two artifacts**:

1. **`uace-mcp`** — the MCP server, published to **npm**. Any AI tool can use it, and the
   VS Code extension installs it on first run.
2. **`uace-dashboard`** — the VS Code extension, published to **both** the **VS Code
   Marketplace** (for official VS Code) and the **Open VSX Registry** (for VS Code forks —
   Cursor, Antigravity, VSCodium, Windsurf). It bootstraps the server, registers it with VS
   Code's Copilot agent, and shows the dashboard.

> **Why two marketplaces?** Microsoft's Marketplace is consumable only by official VS Code;
> its terms bar forks. The forks instead read **Open VSX** (Antigravity directly; Cursor via
> its `marketplace.cursorapi.com` mirror, which lags and is client-cached — restart Cursor
> after publishing). Skip Open VSX and the extension is invisible everywhere except VS Code.

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

An icon is already included at `extension/media/icon.png` and referenced in the manifest.

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

## 2b. Publish the extension to Open VSX (Cursor / Antigravity / VSCodium)

One-time setup:

1. Sign in at <https://open-vsx.org> with GitHub and create an **access token** under
   Settings → Access Tokens.
2. Sign the **Eclipse Publisher Agreement** (prompted on first publish).
3. Create your namespace (must match `extension/package.json` → `publisher`):
   ```bash
   npx ovsx create-namespace <your-publisher-id> -p <OPEN_VSX_TOKEN>
   ```

Publish (reuse the `.vsix` produced above so it's identical to the Marketplace build):

```bash
cd extension
npx ovsx publish uace-dashboard-<version>.vsix -p <OPEN_VSX_TOKEN>
```

Verify: <https://open-vsx.org/extension/<your-publisher-id>/uace-dashboard>. Antigravity
picks it up almost immediately; **Cursor needs a restart** to refresh its cached gallery,
then search by name (e.g. "UACE") — install-by-exact-ID may 404 until the publisher is
[verified on Cursor](https://forum.cursor.com/c/extension-verification) (needs a website on
a real domain linked from the Open VSX `homepage` field).

## 3. Order of operations

Publish **npm first**, then the extension — the extension's first-run bootstrap installs
`uace-mcp@<SERVER_VERSION>` from npm, so that version must exist.

## 4. Local development / pre-publish testing

To run the extension via F5 **before** publishing to npm, point it at your local server
build so it skips the npm install:

1. `npm run build` (repo root) to produce `dist/server.js`.
2. In the Extension Development Host, set **`uace.serverPath`** to the absolute path of
   `…/UACE/dist/server.js`.

## 5. Automated releases (CI)

A workflow is included at `.github/workflows/release.yml`. Once your code is on GitHub:

1. Add repository secrets **`NPM_TOKEN`** (npm automation token), **`VSCE_PAT`** (the
   Azure DevOps PAT), and **`OVSX_PAT`** (the Open VSX access token).
2. Bump the version in both `package.json` files and `SERVER_VERSION` in
   `extension/src/serverBootstrap.ts`.
3. Tag and push:
   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```
   The workflow publishes the npm package first, then packages the extension once and
   publishes that same `.vsix` to **both** the VS Code Marketplace and Open VSX.

   > The Open VSX namespace must already exist (one-time
   > `npx ovsx create-namespace <publisher> -p <token>` — see §2b).
