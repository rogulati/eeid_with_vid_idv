const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../src/app");

const config = {
  isProduction: false,
  baseUrl: "https://eeidtravelwithvid.azurewebsites.net",
  sessionSecret: "test-session-secret-that-is-long-enough",
  verifiedIdCallbackApiKey: "verified-id-callback-test-key",
  verifiedIdAuthority: "did:web:northstar.example",
  verifiedIdType: "NorthstarLoyalty",
  graphIsVerifiedAttribute: "extension_test_isVerified",
  graphLoyaltyAttribute: "extension_test_loyalty",
  graphVerifiedIdExpirationAttribute: "extension_test_VerifiedIDExpirationDate",
};

function testApp({ graphService, userClaims = {} } = {}) {
  return createApp({
    config,
    authService: {
      async getLoginUrl(session) {
        session.authState = "valid-state";
        return "https://rgciam.ciamlogin.com/authorize";
      },
      async exchangeCode(code) {
        assert.equal(code, "auth-code");
        return {
          account: { name: "Avery Traveler", username: "avery@example.com" },
          idToken: "header.payload.signature",
          idTokenClaims: {
            sub: "customer-123",
            oid: "11111111-2222-3333-4444-555555555555",
            givenName: "Avery",
            surname: "Traveler",
            email: "avery@example.com",
            displayName: "Avery Traveler",
            ...userClaims,
          },
        };
      },
      getLogoutUrl() {
        return "https://rgciam.ciamlogin.com/logout";
      },
    },
    graphService: graphService || {
      async getIdentityVerification() {
        return {
          isVerified: userClaims[config.graphIsVerifiedAttribute],
          expirationDate: userClaims[config.graphVerifiedIdExpirationAttribute],
        };
      },
      async updateIdentityVerification() {},
      async updateIdentityVerificationByEmail() {},
    },
    verifiedIdService: {
      async createIssuanceRequest(user, options) {
        assert.equal(user.username, "avery@example.com");
        assert.equal(typeof options.includeQRCode, "boolean");
        return {
          state: "issuance-state-123",
          url: "openid-vc://northstar-request",
          ...(options.includeQRCode && { qrCode: "data:image/png;base64,dGVzdA==" }),
        };
      },
      async createPresentationRequest(options) {
        assert.equal(typeof options.includeQRCode, "boolean");
        if (options.requestedCredentials) {
          assert.deepEqual(options.requestedCredentials, [
            { type: "VerifiedIdentity" },
            { type: "NorthstarLoyalty" },
          ]);
          return {
            state: "identity-state-789",
            url: "openid-vc://verified-identity-presentation",
            ...(options.includeQRCode && { qrCode: "data:image/png;base64,aWRlbnRpdHk=" }),
          };
        }
        return {
          state: "presentation-state-456",
          url: "openid-vc://northstar-presentation",
          ...(options.includeQRCode && { qrCode: "data:image/png;base64,cHJlc2VudA==" }),
        };
      },
    },
  });
}

test("home page offers the combined sign-in and sign-up action", async () => {
  const response = await request(testApp()).get("/");
  assert.equal(response.status, 200);
  assert.match(response.text, /Sign in or sign up/);
});

test("protected profile redirects unauthenticated users to sign in", async () => {
  const response = await request(testApp()).get("/profile");
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/auth/signin");
});

test("sign-in route redirects to External ID", async () => {
  const response = await request(testApp()).get("/auth/signin");
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "https://rgciam.ciamlogin.com/authorize");
});

test("callback establishes a session and displays the ID token", async () => {
  const agent = request.agent(testApp());
  await agent.get("/auth/signin");
  const callback = await agent
    .get("/auth/redirect")
    .query({ state: "valid-state", code: "auth-code" });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.location, "/profile");

  const profile = await agent.get("/profile");
  assert.equal(profile.status, 200);
  assert.match(profile.text, /Welcome,/);
  assert.match(profile.text, /Avery Traveler/);
  assert.match(profile.text, /header\.payload\.signature/);
  assert.match(profile.text, /Show ID token details/);
  assert.match(profile.text, /Get a card/);
  assert.match(profile.text, /<details class="token-details">/);

  const home = await agent.get("/");
  assert.match(home.text, /href="\/profile">Identity<\/a>/);
});

