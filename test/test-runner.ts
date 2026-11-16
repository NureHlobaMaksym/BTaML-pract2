import * as nodeRunner from "node:test";
import type { Eip1193Provider, InterfaceAbi } from "ethers";

const coverage = (globalThis as typeof globalThis & {
  btamlCoverage?: {
    runner: typeof nodeRunner;
    runtime: {
      network: { provider: Eip1193Provider };
      artifacts: { readArtifact(name: string): Promise<{ abi: InterfaceAbi; bytecode: string }> };
    };
  };
}).btamlCoverage;

export const coverageRuntime = coverage?.runtime;
export const { before, after, beforeEach, describe, it } = coverage?.runner ?? nodeRunner;
