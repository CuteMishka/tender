const fs = require("node:fs");

const modulePath = require.resolve("brace-expansion");
const source = fs.readFileSync(modulePath, "utf8");
const marker = "// tender: CommonJS compatibility for minimatch < 10";

if (!source.includes(marker)) {
  if (!source.includes("exports.expand = expand;")) {
    throw new Error(`Unsupported brace-expansion CommonJS build: ${modulePath}`);
  }

  fs.appendFileSync(
    modulePath,
    [
      "",
      marker,
      "expand.expand = expand;",
      "expand.EXPANSION_MAX = exports.EXPANSION_MAX;",
      "expand.EXPANSION_MAX_LENGTH = exports.EXPANSION_MAX_LENGTH;",
      "module.exports = expand;",
      "",
    ].join("\n"),
  );
}