test("authenticated user can create a loyalty card issuance request", async () => {
  const agent = request.agent(testApp());
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });
  const profile = await agent.get("/profile");
  const csrfToken = profile.text.match(/name="csrfToken" value="([^"]+)"/)[1];

  const issuance = await agent.post("/loyalty/issue").type("form").send({ csrfToken });
  assert.equal(issuance.status, 200);
  assert.match(issuance.text, /Your card is/);
  assert.match(issuance.text, /data:image\/png;base64,dGVzdA==/);
  assert.match(issuance.text, /Use Microsoft Authenticator application to scan and accept this Loyalty card\./);
  assert.match(issuance.text, /Use Loyalty card for discounts/);
  assert.match(issuance.text, /issuance-status\?id=issuance-state-123/);
  assert.doesNotMatch(issuance.text, /Open in Authenticator/);
});

test("mobile loyalty issuance uses the Authenticator deep link without a QR code", async () => {
  const agent = request.agent(testApp());
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });
  const profile = await agent.get("/profile");
  const csrfToken = profile.text.match(/name="csrfToken" value="([^"]+)"/)[1];

  const issuance = await agent
    .post("/loyalty/issue")
    .set("user-agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile")
    .type("form")
    .send({ csrfToken });
  assert.equal(issuance.status, 200);
  assert.match(issuance.text, /Open in Authenticator/);
  assert.match(issuance.text, /window\.location\.assign/);
  assert.doesNotMatch(issuance.text, /class="qr-panel"/);
});

test("loyalty issuance rejects an invalid CSRF token", async () => {
  const agent = request.agent(testApp());
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });
  const response = await agent.post("/loyalty/issue").type("form").send({ csrfToken: "invalid" });
  assert.equal(response.status, 403);
});

test("Verified ID callback requires its API key", async () => {
  const app = testApp();
  assert.equal((await request(app).post("/api/verifiedid/issuance-callback").send({})).status, 401);
  assert.equal((await request(app).post("/api/verifiedid/issuance-callback").set("api-key", config.verifiedIdCallbackApiKey).send({})).status, 404);
});

test("callback rejects an invalid state", async () => {
  const response = await request(testApp())
    .get("/auth/redirect")
    .query({ state: "wrong-state", code: "auth-code" });
  assert.equal(response.status, 400);
  assert.match(response.text, /could not be verified/);
});

test("issuance callbacks update the authenticated browser polling status", async () => {
  const app = testApp();
  const agent = request.agent(app);
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });
  const profile = await agent.get("/profile");
  const csrfToken = profile.text.match(/name="csrfToken" value="([^"]+)"/)[1];
  await agent.post("/loyalty/issue").type("form").send({ csrfToken });

  assert.equal((await agent.get("/api/verifiedid/issuance-status?id=issuance-state-123")).status, 204);

  const retrieved = await request(app)
    .post("/api/verifiedid/issuance-callback")
    .set("api-key", config.verifiedIdCallbackApiKey)
    .send({ state: "issuance-state-123", requestStatus: "request_retrieved" });
  assert.equal(retrieved.status, 204);
  assert.deepEqual((await agent.get("/api/verifiedid/issuance-status?id=issuance-state-123")).body, {
    status: "request_retrieved",
    message: "Request Retrieved",
  });

  await request(app)
    .post("/api/verifiedid/issuance-callback")
    .set("api-key", config.verifiedIdCallbackApiKey)
    .send({ state: "issuance-state-123", requestStatus: "issuance_successful" });
  assert.deepEqual((await agent.get("/api/verifiedid/issuance-status?id=issuance-state-123")).body, {
    status: "issuance_successful",
    message: "Loyalty card issued successfully",
  });
});

