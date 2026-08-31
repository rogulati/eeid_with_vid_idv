const crypto = require("node:crypto");
const msal = require("@azure/msal-node");

const REQUEST_SERVICE_SCOPE = "3db474b9-6a0c-4840-96ac-1fceb342124f/.default";
const REQUEST_SERVICE_ROLE = "VerifiableCredential.Create.All";
const ISSUANCE_ENDPOINT = "https://verifiedid.did.msidentity.com/v1.0/verifiableCredentials/createIssuanceRequest";
const PRESENTATION_ENDPOINT = "https://verifiedid.did.msidentity.com/v1.0/verifiableCredentials/createPresentationRequest";

function accessTokenClaims(accessToken) {
  const payload = accessToken.split(".")[1];
  if (!payload) throw new Error("Verified ID returned an invalid access token");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function claimValue(claims, ...names) {
  return names.map((name) => claims?.[name]).find((value) => typeof value === "string" && value.trim());
}

function emailClaim(claims) {
  return claimValue(claims, "email", "preferred_username")
    || claims?.emails?.find((value) => typeof value === "string" && value.trim());
}

function credentialClaims(user) {
  const email = emailClaim(user.claims);
  const displayName = claimValue(user.claims, "displayName", "name");
  const displayNameParts = displayName?.trim().split(/\s+/) || [];
  const givenName = claimValue(user.claims, "givenName", "given_name") || displayNameParts[0];
  const surname = claimValue(user.claims, "surname", "family_name") || displayNameParts.slice(1).join(" ");

  if (!givenName || !surname) {
    throw new Error("The ID token does not contain the given name and surname required for loyalty card issuance");
  }

  return {
    givenName,
    surname,
    ...(email && { email }),
    loyalty: String(crypto.randomInt(100000, 1000000)),
    ...(displayName && { displayName }),
  };
}

function presentationRequestPayload(config, state, {
  includeQRCode,
  credentialType,
  acceptedIssuers,
  requestedCredentials,
  clientName,
  purpose,
}) {
  return {
    includeQRCode,
    includeReceipt: true,
    authority: config.verifiedIdAuthority,
    callback: {
      url: `${config.baseUrl}/api/verifiedid/presentation-callback`,
      state,
      headers: { "api-key": config.verifiedIdCallbackApiKey },
    },
    registration: {
      clientName,
      purpose,
    },
    requestedCredentials: (requestedCredentials || [{ type: credentialType, acceptedIssuers }]).map((credential) => ({
      type: credential.type,
      purpose: credential.purpose || purpose,
      ...(credential.acceptedIssuers?.length && { acceptedIssuers: credential.acceptedIssuers }),
      configuration: {
        validation: { allowRevoked: true, validateLinkedDomain: true },
      },
    })),
  };
}

function createVerifiedIdService(config) {
  const client = new msal.ConfidentialClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      clientSecret: config.clientSecret,
    },
  });

  return {
    async createIssuanceRequest(user, { includeQRCode = true } = {}) {
      const token = await client.acquireTokenByClientCredential({ scopes: [REQUEST_SERVICE_SCOPE] });
      if (!token?.accessToken) throw new Error("Verified ID access token acquisition failed");
      const tokenClaims = accessTokenClaims(token.accessToken);
      if (!tokenClaims.roles?.includes(REQUEST_SERVICE_ROLE)) {
        throw new Error(`Verified ID application permission ${REQUEST_SERVICE_ROLE} has not been granted with admin consent`);
      }

      const state = crypto.randomUUID();
      const response = await fetch(ISSUANCE_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          includeQRCode,
          authority: config.verifiedIdAuthority,
          callback: {
            url: `${config.baseUrl}/api/verifiedid/issuance-callback`,
            state,
            headers: { "api-key": config.verifiedIdCallbackApiKey },
          },
          registration: { clientName: "Northstar" },
          type: config.verifiedIdType,
          manifest: config.verifiedIdManifest,
          claims: credentialClaims(user),
        }),
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(`Verified ID issuance request failed (${response.status}): ${body.message || body.error?.message || "Unknown error"}`);
      }
      return { ...body, state };
    },

    async createPresentationRequest({
      includeQRCode = true,
      credentialType = config.verifiedIdType,
      acceptedIssuers,
      requestedCredentials,
      clientName = "Northstar Travel",
      purpose = "Verify your Northstar Loyalty card to apply a 20% member discount",
    } = {}) {
      const token = await client.acquireTokenByClientCredential({ scopes: [REQUEST_SERVICE_SCOPE] });
      if (!token?.accessToken) throw new Error("Verified ID access token acquisition failed");
      const tokenClaims = accessTokenClaims(token.accessToken);
      if (!tokenClaims.roles?.includes(REQUEST_SERVICE_ROLE)) {
        throw new Error(`Verified ID application permission ${REQUEST_SERVICE_ROLE} has not been granted with admin consent`);
      }

      const state = crypto.randomUUID();
      const response = await fetch(PRESENTATION_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(presentationRequestPayload(config, state, {
          includeQRCode,
          credentialType,
          acceptedIssuers,
          requestedCredentials,
          clientName,
          purpose,
        })),
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(`Verified ID presentation request failed (${response.status}): ${body.message || body.error?.message || "Unknown error"}`);
      }
      return { ...body, state };
    },
  };
}

module.exports = { accessTokenClaims, createVerifiedIdService, credentialClaims, presentationRequestPayload };