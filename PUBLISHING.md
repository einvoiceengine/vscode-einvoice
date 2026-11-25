# Publishing the VS Code extension (owner steps)

Nothing here has been published yet. The extension id is `einvoiceengine.einvoice-validator`, version 0.1.0. All commands run in this folder (`einvoicing_api/publish/vscode-extension`) unless they say otherwise.

## 0. Build and check

```bash
npm install
npm test
npx @vscode/vsce package        # writes einvoice-validator-0.1.0.vsix (about 95 KB)
```

Optional: install the .vsix in VS Code (**Extensions → … → Install from VSIX…**), open an XRechnung file and run **E-Invoice: Validate current file**.

## 1. Public GitHub repo `einvoiceengine/vscode-einvoice`

The `repository` field in `package.json` points here, and both marketplaces link to it.

1. On GitHub, signed in to the `einvoiceengine` organization: **New repository** → name `vscode-einvoice`, Public, no README, no license (both are in this folder).
2. Copy this folder into a fresh repo (without `node_modules`, `dist`, `*.vsix`) and push with the public author:

```bash
rm -rf /tmp/vscode-einvoice && mkdir /tmp/vscode-einvoice
rsync -a --exclude node_modules --exclude dist --exclude '*.vsix' ./ /tmp/vscode-einvoice/
cd /tmp/vscode-einvoice
git init -b main
git add .
git -c user.name="E-Invoicing API" -c user.email="support@einvoiceengine.com" commit -m "E-Invoice Validator for VS Code 0.1.0"
git remote add origin git@github.com:einvoiceengine/vscode-einvoice.git
git push -u origin main
```

3. In the repo settings add the description "Validate XRechnung, ZUGFeRD, Peppol and other e-invoices in VS Code" and the website `https://einvoiceengine.com`.

## 2. Visual Studio Marketplace

1. **Azure DevOps organization.** Sign in at <https://dev.azure.com> with the Microsoft account that should own the publisher (create a free organization if asked).
2. **Personal access token.** In Azure DevOps: **User settings → Personal access tokens → New Token**.
   - Name: `vsce`
   - Organization: **All accessible organizations** (required by the Marketplace)
   - Scopes: **Custom defined → Show all scopes → Marketplace → Manage**
   - Copy the token; it is shown once.
3. **Publisher.** Open <https://marketplace.visualstudio.com/manage>, sign in with the same account, **Create publisher**:
   - ID: `einvoiceengine` (must match `publisher` in `package.json`; cannot be changed later)
   - Name: `E-Invoicing API`
   - Website `https://einvoiceengine.com`, support email `support@einvoiceengine.com`, logo `images/icon.png`
4. **Log in and publish:**

```bash
npx @vscode/vsce login einvoiceengine     # paste the PAT
npx @vscode/vsce publish                  # or: npx @vscode/vsce publish --packagePath einvoice-validator-0.1.0.vsix
```

5. The listing appears at <https://marketplace.visualstudio.com/items?itemName=einvoiceengine.einvoice-validator> after a few minutes (Microsoft runs a malware scan first).
6. Optional: verify the domain `einvoiceengine.com` on the publisher page (**Verified domain**, a DNS TXT record) to get the blue check.

If Azure DevOps no longer offers "All accessible organizations" for PATs, publish with Microsoft Entra ID instead: `az login`, then `npx @vscode/vsce publish --azure-credential` (see the vsce documentation).

Later versions: raise `version` in `package.json`, add a CHANGELOG entry, then `npx @vscode/vsce publish`.

## 3. Open VSX (VSCodium, Cursor, Windsurf, Gitpod, Theia)

1. **Eclipse account.** Create one at <https://accounts.eclipse.org/user/register> (use the support address or the owner's address). In the Eclipse profile, set the **GitHub username** field to the GitHub account you will log in with.
2. **Open VSX login.** Go to <https://open-vsx.org>, **Log in** with that GitHub account, open **Settings → Profile**, **Log in with Eclipse**, and sign the **Eclipse Foundation Open VSX Publisher Agreement**.
3. **Access token.** **Settings → Access Tokens → Generate New Token** (name `ovsx`). Copy it.
4. **Namespace and publish:**

```bash
export OVSX_PAT=<token>
npx ovsx create-namespace einvoiceengine          # once; the namespace must equal the publisher
npx ovsx publish einvoice-validator-0.1.0.vsix     # publish the same file as the Marketplace
```

5. Optional, for the verified badge: open an issue "Claim namespace einvoiceengine" at <https://github.com/EclipseFdn/open-vsx.org/issues> linking the GitHub organization `einvoiceengine`.

Open VSX needs a license file and a repository URL; both are present (`LICENSE`, `repository` in `package.json`).

## 4. After publishing

- Add the Marketplace and Open VSX links to `/integrations` on einvoiceengine.com and to the GitHub repo README.
- Keep `RULE_PAGES` in `src/core.ts` in step with `apps/web/src/lib/rules-library.ts` when rule pages are added, and release a new version.