test("verified Loyalty presentation applies 20% and completed purchase appears in My trips", async () => {
  const graphUpdates = [];
  const app = testApp({
    graphService: {
      async updateIdentityVerificationByEmail(email, attributes) {
        graphUpdates.push({ email, attributes });
      },
    },
  });
  const agent = request.agent(app);
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });

  const packages = await agent.get("/packages");
  assert.equal(packages.status, 200);
  assert.match(packages.text, /United States/);
  assert.match(packages.text, /Europe/);
  assert.match(packages.text, /Asia/);
  const csrfToken = packages.text.match(/name="csrfToken" value="([^"]+)"/)[1];

  const verification = await agent.post("/packages/us/verify").type("form").send({ csrfToken });
  assert.equal(verification.status, 200);
  assert.match(verification.text, /Present your/);
  assert.match(verification.text, /presentation-status\?id=presentation-state-456/);
  assert.equal((await agent.get("/checkout/us")).status, 403);

  await request(app)
    .post("/api/verifiedid/presentation-callback")
    .set("api-key", config.verifiedIdCallbackApiKey)
    .send({ state: "presentation-state-456", requestStatus: "presentation_verified" });
  assert.deepEqual(graphUpdates, []);
  const status = await agent.get("/api/verifiedid/presentation-status?id=presentation-state-456");
  assert.deepEqual(status.body, {
    status: "presentation_verified",
    message: "Loyalty card verified. Your 20% discount is ready.",
    checkoutUrl: "/checkout/us",
  });

  const checkout = await agent.get("/checkout/us");
  assert.equal(checkout.status, 200);
  assert.match(checkout.text, /Discount applied/);
  assert.match(checkout.text, /\$3,200/);
  assert.match(checkout.text, /−\$640/);
  assert.match(checkout.text, /\$2,560/);

  const completed = await agent.post("/checkout/us/complete").type("form").send({ csrfToken });
  assert.equal(completed.status, 302);
  assert.equal(completed.headers.location, "/trips?confirmed=1");
  const trips = await agent.get(completed.headers.location);
  assert.match(trips.text, /Purchase confirmed/);
  assert.match(trips.text, /Coast to Coast/);
  assert.match(trips.text, /\$2,560/);
  assert.match(trips.text, /My trips <span class="trip-count">1<\/span>/);
});

test("profile guides True Identity proofing and verifies a VerifiedIdentity credential", async () => {
  const graphUpdates = [];
  const app = testApp({
    graphService: {
      async updateIdentityVerificationByEmail(email, attributes) {
        graphUpdates.push({ email, attributes });
      },
    },
  });
  const agent = request.agent(app);
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });

  const initialProfile = await agent.get("/profile");
  assert.match(initialProfile.text, /Verify your government document/);
  assert.match(initialProfile.text, /href="\/identity\/verify"/);
  assert.match(initialProfile.text, /I have been verified/);
  assert.match(initialProfile.text, /Verified Identity digital credential preview/);
  const csrfToken = initialProfile.text.match(/name="csrfToken" value="([^"]+)"/)[1];
  assert.equal((await agent.post("/identity/present").type("form").send({ csrfToken })).status, 403);

  const continued = await agent.post("/identity/verified").type("form").send({ csrfToken });
  assert.equal(continued.status, 302);
  assert.equal(continued.headers.location, "/profile#identity-step-3");
  assert.match((await agent.get(continued.headers.location)).text, /Present both credentials/);

  const trueIdentity = await agent.get("/identity/verify");
  assert.equal(trueIdentity.status, 302);
  const target = new URL(trueIdentity.headers.location);
  assert.equal(target.origin, "https://trueidentity-vcdemo01.azurewebsites.net");
  assert.equal(target.searchParams.get("returnUrl"), "https://eeidtravelwithvid.azurewebsites.net/profile");
  assert.equal(target.searchParams.get("firstName"), "Avery");
  assert.equal(target.searchParams.get("lastName"), "Traveler");

  const returnedProfile = await agent.get("/profile?trueIdVerified=true&firstName=Avery&lastName=Traveler");
  assert.match(returnedProfile.text, /Card received/);
  assert.match(returnedProfile.text, /Present both credentials/);

  const presentation = await agent.post("/identity/present").type("form").send({ csrfToken });
  assert.equal(presentation.status, 200);
  assert.match(presentation.text, /VerifiedIdentity/);
  assert.match(presentation.text, /NorthstarLoyalty/);
  assert.match(presentation.text, /presentation-status\?id=identity-state-789/);

  await request(app)
    .post("/api/verifiedid/presentation-callback")
    .set("api-key", config.verifiedIdCallbackApiKey)
    .send({
      state: "identity-state-789",
      requestStatus: "presentation_verified",
      verifiedCredentialsData: [
        {
          type: "VerifiedIdentity",
          expirationDate: "2030-04-05T12:30:00Z",
        },
        {
          type: "NorthstarLoyalty",
          claims: { email: "Avery@Example.com", loyalty: "654321" },
        },
      ],
      receipt: "x".repeat(110 * 1024),
    });
  assert.deepEqual(graphUpdates, [{
    email: "avery@example.com",
    attributes: {
      isVerified: "Yes",
      loyalty: "654321",
      expirationDate: "2030-04-05T12:30:00.000Z",
    },
  }]);
  assert.deepEqual((await agent.get("/api/verifiedid/presentation-status?id=identity-state-789")).body, {
    status: "presentation_verified",
    message: "Identity and loyalty credentials verified successfully",
    continueUrl: "/profile?identityVerified=true",
  });

  const verifiedProfile = await agent.get("/profile?identityVerified=true");
  assert.match(verifiedProfile.text, /Identity verified/);
});

