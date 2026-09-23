/** Khronos glTF-Validator (the reference validator, compiled to JS) over compiled tiles. */
import validator from 'gltf-validator';

export interface ValidationSummary {
  file: string;
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
  /** First messages (code: message @ pointer). */
  messages: string[];
}

export async function validateGlb(file: string, bytes: Uint8Array): Promise<ValidationSummary> {
  const report = await validator.validateBytes(bytes, {
    uri: file,
    maxIssues: 50,
    writeTimestamp: false,
    externalResourceFunction: () => Promise.reject(new Error('no external resources in street tiles')),
  });
  const issues = report.issues;
  return {
    file,
    errors: issues.numErrors,
    warnings: issues.numWarnings,
    infos: issues.numInfos,
    hints: issues.numHints,
    messages: issues.messages.slice(0, 8).map((m: { code: string; message: string; pointer?: string; severity: number }) => `[${m.severity}] ${m.code}: ${m.message}${m.pointer ? ` @ ${m.pointer}` : ''}`),
  };
}
