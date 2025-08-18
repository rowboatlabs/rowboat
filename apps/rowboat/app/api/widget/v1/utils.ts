import { NextRequest } from "next/server";
import { z } from "zod";
import { jwtVerify } from "jose";

export const Session = z.object({
    userId: z.string(),
    userName: z.string(),
    projectId: z.string(),
});

/*
    This function wraps an API handler with client ID validation.
    It checks for a client ID in the request headers and returns a 400 
    Bad Request response if missing. It then looks up the client ID in the
    database to fetch the corresponding project ID. If no record is found,
    it returns a 403 Forbidden response. Otherwise, it sets the project ID
    in the request headers and calls the provided handler function.
*/
export async function clientIdCheck(req: NextRequest, handler: (projectId: string) => Promise<Response>): Promise<Response> {
    return new Response('Not implemented', { status: 501 });
    /*
    const clientId = req.headers.get('x-client-id')?.trim();
    if (!clientId) {
        return Response.json({ error: "Missing client ID in request" }, { status: 400 });
    }
    const project = await projectsCollection.findOne({ 
        chatClientId: clientId
    });
    if (!project) {
        return Response.json({ error: "Invalid client ID" }, { status: 403 });
    }
    // set the project id in the request headers
    req.headers.set('x-project-id', project._id);
    return await handler(project._id);
    */
}

/*
    This function wraps an API handler with session validation.
    It checks for a session in the request headers and returns a 400 
    Bad Request response if missing. It then verifies the session JWT.
    If no record is found, it returns a 403 Forbidden response. Otherwise,
    it sets the project ID and user ID in the request headers and calls the
    provided handler function.
*/
export async function authCheck(req: NextRequest, handler: (session: z.infer<typeof Session>) => Promise<Response>): Promise<Response> {
    return new Response('Not implemented', { status: 501 });
    /*
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
        session = await jwtVerify(token, new TextEncoder().encode(process.env.CHAT_WIDGET_SESSION_JWT_SECRET));
    } catch (error) {
        return Response.json({ error: "Invalid session token" }, { status: 403 });
    }
    
    return await handler(session.payload as z.infer<typeof Session>);
    */
}
