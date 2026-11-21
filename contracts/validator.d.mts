export interface ValidationResult {
  errors: string[];
}

/** Returns a function validating a message against the schema selected by its envelope `type`. */
export function loadValidator(): (message: unknown) => ValidationResult;
