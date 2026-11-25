// Tests of the compiled validation core (dist/core.js). Run: npm test
// Live smoke test against the free public endpoint (uses one or two of today's free checks):
//   npm run test:live
// Fixture: test case 01.01a of the KoSIT XRechnung test suite (https://github.com/itplr-kosit/xrechnung-testsuite).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../dist/core.js");

const valid = readFileSync(new URL("./fixtures/xrechnung-ubl.xml", import.meta.url));
// XRechnung without the buyer reference (BT-10) breaks BR-DE-15
const invalid = Buffer.from(valid.toString("utf8").replace(/\s*<cbc:BuyerReference>[^<]*<\/cbc:BuyerReference>/, ""), "utf8");
assert.notEqual(invalid.length, valid.length, "fixture must contain a BuyerReference");

/** fetch stub that records the request and answers with `body` */
function stub(status, body, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
}

const apiAnswer = {
  object: "validation",
  status: "invalid",
  valid: false,
  stored: false,
  remainingToday: 4,
  detected: { format: "xrechnung-ubl", version: "3.0", syntax: "ubl" },
  summary: { errors: 2, warnings: 1, infos: 0 },
  ruleset: { configuration: "xrechnung", version: "3.0.2" },
  findings: [
    { severity: "error", ruleId: "BR-DE-15", message: "[BR-DE-15] Das Element Buyer reference …", explanation: "XRechnung requires the buyer reference (BT-10).", suggestion: "Add the Leitweg-ID.", location: { path: "/Invoice", line: 2, column: 1 } },
    { severity: "error", ruleId: "BR-XX-999", message: "Some rule without a page", explanation: "", suggestion: "", location: { path: "/Invoice/cbc:ID" } },
    { severity: "warning", ruleId: "PEPPOL-EN16931-R008", message: "Empty element", explanation: "Empty elements are not allowed.", suggestion: "" },
  ],
};

test("keyless: public endpoint, XML sent as utf8 JSON, no authorization header", async () => {
  const calls = [];
  const r = await core.validate(invalid, { fetch: stub(200, apiAnswer, calls), lang: "de-DE" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://einvoiceengine.com/public/validate");
  const h = calls[0].init.headers;
  assert.equal(h.authorization, undefined);
  assert.equal(h["accept-language"], "de");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.encoding, "utf8");
  assert.ok(body.document.includes("<ubl:Invoice") || body.document.includes("Invoice"));
  assert.equal(r.via, "public");
  assert.equal(r.remainingToday, 4);
  assert.equal(r.status, "invalid");
  assert.equal(r.errors, 2);
  assert.equal(r.warnings, 1);
  assert.equal(r.format, "XRechnung (UBL)");
});

test("findings: rule id, severity, line, and a rule page link only where one exists", async () => {
  const r = await core.validate(invalid, { fetch: stub(200, apiAnswer, []) });
  const [a, b, c] = r.findings;
  assert.deepEqual([a.ruleId, a.severity, a.line, a.column], ["BR-DE-15", "error", 2, 1]);
  assert.equal(a.href, "https://einvoiceengine.com/rules/br-de-15");
  assert.match(a.message, /buyer reference.*Leitweg-ID/);
  assert.equal(b.href, undefined);
  assert.equal(b.line, undefined);
  assert.equal(b.message, "Some rule without a page");
  assert.equal(c.severity, "warning");
  assert.equal(c.href, "https://einvoiceengine.com/rules/peppol-en16931-r008");
});

test("with a key: /v1/invoices/validate, bearer header, store=false, custom base URL", async () => {
  const calls = [];
  const r = await core.validate(valid, { apiKey: "einv_test_dummy", baseUrl: "https://example.test/", fetch: stub(200, { ...apiAnswer, remainingToday: undefined }, calls) });
  assert.equal(calls[0].url, "https://example.test/v1/invoices/validate?store=false");
  assert.equal(calls[0].init.headers.authorization, "Bearer einv_test_dummy");
  assert.equal(r.via, "key");
});

test("PDF is sent base64", async () => {
  const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from([0, 1, 2, 255])]);
  const calls = [];
  await core.validate(pdf, { fetch: stub(200, apiAnswer, calls) });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.encoding, "base64");
  assert.deepEqual(Buffer.from(body.document, "base64"), pdf);
});

test("daily limit surfaces as ApiError with its code", async () => {
  const err = { error: { code: "daily_limit_reached", message: "The free validator allows 5 checks per day." } };
  await assert.rejects(core.validate(valid, { fetch: stub(429, err, []) }), (e) => e instanceof core.ApiError && e.status === 429 && e.code === "daily_limit_reached");
});

test("looksLikeInvoice skips other XML", () => {
  assert.equal(core.looksLikeInvoice(valid), true);
  assert.equal(core.looksLikeInvoice(Buffer.from('<?xml version="1.0"?><project><modelVersion>4.0.0</modelVersion></project>')), false);
  assert.equal(core.looksLikeInvoice(Buffer.from("<rsm:CrossIndustryInvoice xmlns:rsm='x'/>")), true);
  assert.equal(core.looksLikeInvoice(Buffer.from("%PDF-1.4")), true);
});

test("live: public endpoint flags BR-DE-15 on the sample without a buyer reference", { skip: !process.env.EINV_LIVE }, async () => {
  const r = await core.validate(invalid, { userAgent: "Mozilla/5.0 (compatible; einvoice-vscode/0.1.0; +https://einvoiceengine.com)" });
  console.log(JSON.stringify({ status: r.status, format: r.format, ruleset: r.ruleset, errors: r.errors, remainingToday: r.remainingToday, findings: r.findings.map((f) => [f.ruleId, f.line, f.href ?? null]) }));
  assert.equal(r.valid, false);
  const f = r.findings.find((x) => x.ruleId === "BR-DE-15");
  assert.ok(f, "BR-DE-15 expected");
  assert.equal(f.href, "https://einvoiceengine.com/rules/br-de-15");
});

test("live: public endpoint accepts the unchanged sample", { skip: !process.env.EINV_LIVE }, async () => {
  const r = await core.validate(valid, { userAgent: "Mozilla/5.0 (compatible; einvoice-vscode/0.1.0; +https://einvoiceengine.com)" });
  console.log(JSON.stringify({ status: r.status, format: r.format, errors: r.errors, warnings: r.warnings, remainingToday: r.remainingToday }));
  assert.equal(r.status, "valid");
});
