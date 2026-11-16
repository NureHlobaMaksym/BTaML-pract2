module.exports = {
  istanbulFolder: require("node:path").resolve(__dirname, "coverage"),
  skipFiles: ["security", "benchmarks", "interfaces", "constants"],
  configureYulOptimizer: true
};
