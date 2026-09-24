/**
 * Khronos glTF-Validator (the reference validator, compiled to JS) over compiled tiles and props. Format 1 glbs
 * reference external images (../textures/...): `readExternal` resolves them, so the images are validated too.
 */
import validator from 'gltf-validator';

export interface ValidationSummary {
  file: string;
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
  /** First messages (code: message @ pointer). */
  messages: string[];
  /** Message codes and their counts. */
  codes: Record<string, number>;
}

export async function validateGlb(file: string, bytes: Uint8Array, readExternal?: (uri: string) => Uint8Array): Promise<ValidationSummary> {
  const report = await validator.validateBytes(bytes, {
    uri: file,
    maxIssues: 50,
    writeTimestamp: false,
    externalResourceFunction: (uri: string) => (readExternal ? Promise.resolve(readExternal(decodeURIComponent(uri))) : Promise.reject(new Error('no external resources in format 0 tiles'))),
  });
  const issues = report.issues;
  const codes: Record<string, number> = {};
  for (const m of issues.messages) {
    codes[m.code] = (codes[m.code] ?? 0) + 1;
  }
  return {
    file,
    errors: issues.numErrors,
    warnings: issues.numWarnings,
    infos: issues.numInfos,
    hints: issues.numHints,
    messages: issues.messages.slice(0, 8).map((m: { code: string; message: string; pointer?: string; severity: number }) => `[${m.severity}] ${m.code}: ${m.message}${m.pointer ? ` @ ${m.pointer}` : ''}`),
    codes,
  };
}
