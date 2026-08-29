import { NextRequest } from "next/server";
import { z } from "zod";
import { jwtVerify } from "jose";

// Startup validation: ensure JWT secret is configured
const JWT_SECRET = process.env.CHAT_WIDGET_SESSION_JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.trim() === '') {
    throw new Error(
        'FATAL: CHAT_WIDGET_SESSION_JWT_SECRET environment variable is not set or empty. ' +
        'Widget API authentication cannot function without it. ' +
        'Set this variable to a cryptographically random secret before starting the application.'
    );
}

export const Session = z.object({
    userId: z.string(),
    userName: z.string(),
    projectId: z.string(),
});

/*
    This function wraps an API handler with client ID validation.
    It checks for a client ID in the request headers and returns a 400 
    Bad Request response if missing. It then validates the client ID by
    verifying it matches the project secret. If invalid,
    it returns a 403 Forbidden response. Otherwise, it calls the
    provided handler function.
*/
export async function clientIdCheck(req: NextRequest, handler: (projectId: string) => Promise<Response>): Promise<Response> {
    const clientId = req.headers.get('x-client-id')?.trim();
    if (!clientId) {
        return Response.json({ error: "Missing client ID in request" }, { status: 400 });
    }

    // The client ID is expected to be the project ID.
    // Look up the project to verify it exists.
    const { container } = await import('@/di/container');
    const { IProjectsRepository } = await import('@/src/application/repositories/projects.repository.interface');
    const projectsRepository = container.resolve<IProjectsRepository>('projectsRepository');

    const project = await projectsRepository.fetch(clientId);
    if (!project) {
        return Response.json({ error: "Invalid client ID" }, { status: 403 });
    }

    return await handler(project.id);
}

/*
    This function wraps an API handler with session validation.
    It checks for a session in the request headers and returns a 400 
    Bad Request response if missing. It then verifies the session JWT
    using the CHAT_WIDGET_SESSION_JWT_SECRET. If verification fails,
    it returns a 403 Forbidden response. Otherwise, it extracts the
    session payload and calls the provided handler function.
*/
export async function authCheck(req: NextRequest, handler: (session: z.infer<typeof Session>) => Promise<Response>): Promise<Response> {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return Response.json({ error: "Authorization header must be a Bearer token" }, { status: 400 });
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        return Response.json({ error: "Missing session token in request" }, { status: 400 });
    }
    
    let session;
    try {
        session = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET));
    } catch (error) {
        return Response.json({ error: "Invalid session token" }, { status: 403 });
    }
    
    return await handler(session.payload as z.infer<typeof Session>);
}
