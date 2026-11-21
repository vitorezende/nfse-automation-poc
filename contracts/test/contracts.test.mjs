import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadValidator } from "../validator.mjs";

const example = (name) =>
  JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));

const validate = loadValidator();

test("IssueNfse example is a valid message", () => {
  const result = validate(example("issue-nfse"));
  assert.deepEqual(result.errors, []);
});

test("IssueNfse carrying a password is rejected", () => {
  const message = example("issue-nfse");
  message.payload.prestador.password = "secret";
  assert.notDeepEqual(validate(message).errors, []);
});

test("a message missing its correlationId is rejected", () => {
  const message = example("issue-nfse");
  delete message.correlationId;
  assert.notDeepEqual(validate(message).errors, []);
});

test("a message of unknown type is rejected", () => {
  const message = example("issue-nfse");
  message.type = "DeleteEverything";
  assert.notDeepEqual(validate(message).errors, []);
});

for (const name of [
  "nfse-issuance-started",
  "nfse-issuance-attempt-failed",
  "nfse-issued",
  "nfse-issuance-failed",
]) {
  test(`${name} example is a valid message`, () => {
    assert.deepEqual(validate(example(name)).errors, []);
  });
}

test("a failure with an unknown error category is rejected", () => {
  const message = example("nfse-issuance-failed");
  message.payload.errorCategory = "cosmic-rays";
  assert.notDeepEqual(validate(message).errors, []);
});

test("NfseIssued carrying the document contents instead of references is rejected", () => {
  const message = example("nfse-issued");
  message.payload.documents.xml = "<nfse>...</nfse>";
  assert.notDeepEqual(validate(message).errors, []);
});

test("AsyncAPI document is valid and declares exactly the five message types", async () => {
  const { Parser, fromFile } = await import("@asyncapi/parser");
  const { document, diagnostics } = await fromFile(
    new Parser(),
    new URL("../asyncapi.yaml", import.meta.url).pathname,
  ).parse();
  const errors = diagnostics.filter((d) => d.severity === 0).map((d) => d.message);
  assert.deepEqual(errors, []);
  const names = document.allMessages().all().map((m) => m.name()).sort();
  assert.deepEqual(names, [
    "IssueNfse",
    "NfseIssuanceAttemptFailed",
    "NfseIssuanceFailed",
    "NfseIssuanceStarted",
    "NfseIssued",
  ]);
});

test("NfseIssued without document references is rejected", () => {
  const message = example("nfse-issued");
  delete message.payload.documents;
  assert.notDeepEqual(validate(message).errors, []);
});
