const path = require("node:path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const crypto = require("node:crypto");

const VERIFIED_IDENTITY_CREDENTIAL_TYPE = "VerifiedIdentity";

function credentialByType(credentials, credentialType) {
  return credentials?.find(({ type }) => (
    type === credentialType || (Array.isArray(type) && type.includes(credentialType))
  ));
}

function isMobileRequest(request) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(request.get("user-agent") || "");
}

const TRAVEL_PACKAGES = [
  { id: "us", region: "United States", title: "Coast to Coast", duration: "9 days", price: 3200, image: "https://images.unsplash.com/photo-1485738422979-f5c462d49f74?auto=format&fit=crop&w=1200&q=85", description: "New York energy, desert skies, and California's Pacific edge." },
  { id: "europe", region: "Europe", title: "The Grand Passage", duration: "11 days", price: 4500, image: "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=1200&q=85", description: "Parisian mornings, Alpine railways, and evenings in Rome." },
  { id: "asia", region: "Asia", title: "Eastward Bound", duration: "12 days", price: 3900, image: "https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=85", description: "Tokyo neighborhoods, Kyoto temples, and Seoul after dark." },
];

function packageById(id) {
  return TRAVEL_PACKAGES.find((travelPackage) => travelPackage.id === id);
}

function userNames(user) {
  const displayName = user.claims?.displayName || user.claims?.name || user.name || "";
  const parts = displayName.trim().split(/\s+/);
  return {
    firstName: user.claims?.givenName || user.claims?.given_name || parts[0] || "",
    lastName: user.claims?.surname || user.claims?.family_name || parts.slice(1).join(" "),
  };
}

function identityVerificationFromClaims(user, config) {
  const claims = user.claims || {};
  const verifiedValue = claims[config.graphIsVerifiedAttribute] ?? claims.isVerified;
  const expirationValue = claims[config.graphVerifiedIdExpirationAttribute] ?? claims.VerifiedIDExpirationDate;
  const isVerified = verifiedValue === true || ["true", "yes"].includes(String(verifiedValue).toLowerCase());
  const expirationTime = Date.parse(expirationValue);
  const hasExpiration = Boolean(expirationValue) && !Number.isNaN(expirationTime);

  return {
    isVerified: isVerified && hasExpiration,
    expirationDate: hasExpiration ? new Date(expirationTime) : null,
    isExpired: isVerified && hasExpiration && expirationTime <= Date.now(),
  };
}

function setIdentityVerificationClaims(user, config, isVerified, expirationDate) {
  user.claims[config.graphIsVerifiedAttribute] = isVerified ? "Yes" : "No";
  user.claims[config.graphVerifiedIdExpirationAttribute] = expirationDate;
}

