const msal = require("@azure/msal-node");

function externalIdentityFilter(email, issuer) {
  const escapedEmail = email.replaceAll("'", "''");
  const escapedIssuer = issuer.replaceAll("'", "''");
  return `identities/any(identity:identity/issuer eq '${escapedIssuer}' and identity/issuerAssignedId eq '${escapedEmail}')`;
}

function accountEmailFilter(email) {
  const escapedEmail = email.replaceAll("'", "''");
  return `mail eq '${escapedEmail}' or userPrincipalName eq '${escapedEmail}'`;
}

function createGraphService(config) {
  const client = new msal.ConfidentialClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      clientSecret: config.clientSecret,
    },
  });

  return {
    async getIdentityVerification(userId) {
      const token = await client.acquireTokenByClientCredential({
        scopes: ["https://graph.microsoft.com/.default"],
      });
      if (!token?.accessToken) {
        throw new Error("Microsoft Graph did not return an access token");
      }

      const select = encodeURIComponent(`${config.graphIsVerifiedAttribute},${config.graphVerifiedIdExpirationAttribute}`);
      const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}?$select=${select}`, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Microsoft Graph user read failed (${response.status}): ${details}`);
      }

      const user = await response.json();
      return {
        isVerified: user[config.graphIsVerifiedAttribute],
        expirationDate: user[config.graphVerifiedIdExpirationAttribute],
      };
    },

    async updateIdentityVerification(userId, { isVerified, loyalty, expirationDate }) {
      const token = await client.acquireTokenByClientCredential({
        scopes: ["https://graph.microsoft.com/.default"],
      });
      if (!token?.accessToken) {
        throw new Error("Microsoft Graph did not return an access token");
      }

      const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          [config.graphIsVerifiedAttribute]: isVerified,
          ...(loyalty !== undefined && { [config.graphLoyaltyAttribute]: loyalty }),
          [config.graphVerifiedIdExpirationAttribute]: expirationDate,
        }),
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Microsoft Graph user update failed (${response.status}): ${details}`);
      }
    },

    async updateIdentityVerificationByEmail(email, attributes) {
      const token = await client.acquireTokenByClientCredential({
        scopes: ["https://graph.microsoft.com/.default"],
      });
      if (!token?.accessToken) {
        throw new Error("Microsoft Graph did not return an access token");
      }

      const filter = encodeURIComponent(externalIdentityFilter(email, config.externalIdIssuer));
      const response = await fetch(`https://graph.microsoft.com/v1.0/users?$filter=${filter}&$select=id&$top=2`, {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });
      if (!response.ok) {
        const details = await response.text();
        throw new Error(`Microsoft Graph user lookup failed (${response.status}): ${details}`);
      }

      let result = await response.json();
      if (result.value?.length === 0) {
        const fallbackFilter = encodeURIComponent(accountEmailFilter(email));
        const fallbackResponse = await fetch(`https://graph.microsoft.com/v1.0/users?$filter=${fallbackFilter}&$select=id&$top=2`, {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        });
        if (!fallbackResponse.ok) {
          const details = await fallbackResponse.text();
          throw new Error(`Microsoft Graph user fallback lookup failed (${fallbackResponse.status}): ${details}`);
        }
        result = await fallbackResponse.json();
      }
      if (result.value?.length !== 1) {
        throw new Error(`Expected one External ID user for loyalty email, found ${result.value?.length || 0}`);
      }
      await this.updateIdentityVerification(result.value[0].id, attributes);
      return result.value[0].id;
    },
  };
}

module.exports = { accountEmailFilter, createGraphService, externalIdentityFilter };