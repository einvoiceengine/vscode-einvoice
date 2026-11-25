# E-Invoice Validator for VS Code

Validate European e-invoices inside VS Code: XRechnung 3.0, EN 16931 (UBL and CII), Peppol BIS Billing 3.0, ZUGFeRD / Factur-X (XML or PDF/A-3), Facturae 3.2.x and KSeF FA(3). Errors land in the **Problems** panel with the rule id (for example `BR-DE-15`), the line, and a plain explanation with a suggested fix.

Validation runs on the [E-Invoicing API](https://einvoiceengine.com) with the official rule set of each format (KoSIT validator with the XRechnung configuration, the CEN EN 16931 Schematron, Peppol BIS, the Facturae and KSeF schemas). Validity is decided by those rule sets on the server, not by this extension. Technical validation does not establish legal validity.

Works without setup: with no API key it uses the free public check.

## Usage

1. Open an invoice (`.xml`), or select an `.xml` or `.pdf` file in the Explorer.
2. Run **E-Invoice: Validate current file** from the Command Palette, the editor context menu, or the Explorer context menu.
3. Read the results in the **Problems** panel. Rule ids that have a reference page on einvoiceengine.com are links; click one to read what the rule means and how to fix it.

The status bar shows the result for the active file (`valid` or `N errors`); click it to validate again. A log of every check is in **Output → E-Invoice**.

## API key (optional)

Without a key the extension calls the free public endpoint, which allows a few checks per day per IP address. A free sandbox key (`einv_test_…`) removes the daily limit:

1. Create a key at <https://einvoiceengine.com/login?next=/dashboard/keys> (no credit card).
2. Run **E-Invoice: Set API key** and paste it.

The key is kept in VS Code's SecretStorage (your operating system's keychain), never in `settings.json`. **E-Invoice: Remove API key** deletes it. A live key (`einv_live_…`) works too.

## Settings

| Setting | Default | |
|---|---|---|
| `einvoice.validateOnSave` | `false` | Validate `.xml` invoices on every save. XML files that are not invoices (no UBL, CII, Facturae or KSeF root element) are skipped. Each save counts as one check. |
| `einvoice.language` | same as VS Code | Language of explanations: en, de, fr, es, it, pl, nl, pt. |
| `einvoice.baseUrl` | `https://einvoiceengine.com` | Only for a self-hosted installation. User setting only, so a workspace cannot send your key elsewhere. |

## Privacy

- **The file content is sent to einvoiceengine.com** (or your `einvoice.baseUrl`) over HTTPS for every check. Nothing is sent until you run the command or turn on validate-on-save.
- **Without a key** the public endpoint keeps the document in memory for the duration of the request and does not store it. To enforce the daily limit it keeps a counter per hashed IP address, and it records that a check happened with its result status and detected format.
- **With a key** the extension asks the API not to store the document (`store=false`). The check counts towards your plan's usage.
- **No telemetry.** The extension itself collects nothing and sends nothing except the validation request.

## Supported files

| Format | File |
|---|---|
| XRechnung 3.0 (UBL or CII) | `.xml` |
| EN 16931 (UBL 2.1, UN/CEFACT CII D16B) | `.xml` |
| Peppol BIS Billing 3.0 | `.xml` |
| ZUGFeRD 2.x / Factur-X 1.0 | `.pdf` (PDF/A-3 with embedded XML) or the CII `.xml` |
| Facturae 3.2 / 3.2.1 / 3.2.2 | `.xml` |
| KSeF FA(3) | `.xml` |

Files up to 2 MB on the free check; larger files with an API key.

## Development

```bash
npm install
npm test            # offline tests of the validation core
npm run test:live   # also calls the free public endpoint (uses two of today's checks)
npx @vscode/vsce package
```

To try a local build: **Extensions → … → Install from VSIX…** and pick the packaged file.

## Links

- API docs: <https://einvoiceengine.com/docs>
- Rule reference: <https://einvoiceengine.com/rules>
- Support: <support@einvoiceengine.com>

## License

MIT
