const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  createSignupEventService,
  HEADER_EVENT_ID,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
} = require("../src/signupEvent");

const eventConfig = {
  ciamStoreEvent: {
    url: "https://ciamstorepoc.azurewebsites.net/api/integrations/signup-events",
    connectionId: "travel-demo",
    secret: "shared-secret",
  },
};

test("signup event signs the timestamp, event ID, and exact raw JSON body", async () => {
  let request;
  const service = createSignupEventService({
    config: eventConfig,
    randomUUID: () => "11111111-2222-4333-8444-555555555555",
    now: () => new Date("2026-09-27T13:35:22.819Z"),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 202 };
    },
  });

  await service.sendSignupCompleted();

  const expectedBody = JSON.stringify({
    eventId: "11111111-2222-4333-8444-555555555555",
    eventType: "signup_completed",
    occurredAt: "2026-09-27T13:35:22.819Z",
    source: "eeidtravelwithvid",
    connectionId: "travel-demo",
  });
  const signingBytes = `2026-09-27T13:35:22.819Z.11111111-2222-4333-8444-555555555555.${expectedBody}`;
  const expectedSignature = crypto.createHmac("sha256", "shared-secret").update(signingBytes, "utf8").digest("hex");

  assert.equal(request.url, eventConfig.ciamStoreEvent.url);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body, expectedBody);
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.equal(request.options.headers[HEADER_TIMESTAMP], "2026-09-27T13:35:22.819Z");
  assert.equal(request.options.headers[HEADER_EVENT_ID], "11111111-2222-4333-8444-555555555555");
  assert.equal(request.options.headers[HEADER_SIGNATURE], `sha256=${expectedSignature}`);
  assert.ok(request.options.signal instanceof AbortSignal);
});

test("signup event payload contains only the privacy-preserving contract fields", async () => {
  let payload;
  const service = createSignupEventService({
    config: eventConfig,
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, status: 202 };
    },
  });

  await service.sendSignupCompleted();

  assert.deepEqual(Object.keys(payload), [
    "eventId",
    "eventType",
    "occurredAt",
    "source",
    "connectionId",
  ]);
  assert.equal(payload.eventType, "signup_completed");
  assert.equal(payload.source, "eeidtravelwithvid");
  assert.equal(payload.connectionId, "travel-demo");
  assert.match(payload.eventId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Date(payload.occurredAt).toISOString(), payload.occurredAt);
});

test("signup event delivery makes one bounded attempt and rejects non-success", async () => {
  let attempts = 0;
  let signal;
  const service = createSignupEventService({
    config: eventConfig,
    timeoutMs: 25,
    fetchImpl: async (_url, options) => {
      attempts += 1;
      signal = options.signal;
      return { ok: false, status: 503 };
    },
  });

  await assert.rejects(
    service.sendSignupCompleted(),
    /CIAM Store signup event returned HTTP 503/,
  );
  assert.equal(attempts, 1);
  assert.ok(signal instanceof AbortSignal);
});
