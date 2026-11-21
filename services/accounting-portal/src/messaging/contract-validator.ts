import { Injectable } from '@nestjs/common';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
const SCHEMA_BASE = 'https://nfse-poc.example/schemas/';
const SCHEMA_BY_TYPE: Record<string, string> = {
  IssueNfse: 'issue-nfse.schema.json',
  NfseIssuanceStarted: 'nfse-issuance-started.schema.json',
  NfseIssuanceAttemptFailed: 'nfse-issuance-attempt-failed.schema.json',
  NfseIssued: 'nfse-issued.schema.json',
  NfseIssuanceFailed: 'nfse-issuance-failed.schema.json',
};

/** Validates messages against the shared JSON Schemas in contracts/schemas (ADR 0003). */
@Injectable()
export class ContractValidator {
  private readonly ajv = new Ajv2020({ allErrors: true, strict: true });

  constructor() {
    addFormats(this.ajv);
    const dir = resolve(process.env.CONTRACTS_SCHEMAS_DIR ?? join(import.meta.dirname, '..', '..', '..', '..', 'contracts', 'schemas'));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      this.ajv.addSchema(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    }
  }

  /** Returns the violations; empty when the message honours its contract. */
  validate(message: { type?: unknown }): string[] {
    const file = SCHEMA_BY_TYPE[String(message?.type)];
    if (!file) return [`unknown message type: ${String(message?.type)}`];
    const validate = this.ajv.getSchema(SCHEMA_BASE + file)!;
    return validate(message) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
  }
}
