const test = require("node:test");
const assert = require("node:assert/strict");
const { accountEmailFilter, externalIdentityFilter } = require("../src/graph");

test("External ID email lookup includes the identity issuer", () => {
  assert.equal(
    externalIdentityFilter("o'connor@example.com", "rgciam.onmicrosoft.com"),
    "identities/any(identity:identity/issuer eq 'rgciam.onmicrosoft.com' and identity/issuerAssignedId eq 'o''connor@example.com')",
  );
});

test("account email fallback checks mail and user principal name", () => {
  assert.equal(
    accountEmailFilter("o'connor@example.com"),
    "mail eq 'o''connor@example.com' or userPrincipalName eq 'o''connor@example.com'",
  );
});