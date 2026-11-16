export interface VerificationContract {
  name: string;
  address: string;
  sourceName: string;
  compilerVersion: string;
  input: Record<string, unknown>;
  constructorTypes: string[];
  constructorArguments: string[];
}
