import * as vscode from "vscode";
import { ApiError, DEFAULT_BASE_URL, KEYS_URL, isPdf, looksLikeInvoice, validate, type Result } from "./core";

const SECRET = "einvoice.apiKey";
const NOTICE_SHOWN = "einvoice.publicNoticeShown";
const VERSION = "0.1.0";

let diagnostics: vscode.DiagnosticCollection;
let status: vscode.StatusBarItem;
let output: vscode.OutputChannel;
/** last result per file, for the status bar */
const results = new Map<string, Result | "running">();

export function activate(context: vscode.ExtensionContext) {
  diagnostics = vscode.languages.createDiagnosticCollection("einvoice");
  output = vscode.window.createOutputChannel("E-Invoice");
  status = vscode.window.createStatusBarItem("einvoice.status", vscode.StatusBarAlignment.Left, 50);
  status.name = "E-Invoice validation";
  status.command = "einvoice.validate";
  context.subscriptions.push(diagnostics, output, status);

  context.subscriptions.push(
    vscode.commands.registerCommand("einvoice.validate", (uri?: vscode.Uri) => runValidate(context, uri ?? activeUri(), true)),
    vscode.commands.registerCommand("einvoice.setApiKey", () => setApiKey(context)),
    vscode.commands.registerCommand("einvoice.clearApiKey", async () => {
      await context.secrets.delete(SECRET);
      vscode.window.showInformationMessage("E-Invoice: API key removed. The free public check is used from now on.");
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!vscode.workspace.getConfiguration("einvoice", doc.uri).get<boolean>("validateOnSave", false)) return;
      if (!isXml(doc.uri)) return;
      const bytes = new TextEncoder().encode(doc.getText());
      if (looksLikeInvoice(bytes)) void runValidate(context, doc.uri, false);
    }),
    vscode.window.onDidChangeActiveTextEditor(() => updateStatus()),
    vscode.window.tabGroups.onDidChangeTabs(() => updateStatus()),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      // results of a closed file leave the Problems panel, like other linters
      if (results.has(doc.uri.toString())) {
        diagnostics.delete(doc.uri);
        results.delete(doc.uri.toString());
        updateStatus();
      }
    }),
  );
  updateStatus();
}

export function deactivate() {}

const isXml = (uri: vscode.Uri) => /\.xml$/i.test(uri.path);
const isPdfPath = (uri: vscode.Uri) => /\.pdf$/i.test(uri.path);

/** The file in the active tab: a text editor, or a PDF shown by a custom editor or preview. */
function activeUri(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) return editor.document.uri;
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) return input.uri;
  return undefined;
}

async function readBytes(uri: vscode.Uri): Promise<Uint8Array> {
  // an open XML file is sent as shown in the editor, unsaved changes included
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open && !isPdfPath(uri)) return new TextEncoder().encode(open.getText());
  return vscode.workspace.fs.readFile(uri);
}

async function runValidate(context: vscode.ExtensionContext, uri: vscode.Uri | undefined, explicit: boolean) {
  if (!uri || !(isXml(uri) || isPdfPath(uri))) {
    if (explicit) vscode.window.showWarningMessage("E-Invoice: open an .xml or .pdf invoice first (UBL, CII, XRechnung, Peppol BIS, Facturae, KSeF, ZUGFeRD / Factur-X).");
    return;
  }
  const key = uri.toString();
  if (results.get(key) === "running") return;

  let bytes: Uint8Array;
  try {
    bytes = await readBytes(uri);
  } catch (e) {
    vscode.window.showErrorMessage(`E-Invoice: could not read ${vscode.workspace.asRelativePath(uri)}: ${(e as Error).message}`);
    return;
  }
  if (isPdfPath(uri) && !isPdf(bytes)) {
    vscode.window.showWarningMessage("E-Invoice: this file has a .pdf name but is not a PDF.");
    return;
  }

  const apiKey = await context.secrets.get(SECRET);
  const cfg = vscode.workspace.getConfiguration("einvoice");
  if (!apiKey) void publicNotice(context);

  results.set(key, "running");
  updateStatus();
  try {
    const r = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: "E-Invoice: validating" },
      () =>
        validate(bytes, {
          apiKey,
          baseUrl: cfg.get<string>("baseUrl") || DEFAULT_BASE_URL,
          lang: cfg.get<string>("language") || vscode.env.language,
          userAgent: `Mozilla/5.0 (compatible; einvoice-vscode/${VERSION}; +https://einvoiceengine.com)`,
        }),
    );
    results.set(key, r);
    diagnostics.set(uri, toDiagnostics(r, uri));
    log(uri, r);
    if (explicit) {
      if (r.status === "unsupported") vscode.window.showWarningMessage("E-Invoice: the format of this file is not supported, or it is not an e-invoice.");
      else if (r.valid) vscode.window.showInformationMessage(`E-Invoice: valid${r.format ? ` ${r.format}` : ""}${r.warnings ? `, ${r.warnings} warning(s)` : ""}.`);
    }
  } catch (e) {
    results.delete(key);
    void handleError(e, explicit);
  } finally {
    updateStatus();
  }
}

