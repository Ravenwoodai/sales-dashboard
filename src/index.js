const { startServer } = require("./main");

function main() {
  return startServer();
}

if (require.main === module) {
  main();
}

module.exports = { main };
