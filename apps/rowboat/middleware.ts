import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { withMiddlewareAuthRequired } from "@auth0/nextjs-auth0/edge";

const corsOptions = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-client-id, Authorization',
}

const auth0MiddlewareHandler = withMiddlewareAuthRequired();

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  // Check if the request path starts with /api/
  if (request.nextUrl.pathname.startsWith('/api/')) {
    // Handle preflighted requests
    if (request.method === 'OPTIONS') {
      const preflightHeaders = {
        'Access-Control-Allow-Origin': '*',
        ...corsOptions,
      }
      return NextResponse.json({}, { headers: preflightHeaders });
    }

    // Handle simple requests
    const response = NextResponse.next();

    // Set CORS headers for all origins
    response.headers.set('Access-Control-Allow-Origin', '*');

    Object.entries(corsOptions).forEach(([key, value]) => {
      response.headers.set(key, value);
    })

    return response;
  }

  if (request.nextUrl.pathname.startsWith('/projects') ||
    request.nextUrl.pathname.startsWith('/billing') ||
    request.nextUrl.pathname.startsWith('/onboarding')) {
    // Skip auth check if USE_AUTH is not enabled
    if (process.env.USE_AUTH !== 'true') {
      return NextResponse.next();
    }
    return auth0MiddlewareHandler(request, event);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/projects/:path*',
    '/billing/:path*',
    // '/onboarding/:path*',
    '/api/v1/:path*',
    '/api/widget/v1/:path*',
  ],
};
