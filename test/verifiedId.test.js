const test = require("node:test");
const assert = require("node:assert/strict");
const { accessTokenClaims, credentialClaims, presentationRequestPayload } = require("../src/verifiedId");

test("access token metadata exposes Request Service application roles", () => {
  const payload = Buffer.from(JSON.stringify({
    aud: "3db474b9-6a0c-4840-96ac-1fceb342124f",
    roles: ["VerifiableCredential.Create.All"],
  })).toString("base64url");

  assert.deepEqual(accessTokenClaims(`header.${payload}.signature`).roles, ["VerifiableCredential.Create.All"]);
});

test("credential claims come from the ID token and include a random six-digit loyalty number", () => {
  const claims = credentialClaims({
    username: "ignored@example.com",
    name: "Ignored Name",
    claims: {
      givenName: "Avery",
      surname: "Traveler",
      email: "avery@example.com",
      displayName: "Avery Traveler",
    },
  });

  assert.deepEqual(
    { ...claims, loyalty: undefined },
    {
      givenName: "Avery",
      surname: "Traveler",
      email: "avery@example.com",
      displayName: "Avery Traveler",
      loyalty: undefined,
    },
  );
  assert.match(claims.loyalty, /^\d{6}$/);
});

test("credential claims reject an ID token missing a required identity value", () => {
  assert.throws(
    () => credentialClaims({ claims: { givenName: "Avery", email: "avery@example.com" } }),
    /given name and surname required/,
  );
});

test("credential claims support the External ID emails array", () => {
  const claims = credentialClaims({
    claims: {
      given_name: "Avery",
      family_name: "Traveler",
      emails: ["avery@example.com"],
      name: "Avery Traveler",
    },
  });

  assert.equal(claims.email, "avery@example.com");
  assert.equal(claims.displayName, "Avery Traveler");
});

test("credential claims derive names from the ID token display name when dedicated claims are absent", () => {
  const claims = credentialClaims({
    claims: {
      emails: ["avery@example.com"],
      name: "Avery North Traveler",
    },
  });

  assert.equal(claims.givenName, "Avery");
  assert.equal(claims.surname, "North Traveler");
});

test("government identity presentation requests VerifiedIdentity and NorthstarLoyalty", () => {
  const payload = presentationRequestPayload({
    baseUrl: "https://eeidtravelwithvid.azurewebsites.net",
    verifiedIdAuthority: "did:web:northstar.example",
    verifiedIdCallbackApiKey: "callback-key",
  }, "identity-state", {
    includeQRCode: true,
    requestedCredentials: [
      { type: "VerifiedIdentity" },
      { type: "NorthstarLoyalty", acceptedIssuers: ["did:web:northstar.example"] },
    ],
    clientName: "Northstar Identity",
    purpose: "Prove your government document identity to Northstar",
  });

  assert.equal(payload.requestedCredentials[0].type, "VerifiedIdentity");
  assert.notEqual(payload.requestedCredentials[0].type, "TrueCredential");
  assert.equal(Object.hasOwn(payload.requestedCredentials[0], "acceptedIssuers"), false);
  assert.deepEqual(payload.requestedCredentials[0].configuration.validation, {
    allowRevoked: true,
    validateLinkedDomain: true,
  });
  assert.equal(payload.requestedCredentials[1].type, "NorthstarLoyalty");
  assert.deepEqual(payload.requestedCredentials[1].acceptedIssuers, ["did:web:northstar.example"]);
  assert.deepEqual(payload.requestedCredentials[1].configuration.validation, {
    allowRevoked: true,
    validateLinkedDomain: true,
  });
});