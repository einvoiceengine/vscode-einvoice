/**
 * Validation core: talks to the E-Invoicing API and turns the answer into plain findings.
 * No VS Code imports here, so the tests can run it in Node directly.
 */

export const DEFAULT_BASE_URL = "https://einvoiceengine.com";
export const KEYS_URL = "https://einvoiceengine.com/login?next=/dashboard/keys";
export const SUPPORTED_LANGS = ["en", "de", "fr", "es", "it", "pl", "nl", "pt"] as const;

export type Severity = "error" | "warning" | "info";

export interface Finding {
  severity: Severity;
  ruleId: string;
  message: string;
  /** 1-based line in the file, when the API reports one */
  line?: number;
  /** 1-based column, when the API reports one */
  column?: number;
  /** rule page on einvoiceengine.com, only for rules that have a page */
  href?: string;
}

export interface Result {
  status: "valid" | "invalid" | "unsupported";
  valid: boolean;
  /** e.g. "XRechnung 3.0 (UBL)" */
  format?: string;
  ruleset?: string;
  errors: number;
  warnings: number;
  findings: Finding[];
  /** "public" when the keyless free check was used */
  via: "public" | "key";
  /** free checks left today (public endpoint only) */
  remainingToday?: number;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Rules that have a reference page under https://einvoiceengine.com/rules/<id>.
 * Kept in step with apps/web/src/lib/rules-library.ts (LIBRARY_RULES).
 */
export const RULE_PAGES = new Set([
  "BR-DE-15", "BR-DE-1", "BR-DE-2", "BR-DE-7", "BR-DE-14", "BR-DE-16", "BR-DE-17", "BR-DE-18", "BR-DE-19",
  "BR-DE-23-a", "BR-DE-26", "BR-DE-TMP-32",
  "BR-CO-10", "BR-CO-13", "BR-CO-14", "BR-CO-15", "BR-CO-16", "BR-CO-17",
  "BR-S-08", "BR-AE-02", "BR-AE-10", "BR-E-10",
  "BR-CO-26", "BR-CL-23", "BR-DEC-23",
  "PEPPOL-EN16931-R001", "PEPPOL-EN16931-R008", "PEPPOL-EN16931-R010", "PEPPOL-EN16931-R020", "PEPPOL-EN16931-R120",
]);

/** The rule's page on einvoiceengine.com, or undefined when it has none. Always on the public site. */
export function ruleHref(ruleId: string): string | undefined {
  return RULE_PAGES.has(ruleId) ? `${DEFAULT_BASE_URL}/rules/${ruleId.toLowerCase()}` : undefined;
}

/** Short names of the format ids in `detected.format` (GET /public/formats has the full list). */
const FORMAT_NAMES: Record<string, string> = {
  "xrechnung-ubl": "XRechnung (UBL)",
  "xrechnung-cii": "XRechnung (CII)",
  "en16931-ubl": "EN 16931 (UBL)",
  "en16931-cii": "EN 16931 (CII)",
  "zugferd-facturx": "ZUGFeRD / Factur-X",
  "peppol-bis-billing": "Peppol BIS Billing 3.0",
  facturae: "Facturae",
  ksef: "KSeF FA(3)",
};

export const isPdf = (b: Uint8Array) => b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;

/** Root elements of the invoice formats the API reads; used to skip pom.xml and friends on save. */
const INVOICE_ROOT = /<(?:[\w.-]+:)?(Invoice|CreditNote|CrossIndustryInvoice|Facturae|Faktura)\b/;
export function looksLikeInvoice(b: Uint8Array): boolean {
  if (isPdf(b)) return true;
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 8192));
  return INVOICE_ROOT.test(head);
}

/** JSON body accepted by both /public/validate and /v1/invoices/validate. */
export function requestBody(b: Uint8Array): { document: string; encoding: "utf8" | "base64" } {
  if (isPdf(b)) return { document: Buffer.from(b).toString("base64"), encoding: "base64" };
  return { document: new TextDecoder("utf-8").decode(b), encoding: "utf8" };
}

export interface ValidateOptions {
  /** einv_test_… or einv_live_…; without one the free public check is used */
  apiKey?: string;
  baseUrl?: string;
  /** language of explanations: en, de, fr, es, it, pl, nl, pt */
  lang?: string;
  userAgent?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

interface ApiFinding {
  severity?: string;
  ruleId?: string;
  message?: string;
  messageTranslation?: string;
  explanation?: string;
  suggestion?: string;
  location?: { path?: string; line?: number; column?: number };
}

interface ApiValidation {
  status?: "valid" | "invalid" | "unsupported";
  valid?: boolean;
  detected?: { format?: string; syntax?: string; profile?: string; version?: string };
  summary?: { errors?: number; warnings?: number };
  findings?: ApiFinding[];
  ruleset?: { configuration?: string; version?: string };
  remainingToday?: number;
}

export async function validate(doc: Uint8Array, o: ValidateOptions = {}): Promise<Result> {
  const base = (o.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const key = o.apiKey?.trim();
  const url = key ? `${base}/v1/invoices/validate?store=false` : `${base}/public/validate`;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (o.userAgent) headers["user-agent"] = o.userAgent;
  if (key) headers.authorization = `Bearer ${key}`;
  const lang = o.lang?.slice(0, 2).toLowerCase();
  if (lang && (SUPPORTED_LANGS as readonly string[]).includes(lang)) headers["accept-language"] = lang;

  const res = await (o.fetch ?? fetch)(url, { method: "POST", headers, body: JSON.stringify(requestBody(doc)), signal: o.signal });
  const type = res.headers.get("content-type") ?? "";
  const data = (type.includes("json") ? await res.json().catch(() => ({})) : {}) as ApiValidation & { error?: { code?: string; message?: string } };
  if (!res.ok) {
    const code = data.error?.code ?? `http_${res.status}`;
    const fallback = res.status === 403 ? "The request was blocked before it reached the API." : `HTTP ${res.status}`;
    throw new ApiError(res.status, code, data.error?.message ?? fallback);
  }
  return toResult(data, key ? "key" : "public");
}

export function toResult(v: ApiValidation, via: "public" | "key"): Result {
  const findings: Finding[] = (v.findings ?? []).map((f) => {
    const ruleId = f.ruleId || "unknown";
    const severity: Severity = f.severity === "warning" || f.severity === "info" ? f.severity : "error";
    const text = [f.explanation || f.messageTranslation || f.message || ruleId, f.suggestion].filter(Boolean).join(" ");
    const line = typeof f.location?.line === "number" && f.location.line > 0 ? f.location.line : undefined;
    const column = line && typeof f.location?.column === "number" && f.location.column > 0 ? f.location.column : undefined;
    return { severity, ruleId, message: text, line, column, href: ruleHref(ruleId) };
  });
  const d = v.detected ?? {};
  const format = d.format ? [FORMAT_NAMES[d.format] ?? d.format, d.profile].filter(Boolean).join(", ") : undefined;
  const errors = v.summary?.errors ?? findings.filter((f) => f.severity === "error").length;
  const status = v.status ?? (v.valid ? "valid" : "invalid");
  return {
    status,
    valid: v.valid ?? status === "valid",
    format,
    ruleset: v.ruleset ? [v.ruleset.configuration, v.ruleset.version].filter(Boolean).join(" ") : undefined,
    errors,
    warnings: v.summary?.warnings ?? findings.filter((f) => f.severity === "warning").length,
    findings,
    via,
    remainingToday: typeof v.remainingToday === "number" ? v.remainingToday : undefined,
  };
}
