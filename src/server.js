require("dotenv").config();
const { createApp } = require("./app");
const { createAuthService } = require("./auth");
const { loadConfig } = require("./config");
const { createGraphService } = require("./graph");
const { createVerifiedIdService } = require("./verifiedId");

const config = loadConfig();
const app = createApp({
  config,
  authService: createAuthService(config),
  graphService: createGraphService(config),
  verifiedIdService: createVerifiedIdService(config),
});

app.listen(config.port, () => {
  console.log(`Northstar is listening on http://localhost:${config.port}`);
});