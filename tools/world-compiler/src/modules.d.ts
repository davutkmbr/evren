/** Minimal typings for untyped dev dependencies used by the compiler. */
declare module 'gltf-validator' {
  interface ValidatorMessage {
    code: string;
    message: string;
    severity: number;
    pointer?: string;
  }
  interface ValidatorReport {
    issues: { numErrors: number; numWarnings: number; numInfos: number; numHints: number; messages: ValidatorMessage[]; truncated: boolean };
    info?: Record<string, unknown>;
  }
  interface ValidatorOptions {
    uri?: string;
    format?: 'glb' | 'gltf';
    maxIssues?: number;
    writeTimestamp?: boolean;
    externalResourceFunction?: (uri: string) => Promise<Uint8Array>;
  }
  const validator: {
    version(): string;
    validateBytes(data: Uint8Array, options?: ValidatorOptions): Promise<ValidatorReport>;
  };
  export default validator;
}
