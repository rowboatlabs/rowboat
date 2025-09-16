// lib/auth0.js

import { NextResponse } from "next/server";
import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { USE_AUTH } from "../lib/feature_flags";

// Treat config as present only when all required pieces exist
const auth0Domain = process.env.AUTH0_DOMAIN || process.env.AUTH0_ISSUER_BASE_URL;
const auth0ClientId = process.env.AUTH0_CLIENT_ID;
const auth0ClientSecret = process.env.AUTH0_CLIENT_SECRET || process.env.AUTH0_CLIENT_ASSERTION_SIGNING_KEY;
const auth0BaseUrl = process.env.AUTH0_BASE_URL;
const auth0Secret = process.env.AUTH0_SECRET;

const isAuthConfigured = Boolean(
  auth0Domain && auth0ClientId && auth0BaseUrl && auth0Secret && auth0ClientSecret
);

// When auth is disabled or misconfigured, export a safe no-op shim so imports won't crash
const createAuth0Shim = () => ({
  async getSession(_req?: unknown) {
    return null;
  },
  async middleware(_req?: unknown) {
    return NextResponse.next();
  },
});

export const auth0 = USE_AUTH && isAuthConfigured
  ? new Auth0Client({
      domain: auth0Domain,
      clientId: auth0ClientId,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      appBaseUrl: auth0BaseUrl,
      secret: auth0Secret,
      authorizationParameters: {
        scope: process.env.AUTH0_SCOPE,
        audience: process.env.AUTH0_AUDIENCE,
      }
    })
  : createAuth0Shim();