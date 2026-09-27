const crypto = require("node:crypto");

const EVENT_TYPE = "signup_completed";
const SOURCE = "eeidtravelwithvid";
const HEADER_TIMESTAMP = "X-CIAM-Timestamp";
const HEADER_EVENT_ID = "X-CIAM-Event-Id";
const HEADER_SIGNATURE = "X-CIAM-Signature";
const DEFAULT_TIMEOUT_MS = 2000;

function createSignupEventService({
  config,
  fetchImpl = globalThis.fetch,
  randomUUID = crypto.randomUUID,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!config.ciamStoreEvent) {
    return {
      enabled: false,
      async sendSignupCompleted() {},
    };
  }

  const { url, connectionId, secret } = config.ciamStoreEvent;

  return {
    enabled: true,
    async sendSignupCompleted() {
      const eventId = randomUUID();
      const timestamp = now().toISOString();
      const rawBody = JSON.stringify({
        eventId,
        eventType: EVENT_TYPE,
        occurredAt: timestamp,
        source: SOURCE,
        connectionId,
      });
      const signingBytes = `${timestamp}.${eventId}.${rawBody}`;
      const signature = crypto.createHmac("sha256", secret).update(signingBytes, "utf8").digest("hex");
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [HEADER_TIMESTAMP]: timestamp,
          [HEADER_EVENT_ID]: eventId,
          [HEADER_SIGNATURE]: `sha256=${signature}`,
        },
        body: rawBody,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`CIAM Store signup event returned HTTP ${response.status}`);
      }
    },
  };
}

module.exports = {
  createSignupEventService,
  HEADER_EVENT_ID,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
};
