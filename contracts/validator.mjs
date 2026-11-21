// Validates NFS-e messages against the JSON Schemas in ./schemas, dispatching on the envelope's `type`.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readdirSync, readFileSync } from "node:fs";

const SCHEMA_BY_TYPE = {
  IssueNfse: "issue-nfse.schema.json",
  NfseIssuanceStarted: "nfse-issuance-started.schema.json",
  NfseIssuanceAttemptFailed: "nfse-issuance-attempt-failed.schema.json",
  NfseIssued: "nfse-issued.schema.json",
  NfseIssuanceFailed: "nfse-issuance-failed.schema.json",
};

export function loadValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const dir = new URL("./schemas/", import.meta.url);
  for (const file of readdirSync(dir)) {
    ajv.addSchema(JSON.parse(readFileSync(new URL(file, dir), "utf8")));
  }
  const base = "https://nfse-poc.example/schemas/";
  return (message) => {
    const schemaFile = SCHEMA_BY_TYPE[message?.type];
    if (!schemaFile) return { errors: [`unknown message type: ${message?.type}`] };
    const validate = ajv.getSchema(base + schemaFile);
    return { errors: validate(message) ? [] : validate.errors.map((e) => `${e.instancePath} ${e.message}`) };
  };
}
