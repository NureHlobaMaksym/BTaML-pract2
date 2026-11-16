require("tsx/cjs");
globalThis.btamlCoverage = { runtime: require("hardhat"), runner: require("mocha") };
require("../../../test/crowdfunding.test.ts");