test("failed identity presentation sets isVerified to No and clears expiration", async () => {
  const graphUpdates = [];
  const app = testApp({
    graphService: {
      async updateIdentityVerification(userId, attributes) {
        graphUpdates.push({ userId, attributes });
      },
    },
  });
  const agent = request.agent(app);
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });
  const profile = await agent.get("/profile");
  const csrfToken = profile.text.match(/name="csrfToken" value="([^"]+)"/)[1];
  await agent.post("/identity/verified").type("form").send({ csrfToken });
  await agent.post("/identity/present").type("form").send({ csrfToken });

  const callback = await request(app)
    .post("/api/verifiedid/presentation-callback")
    .set("api-key", config.verifiedIdCallbackApiKey)
    .send({
      state: "identity-state-789",
      requestStatus: "presentation_error",
      error: { message: "Credential validation failed" },
    });

  assert.equal(callback.status, 204);
  assert.deepEqual(graphUpdates, [{
    userId: "11111111-2222-3333-4444-555555555555",
    attributes: { isVerified: "No", loyalty: null, expirationDate: null },
  }]);
  assert.deepEqual((await agent.get("/api/verifiedid/presentation-status?id=identity-state-789")).body, {
    status: "presentation_error",
    message: "Credential validation failed",
  });
});

test("Graph failure leaves identity presentation pending for callback retry", async () => {
  const app = testApp({
    graphService: {
      async updateIdentityVerificationByEmail() {
        throw new Error("Graph update unavailable");
      },
    },
  });
  const agent = request.agent(app);
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });
  const profile = await agent.get("/profile");
  const csrfToken = profile.text.match(/name="csrfToken" value="([^"]+)"/)[1];
  await agent.post("/identity/verified").type("form").send({ csrfToken });
  await agent.post("/identity/present").type("form").send({ csrfToken });

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const callback = await request(app)
      .post("/api/verifiedid/presentation-callback")
      .set("api-key", config.verifiedIdCallbackApiKey)
      .send({
        state: "identity-state-789",
        requestStatus: "presentation_verified",
        verifiedCredentialsData: [
          { type: "VerifiedIdentity", expirationDate: "2030-04-05T12:30:00Z" },
          {
            type: "NorthstarLoyalty",
            claims: { email: "avery@example.com", loyalty: "654321" },
          },
        ],
      });
    assert.equal(callback.status, 500);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal((await agent.get("/api/verifiedid/presentation-status?id=identity-state-789")).status, 204);
});