function createApp({ config, authService, graphService, verifiedIdService }) {
  const app = express();
  const issuanceStatuses = new Map();
  const presentationStatuses = new Map();
  const tripsByUser = new Map();
  if (config.isProduction) app.set("trust proxy", 1);

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(path.join(__dirname, "public")));
  app.use(session({
    name: "northstar.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      maxAge: 60 * 60 * 1000,
    },
  }));
  app.use((request, response, next) => {
    const userId = request.session.user?.claims?.sub || request.session.user?.username;
    response.locals.tripCount = userId ? (tripsByUser.get(userId) || []).length : 0;
    next();
  });

  app.get("/health", (_request, response) => response.status(200).send("OK"));

  app.get("/", (request, response) => {
    response.render("index", { user: request.session.user });
  });

  app.get("/auth/signin", async (request, response, next) => {
    try {
      response.redirect(await authService.getLoginUrl(request.session));
    } catch (error) {
      next(error);
    }
  });

  app.get("/auth/redirect", async (request, response, next) => {
    try {
      if (!request.query.state || request.query.state !== request.session.authState) {
        return response.status(400).render("error", { message: "The authentication response could not be verified." });
      }
      if (request.query.error) {
        return response.status(401).render("error", { message: request.query.error_description || "Sign-in was not completed." });
      }

      const result = await authService.exchangeCode(request.query.code);
      request.session.regenerate((error) => {
        if (error) return next(error);
        request.session.user = {
          name: result.account?.name || result.idTokenClaims?.name || "traveler",
          username: result.account?.username || result.idTokenClaims?.email || "",
          idToken: result.idToken,
          claims: result.idTokenClaims,
        };
        response.redirect("/profile");
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/profile", async (request, response, next) => {
    try {
      if (!request.session.user) return response.redirect("/auth/signin");
      request.session.csrfToken ||= crypto.randomBytes(24).toString("base64url");
      if (request.query.trueIdVerified === "true" && request.session.identityProofingStarted) {
        request.session.trueIdentityComplete = true;
      }
      const identityPresentation = presentationStatuses.get(request.session.identityPresentationState);
      if (request.query.identityVerified === "true" && identityPresentation?.flow === "identity" && identityPresentation.status === "presentation_verified") {
        request.session.identityVerified = true;
        setIdentityVerificationClaims(request.session.user, config, true, identityPresentation.expirationDate);
      } else if (request.session.user.claims?.oid && graphService.getIdentityVerification) {
        const verification = await graphService.getIdentityVerification(request.session.user.claims.oid);
        setIdentityVerificationClaims(
          request.session.user,
          config,
          verification.isVerified === true || ["true", "yes"].includes(String(verification.isVerified).toLowerCase()),
          verification.expirationDate || null,
        );
      }
      const directoryVerification = identityVerificationFromClaims(request.session.user, config);
      response.render("profile", {
        user: request.session.user,
        csrfToken: request.session.csrfToken,
        trueIdentityComplete: Boolean(request.session.trueIdentityComplete),
        identityVerified: directoryVerification.isVerified || Boolean(request.session.identityVerified),
        identityExpirationDate: directoryVerification.expirationDate,
        identityExpired: directoryVerification.isExpired,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/identity/reset", async (request, response, next) => {
    try {
      if (!request.session.user) return response.redirect("/auth/signin");
      if (!request.body.csrfToken || request.body.csrfToken !== request.session.csrfToken) {
        return response.status(403).render("error", { message: "The identity update request could not be verified." });
      }
      const userId = request.session.user.claims?.oid;
      if (!userId) {
        return response.status(400).render("error", { message: "Your ID token must contain an object ID to update identity verification." });
      }

      await graphService.updateIdentityVerification(userId, { isVerified: "No", loyalty: null, expirationDate: null });
      setIdentityVerificationClaims(request.session.user, config, false, null);
      presentationStatuses.delete(request.session.identityPresentationState);
      delete request.session.identityProofingStarted;
      delete request.session.trueIdentityComplete;
      delete request.session.identityVerified;
      delete request.session.identityPresentationState;
      delete request.session.presentationState;
      response.redirect("/profile#identity-proof");
    } catch (error) {
      next(error);
    }
  });

  app.get("/identity/verify", (request, response) => {
    if (!request.session.user) return response.redirect("/auth/signin");
    const { firstName, lastName } = userNames(request.session.user);
    if (!firstName || !lastName) {
      return response.status(400).render("error", { message: "Your ID token must contain a first and last name to start identity verification." });
    }
    request.session.identityProofingStarted = true;
    const trueIdentityUrl = new URL("https://trueidentity-vcdemo01.azurewebsites.net/");
    trueIdentityUrl.searchParams.set("returnUrl", `${config.baseUrl}/profile`);
    trueIdentityUrl.searchParams.set("firstName", firstName);
    trueIdentityUrl.searchParams.set("lastName", lastName);
    response.redirect(trueIdentityUrl.toString());
  });

  app.post("/identity/verified", (request, response) => {
    if (!request.session.user) return response.redirect("/auth/signin");
    if (!request.body.csrfToken || request.body.csrfToken !== request.session.csrfToken) {
      return response.status(403).render("error", { message: "The identity verification continuation could not be verified." });
    }
    request.session.trueIdentityComplete = true;
    response.redirect("/profile#identity-step-3");
  });

  app.post("/identity/present", async (request, response, next) => {
    try {
      if (!request.session.user) return response.redirect("/auth/signin");
      if (!request.body.csrfToken || request.body.csrfToken !== request.session.csrfToken) {
        return response.status(403).render("error", { message: "The identity presentation request could not be verified." });
      }
      if (!request.session.trueIdentityComplete) {
        return response.status(403).render("error", { message: "Complete government document verification with True Identity first." });
      }
      const userId = request.session.user.claims?.oid;
      if (!userId) {
        return response.status(400).render("error", { message: "Your ID token must contain an object ID to save identity verification." });
      }

      const isMobile = isMobileRequest(request);
      const presentation = await verifiedIdService.createPresentationRequest({
        includeQRCode: !isMobile,
        requestedCredentials: [
          { type: VERIFIED_IDENTITY_CREDENTIAL_TYPE },
          { type: config.verifiedIdType },
        ],
        clientName: "Northstar Identity",
        purpose: "Present your Verified Identity and Northstar Loyalty credentials",
      });
      request.session.presentationState = presentation.state;
      request.session.identityPresentationState = presentation.state;
      presentationStatuses.set(presentation.state, {
        status: "pending",
        flow: "identity",
        userId,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      response.render("verify-identity", { user: request.session.user, presentation, isMobile });
    } catch (error) {
      next(error);
    }
  });

  app.post("/loyalty/issue", async (request, response, next) => {
    try {
      if (!request.session.user) return response.redirect("/auth/signin");
      if (!request.body.csrfToken || request.body.csrfToken !== request.session.csrfToken) {
        return response.status(403).render("error", { message: "The loyalty card request could not be verified." });
      }
      const isMobile = isMobileRequest(request);
      const issuance = await verifiedIdService.createIssuanceRequest(request.session.user, { includeQRCode: !isMobile });
      request.session.issuanceState = issuance.state;
      issuanceStatuses.set(issuance.state, { status: "pending", expiresAt: Date.now() + 10 * 60 * 1000 });
      response.render("loyalty", { user: request.session.user, issuance, isMobile });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/verifiedid/issuance-callback", express.json(), (request, response) => {
    if (request.get("api-key") !== config.verifiedIdCallbackApiKey) return response.sendStatus(401);
    const { state, requestStatus, error } = request.body || {};
    if (!issuanceStatuses.has(state)) return response.sendStatus(404);

    const messages = {
      request_retrieved: "Request Retrieved",
      issuance_successful: "Loyalty card issued successfully",
      issuance_error: error?.message || "Loyalty card issuance failed",
    };
    if (!messages[requestStatus]) return response.sendStatus(400);

    issuanceStatuses.set(state, {
      status: requestStatus,
      message: messages[requestStatus],
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    response.sendStatus(204);
  });

  app.get("/api/verifiedid/issuance-status", (request, response) => {
    if (!request.session.user) return response.sendStatus(401);
    const state = request.query.id;
    if (!state || state !== request.session.issuanceState) return response.sendStatus(403);

    const result = issuanceStatuses.get(state);
    if (!result || result.expiresAt < Date.now()) {
      issuanceStatuses.delete(state);
      return response.sendStatus(404);
    }
    if (result.status === "pending") return response.sendStatus(204);
    response.json({ status: result.status, message: result.message });
  });

  app.get("/packages", (request, response) => {
    if (!request.session.user) return response.redirect("/auth/signin");
    request.session.csrfToken ||= crypto.randomBytes(24).toString("base64url");
    response.render("packages", { user: request.session.user, packages: TRAVEL_PACKAGES, csrfToken: request.session.csrfToken });
  });

  app.post("/packages/:id/verify", async (request, response, next) => {
    try {
      if (!request.session.user) return response.redirect("/auth/signin");
      if (!request.body.csrfToken || request.body.csrfToken !== request.session.csrfToken) {
        return response.status(403).render("error", { message: "The package selection could not be verified." });
      }
      const travelPackage = packageById(request.params.id);
      if (!travelPackage) return response.sendStatus(404);

      const isMobile = isMobileRequest(request);
      const presentation = await verifiedIdService.createPresentationRequest({
        includeQRCode: !isMobile,
        acceptedIssuers: [config.verifiedIdAuthority],
      });
      request.session.presentationState = presentation.state;
      request.session.selectedPackageId = travelPackage.id;
      presentationStatuses.set(presentation.state, {
        status: "pending",
        flow: "loyalty",
        packageId: travelPackage.id,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      response.render("verify-loyalty", { user: request.session.user, presentation, travelPackage, isMobile });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/verifiedid/presentation-callback", express.json({ limit: "1mb" }), async (request, response, next) => {
    if (request.get("api-key") !== config.verifiedIdCallbackApiKey) return response.sendStatus(401);
    const { state, error } = request.body || {};
    const requestStatus = request.body?.requestStatus || request.body?.code;
    const existing = presentationStatuses.get(state);
    if (!existing) return response.sendStatus(404);

    const messages = existing.flow === "identity"
      ? {
          request_retrieved: "Identity and loyalty request retrieved",
          presentation_verified: "Identity and loyalty credentials verified successfully",
          presentation_error: error?.message || "Identity and loyalty verification failed",
        }
      : {
          request_retrieved: "Loyalty card request retrieved",
          presentation_verified: "Loyalty card verified. Your 20% discount is ready.",
          presentation_error: error?.message || "Loyalty card verification failed",
        };
    if (!messages[requestStatus]) return response.sendStatus(400);

        if (existing.flow === "identity" && ["presentation_verified", "presentation_error"].includes(requestStatus)) {
          try {
            if (requestStatus === "presentation_verified") {
              const identityCredential = credentialByType(request.body.verifiedCredentialsData, VERIFIED_IDENTITY_CREDENTIAL_TYPE);
              const loyaltyCredential = credentialByType(request.body.verifiedCredentialsData, config.verifiedIdType);
              const email = loyaltyCredential?.claims?.email;
              const loyalty = loyaltyCredential?.claims?.loyalty;
              if (!identityCredential?.expirationDate || Number.isNaN(Date.parse(identityCredential.expirationDate))) {
                return response.status(400).send("Verified Identity expiration date is missing or invalid");
              }
              if (typeof email !== "string" || !email.trim() || loyalty === undefined || loyalty === null || !String(loyalty).trim()) {
                return response.status(400).send("Northstar Loyalty email or loyalty claim is missing");
              }
              existing.expirationDate = new Date(identityCredential.expirationDate).toISOString();
              await graphService.updateIdentityVerificationByEmail(email.trim().toLowerCase(), {
                isVerified: "Yes",
                loyalty: String(loyalty),
                expirationDate: existing.expirationDate,
              });
            } else {
              await graphService.updateIdentityVerification(existing.userId, {
                isVerified: "No",
                loyalty: null,
                expirationDate: null,
              });
            }
          } catch (graphError) {
            return next(graphError);
          }
        }

    presentationStatuses.set(state, {
      ...existing,
      status: requestStatus,
      message: messages[requestStatus],
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    response.sendStatus(204);
  });

  app.get("/api/verifiedid/presentation-status", (request, response) => {
    if (!request.session.user) return response.sendStatus(401);
    const state = request.query.id;
    if (!state || state !== request.session.presentationState) return response.sendStatus(403);
    const result = presentationStatuses.get(state);
    if (!result || result.expiresAt < Date.now()) {
      presentationStatuses.delete(state);
      return response.sendStatus(404);
    }
    if (result.status === "pending") return response.sendStatus(204);
    response.json({
      status: result.status,
      message: result.message,
      ...(result.status === "presentation_verified" && result.flow === "loyalty" && { checkoutUrl: `/checkout/${result.packageId}` }),
      ...(result.status === "presentation_verified" && result.flow === "identity" && {
        continueUrl: "/profile?identityVerified=true",
      }),
    });
  });

  app.get("/checkout/:id", (request, response) => {
    if (!request.session.user) return response.redirect("/auth/signin");
    const travelPackage = packageById(request.params.id);
    const presentation = presentationStatuses.get(request.session.presentationState);
    if (!travelPackage || request.session.selectedPackageId !== travelPackage.id || presentation?.status !== "presentation_verified") {
      return response.status(403).render("error", { message: "Present your Northstar Loyalty card before continuing to checkout." });
    }
    const discountedPrice = travelPackage.price * 0.8;
    response.render("checkout", { user: request.session.user, travelPackage, discountedPrice, csrfToken: request.session.csrfToken });
  });

  app.post("/checkout/:id/complete", (request, response) => {
    if (!request.session.user) return response.redirect("/auth/signin");
    if (!request.body.csrfToken || request.body.csrfToken !== request.session.csrfToken) {
      return response.status(403).render("error", { message: "The purchase confirmation could not be verified." });
    }
    const travelPackage = packageById(request.params.id);
    const presentation = presentationStatuses.get(request.session.presentationState);
    if (!travelPackage || request.session.selectedPackageId !== travelPackage.id || presentation?.status !== "presentation_verified") {
      return response.status(403).render("error", { message: "Your loyalty verification is no longer valid." });
    }

    const userId = request.session.user.claims?.sub || request.session.user.username;
    const trips = tripsByUser.get(userId) || [];
    trips.push({ ...travelPackage, paidPrice: travelPackage.price * 0.8, confirmation: crypto.randomBytes(4).toString("hex").toUpperCase() });
    tripsByUser.set(userId, trips);
    presentationStatuses.delete(request.session.presentationState);
    delete request.session.presentationState;
    delete request.session.selectedPackageId;
    response.redirect("/trips?confirmed=1");
  });

  app.get("/trips", (request, response) => {
    if (!request.session.user) return response.redirect("/auth/signin");
    const userId = request.session.user.claims?.sub || request.session.user.username;
    response.render("trips", { user: request.session.user, trips: tripsByUser.get(userId) || [], confirmed: request.query.confirmed === "1" });
  });

  app.post("/auth/signout", (request, response, next) => {
    const logoutUrl = authService.getLogoutUrl();
    request.session.destroy((error) => {
      if (error) return next(error);
      response.clearCookie("northstar.sid");
      response.redirect(logoutUrl);
    });
  });

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).render("error", { message: "Northstar could not complete that request. Please try again." });
  });

  return app;
}

module.exports = { createApp };