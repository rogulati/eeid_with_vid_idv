const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");

function validEnvironment(overrides = {}) {
  return {
    ENTRA_TENANT_ID: "tenant-id",
    ENTRA_TENANT_SUBDOMAIN: "tenant",
    ENTRA_CLIENT_ID: "client-id",
    ENTRA_CLIENT_SECRET: "client-secret",
    ENTRA_REDIRECT_URI: "http://localhost:3000/auth/redirect",
    SESSION_SECRET: "test-session-secret-that-is-long-enough",
    VERIFIED_ID_AUTHORITY: "did:web:example",
    VERIFIED_ID_CALLBACK_API_KEY: "callback-key",
    VERIFIED_ID_MANIFEST: "https://example.test/manifest",
    VERIFIED_ID_TYPE: "NorthstarLoyalty",
    GRAPH_IS_VERIFIED_ATTRIBUTE: "extension_test_isVerified",
    GRAPH_LOYALTY_ATTRIBUTE: "extension_test_loyalty",
    GRAPH_VERIFIED_ID_EXPIRATION_ATTRIBUTE: "extension_test_VerifiedIDExpirationDate",
    ...overrides,
  };
}

test("CIAM Store event integration is disabled when all optional settings are absent", () => {
  const config = loadConfig(validEnvironment());
  assert.equal(config.ciamStoreEvent, null);
});

test("CIAM Store event integration rejects partial configuration", () => {
  assert.throws(
    () => loadConfig(validEnvironment({
      CIAM_STORE_EVENT_URL: "https://ciamstorepoc.azurewebsites.net/api/integrations/signup-events",
    })),
    /Missing CIAM Store event settings: CIAM_STORE_CONNECTION_ID, CIAM_STORE_EVENT_SECRET/,
  );
});