function toDiagnostics(r: Result, uri: vscode.Uri): vscode.Diagnostic[] {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  return r.findings.map((f) => {
    let range: vscode.Range;
    if (f.line && doc && f.line <= doc.lineCount) {
      const line = doc.lineAt(f.line - 1);
      range = f.column ? new vscode.Range(f.line - 1, f.column - 1, f.line - 1, line.range.end.character) : new vscode.Range(line.range.start.translate(0, line.firstNonWhitespaceCharacterIndex), line.range.end);
    } else {
      const l = Math.max(0, (f.line ?? 1) - 1);
      range = new vscode.Range(l, 0, l, 0);
    }
    const sev = f.severity === "error" ? vscode.DiagnosticSeverity.Error : f.severity === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
    const d = new vscode.Diagnostic(range, f.message, sev);
    d.source = "e-invoice";
    d.code = f.href ? { value: f.ruleId, target: vscode.Uri.parse(f.href) } : f.ruleId;
    return d;
  });
}

function updateStatus() {
  const uri = activeUri();
  if (!uri || !(isXml(uri) || isPdfPath(uri))) {
    status.hide();
    return;
  }
  const r = results.get(uri.toString());
  status.backgroundColor = undefined;
  if (r === "running") {
    status.text = "$(sync~spin) E-Invoice";
    status.tooltip = "Validating…";
  } else if (!r) {
    status.text = "$(checklist) E-Invoice";
    status.tooltip = "Validate this file with the official rules (E-Invoice: Validate current file)";
  } else if (r.status === "unsupported") {
    status.text = "$(question) E-Invoice: unsupported";
    status.tooltip = "Not a supported e-invoice format";
  } else if (r.valid) {
    status.text = r.warnings ? `$(check) E-Invoice: valid, ${r.warnings} warning${r.warnings === 1 ? "" : "s"}` : "$(check) E-Invoice: valid";
    status.tooltip = [r.format, r.ruleset].filter(Boolean).join(" · ") + "\nClick to validate again";
  } else {
    status.text = `$(error) E-Invoice: ${r.errors} error${r.errors === 1 ? "" : "s"}`;
    status.tooltip = [r.format, r.ruleset].filter(Boolean).join(" · ") + "\nDetails in the Problems panel. Click to validate again";
    status.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  }
  status.show();
}

function log(uri: vscode.Uri, r: Result) {
  const name = vscode.workspace.asRelativePath(uri);
  output.appendLine(`${r.valid ? "VALID  " : r.status === "unsupported" ? "UNSUPP " : "INVALID"} ${name}${r.format ? `  ${r.format}` : ""}${r.ruleset ? `  [${r.ruleset}]` : ""}`);
  for (const f of r.findings) output.appendLine(`  ${f.severity.padEnd(7)} ${f.ruleId}${f.line ? ` (line ${f.line})` : ""}: ${f.message}`);
  if (r.via === "public" && r.remainingToday !== undefined) output.appendLine(`  free checks left today: ${r.remainingToday}`);
}

async function handleError(e: unknown, explicit: boolean) {
  if (e instanceof ApiError) {
    if (e.code === "daily_limit_reached") {
      const pick = await vscode.window.showWarningMessage(`E-Invoice: ${e.message} A free sandbox API key removes the daily limit.`, "Get a free key", "Set API key");
      if (pick === "Get a free key") void vscode.env.openExternal(vscode.Uri.parse(KEYS_URL));
      if (pick === "Set API key") void vscode.commands.executeCommand("einvoice.setApiKey");
      return;
    }
    if (e.status === 401 || e.code === "invalid_api_key" || e.code === "unauthorized") {
      const pick = await vscode.window.showErrorMessage(`E-Invoice: the API key was not accepted (${e.message}).`, "Set API key");
      if (pick) void vscode.commands.executeCommand("einvoice.setApiKey");
      return;
    }
    vscode.window.showErrorMessage(`E-Invoice: ${e.message} (${e.code})`);
    return;
  }
  const msg = (e as Error)?.message ?? String(e);
  if (explicit) vscode.window.showErrorMessage(`E-Invoice: could not reach the validator (${msg}).`);
  output.appendLine(`error: ${msg}`);
}

async function publicNotice(context: vscode.ExtensionContext) {
  if (context.globalState.get<boolean>(NOTICE_SHOWN)) return;
  await context.globalState.update(NOTICE_SHOWN, true);
  const pick = await vscode.window.showInformationMessage(
    "E-Invoice: no API key set, so the free public check is used. It allows a few checks per day. A free sandbox API key (einv_test_…) removes the limit.",
    "Get a free key",
    "Set API key",
  );
  if (pick === "Get a free key") void vscode.env.openExternal(vscode.Uri.parse(KEYS_URL));
  if (pick === "Set API key") void vscode.commands.executeCommand("einvoice.setApiKey");
}

async function setApiKey(context: vscode.ExtensionContext) {
  const value = await vscode.window.showInputBox({
    title: "E-Invoice: API key",
    prompt: "Paste a key from einvoiceengine.com/dashboard/keys (einv_test_… for the free sandbox, or einv_live_…). Stored in the OS keychain via VS Code SecretStorage. Leave empty to remove the key.",
    password: true,
    ignoreFocusOut: true,
    placeHolder: "einv_test_…",
    validateInput: (v) => (!v.trim() || /^einv_(test|live)_\S+$/.test(v.trim()) ? undefined : "Keys start with einv_test_ or einv_live_"),
  });
  if (value === undefined) return;
  if (!value.trim()) {
    await context.secrets.delete(SECRET);
    vscode.window.showInformationMessage("E-Invoice: API key removed.");
    return;
  }
  await context.secrets.store(SECRET, value.trim());
  vscode.window.showInformationMessage(`E-Invoice: ${value.trim().startsWith("einv_live_") ? "live" : "sandbox"} API key saved.`);
}
