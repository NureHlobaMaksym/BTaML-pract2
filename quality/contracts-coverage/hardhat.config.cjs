const path = require("node:path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
require("solidity-coverage");
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async () => ({
  compilerPath: require.resolve("../../node_modules/solc/soljson.js"),
  isSolcJs: true,
  version: "0.8.38",
  longVersion: require("../../node_modules/solc").version()
}));
module.exports = {
  solidity: { version: "0.8.38", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  paths: { root: path.resolve(__dirname, "../.."), sources: "contracts", tests: "quality/contracts-coverage/tests", cache: "quality/contracts-coverage/cache", artifacts: "quality/contracts-coverage/artifacts" },
  networks: { hardhat: { chainId: 31337, hardfork: "cancun", allowUnlimitedContractSize: true } },
  mocha: { timeout: 60000 }
};