test("identity callback rejects a presentation missing NorthstarLoyalty claims", async () => {
  const graphUpdates = [];
  const app = testApp({
    graphService: {
      async updateIdentityVerificationByEmail(email, attributes) {
        graphUpdates.push({ email, attributes });
      },
    },
  });
  const agent = request.agent(app);
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });
  const profile = await agent.get("/profile");
  const csrfToken = profile.text.match(/name="csrfToken" value="([^"]+)"/)[1];
  await agent.post("/identity/verified").type("form").send({ csrfToken });
  await agent.post("/identity/present").type("form").send({ csrfToken });

  const callback = await request(app)
    .post("/api/verifiedid/presentation-callback")
    .set("api-key", config.verifiedIdCallbackApiKey)
    .send({
      state: "identity-state-789",
      requestStatus: "presentation_verified",
      verifiedCredentialsData: [
        { type: "VerifiedIdentity", expirationDate: "2030-04-05T12:30:00Z" },
        { type: "NorthstarLoyalty", claims: {} },
      ],
    });

  assert.equal(callback.status, 400);
  assert.deepEqual(graphUpdates, []);
  assert.equal((await agent.get("/api/verifiedid/presentation-status?id=identity-state-789")).status, 204);
});

test("isVerified No shows the government identity verification steps", async () => {
  const agent = request.agent(testApp({
    userClaims: {
      extension_test_isVerified: "No",
      extension_test_VerifiedIDExpirationDate: null,
    },
  }));
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });

  const profile = await agent.get("/profile");
  assert.match(profile.text, /Verify with True Identity/);
  assert.doesNotMatch(profile.text, /Update identity/);
});

test("verified current identity shows its expiration and an update action", async () => {
  const agent = request.agent(testApp({
    userClaims: {
      extension_test_isVerified: true,
      extension_test_VerifiedIDExpirationDate: "2099-06-15T00:00:00Z",
    },
  }));
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });

  const profile = await agent.get("/profile");
  assert.match(profile.text, /Verified Identity on file/);
  assert.match(profile.text, /June 15, 2099/);
  assert.match(profile.text, /Update identity/);
  assert.equal((profile.text.match(/identity-step is-complete/g) || []).length, 3);
});

test("expired identity shows an expired status and an update action", async () => {
  const agent = request.agent(testApp({
    userClaims: {
      extension_test_isVerified: "Yes",
      extension_test_VerifiedIDExpirationDate: "2000-01-02T00:00:00Z",
    },
  }));
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });

  const profile = await agent.get("/profile");
  assert.match(profile.text, /Verified Identity expired/);
  assert.match(profile.text, /January 2, 2000/);
  assert.match(profile.text, /Update identity/);
});

test("updating identity clears Graph attributes and resets all three steps", async () => {
  const graphUpdates = [];
  const agent = request.agent(testApp({
    userClaims: {
      extension_test_isVerified: "Yes",
      extension_test_VerifiedIDExpirationDate: "2099-06-15T00:00:00Z",
    },
    graphService: {
      async updateIdentityVerification(userId, attributes) {
        graphUpdates.push({ userId, attributes });
      },
    },
  }));
  await agent.get("/auth/signin");
  await agent.get("/auth/redirect").query({ state: "valid-state", code: "auth-code" });
  const profile = await agent.get("/profile");
  const csrfToken = profile.text.match(/name="csrfToken" value="([^"]+)"/)[1];

  const reset = await agent.post("/identity/reset").type("form").send({ csrfToken });
  assert.equal(reset.status, 302);
  assert.equal(reset.headers.location, "/profile#identity-proof");
  assert.deepEqual(graphUpdates, [{
    userId: "11111111-2222-3333-4444-555555555555",
    attributes: { isVerified: "No", loyalty: null, expirationDate: null },
  }]);

  const resetProfile = await agent.get(reset.headers.location);
  assert.match(resetProfile.text, /Verify with True Identity/);
  assert.doesNotMatch(resetProfile.text, /Document check complete|Card received|Identity verified|Update identity/);
});