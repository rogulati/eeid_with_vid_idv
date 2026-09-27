const REQUIRED_SETTINGS = [
  "ENTRA_TENANT_ID",
  "ENTRA_TENANT_SUBDOMAIN",
  "ENTRA_CLIENT_ID",
  "ENTRA_CLIENT_SECRET",
  "ENTRA_REDIRECT_URI",
  "SESSION_SECRET",
  "VERIFIED_ID_AUTHORITY",
  "VERIFIED_ID_CALLBACK_API_KEY",
  "VERIFIED_ID_MANIFEST",
  "VERIFIED_ID_TYPE",
  "GRAPH_IS_VERIFIED_ATTRIBUTE",
  "GRAPH_LOYALTY_ATTRIBUTE",
  "GRAPH_VERIFIED_ID_EXPIRATION_ATTRIBUTE",
];

function loadConfig(environment = process.env) {
  const missing = REQUIRED_SETTINGS.filter((name) => !environment[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment settings: ${missing.join(", ")}`);
  }

  if (environment.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters long");
  }

  const ciamStoreSettingNames = [
    "CIAM_STORE_EVENT_URL",
    "CIAM_STORE_CONNECTION_ID",
    "CIAM_STORE_EVENT_SECRET",
  ];
  const configuredCiamStoreSettings = ciamStoreSettingNames.filter((name) => environment[name]);
  if (configuredCiamStoreSettings.length > 0 && configuredCiamStoreSettings.length < ciamStoreSettingNames.length) {
    const missingCiamStoreSettings = ciamStoreSettingNames.filter((name) => !environment[name]);
    throw new Error(`Missing CIAM Store event settings: ${missingCiamStoreSettings.join(", ")}`);
  }

  const tenantHost = `${environment.ENTRA_TENANT_SUBDOMAIN}.ciamlogin.com`;
  return {
    port: Number(environment.PORT || 3000),
    isProduction: environment.NODE_ENV === "production",
    tenantId: environment.ENTRA_TENANT_ID,
    tenantHost,
    externalIdIssuer: `${environment.ENTRA_TENANT_SUBDOMAIN}.onmicrosoft.com`,
    clientId: environment.ENTRA_CLIENT_ID,
    clientSecret: environment.ENTRA_CLIENT_SECRET,
    redirectUri: environment.ENTRA_REDIRECT_URI,
    baseUrl: new URL("/", environment.ENTRA_REDIRECT_URI).toString().replace(/\/$/, ""),
    postLogoutRedirectUri: new URL("/", environment.ENTRA_REDIRECT_URI).toString(),
    sessionSecret: environment.SESSION_SECRET,
    authority: `https://${tenantHost}/${environment.ENTRA_TENANT_ID}`,
    verifiedIdAuthority: environment.VERIFIED_ID_AUTHORITY,
    verifiedIdCallbackApiKey: environment.VERIFIED_ID_CALLBACK_API_KEY,
    verifiedIdManifest: environment.VERIFIED_ID_MANIFEST,
    verifiedIdType: environment.VERIFIED_ID_TYPE,
    graphIsVerifiedAttribute: environment.GRAPH_IS_VERIFIED_ATTRIBUTE,
    graphLoyaltyAttribute: environment.GRAPH_LOYALTY_ATTRIBUTE,
    graphVerifiedIdExpirationAttribute: environment.GRAPH_VERIFIED_ID_EXPIRATION_ATTRIBUTE,
    ciamStoreEvent: configuredCiamStoreSettings.length === ciamStoreSettingNames.length
      ? {
        url: environment.CIAM_STORE_EVENT_URL,
        connectionId: environment.CIAM_STORE_CONNECTION_ID,
        secret: environment.CIAM_STORE_EVENT_SECRET,
      }
      : null,
  };
}

module.exports = { loadConfig };