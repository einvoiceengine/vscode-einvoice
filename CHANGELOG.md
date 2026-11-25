# Changelog

## 0.1.0

- First release.
- **E-Invoice: Validate current file** for `.xml` (XRechnung, EN 16931 UBL / CII, Peppol BIS, Facturae, KSeF) and `.pdf` (ZUGFeRD / Factur-X). Findings in the Problems panel with rule id, line and a link to the rule page where one exists.
- Status bar item with the result for the active file.
- Optional validate-on-save (`einvoice.validateOnSave`, off by default).
- API key in SecretStorage (**E-Invoice: Set API key** / **Remove API key**); without a key the free public check is used.
- Settings for base URL and language of explanations. No telemetry.
