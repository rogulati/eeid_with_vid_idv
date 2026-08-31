const crypto = require("node:crypto");
const msal = require("@azure/msal-node");

function createAuthService(config) {
  const client = new msal.ConfidentialClientApplication({
    auth: {
      clientId: config.clientId,
      authority: config.authority,
      clientSecret: config.clientSecret,
      knownAuthorities: [config.tenantHost],
    },
  });

  return {
    async getLoginUrl(session) {
      const state = crypto.randomBytes(24).toString("base64url");
      session.authState = state;
      return client.getAuthCodeUrl({
        scopes: ["openid", "profile", "email"],
        redirectUri: config.redirectUri,
        responseMode: "query",
        state,
      });
    },

    async exchangeCode(code) {
      return client.acquireTokenByCode({
        code,
        scopes: ["openid", "profile", "email"],
        redirectUri: config.redirectUri,
      });
    },

    getLogoutUrl() {
      const params = new URLSearchParams({
        post_logout_redirect_uri: config.postLogoutRedirectUri,
      });
      return `${config.authority}/oauth2/v2.0/logout?${params}`;
    },
  };
}

module.exports = { createAuthService };