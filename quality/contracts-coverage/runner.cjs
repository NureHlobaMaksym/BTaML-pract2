const path = require("node:path");
const envPaths = require("env-paths");
require.cache[require.resolve("env-paths")].exports = (name, options) => {
  const paths = envPaths(name, options);
  if (!["hardhat", "buidler"].includes(name)) return paths;
  for (const key of Object.keys(paths)) paths[key] = path.join(__dirname, ".runtime", name, key);
  return paths;
};
require("hardhat/internal/cli/cli");
