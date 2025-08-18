import { NextRequest } from "next/server";
import { clientIdCheck } from "../../utils";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { Session } from "../../utils";
import { apiV1 } from "rowboat-shared";

export async function POST(req: NextRequest): Promise<Response> {
    return new Response('Not implemented', { status: 501 });
    /*
    return await clientIdCheck(req, async (projectId) => {
        // decode and validate JWT
        const json = await req.json();
        const parsedRequest = apiV1.ApiCreateUserSessionRequest.parse(json);

        // fetch client signing key from db
        const project = await projectsCollection.findOne({
            _id: projectId
        });
        if (!project) {
            return Response.json({ error: 'Project not found' }, { status: 404 });
        }
        const clientSigningKey = project.secret;

        // verify client signing key
        let verified;
        try {
            verified = await jwtVerify<{
                userId: string;
                userName?: string;
            }>(parsedRequest.userDataJwt, new TextEncoder().encode(clientSigningKey));
        } catch (e) {
            return Response.json({ error: 'Invalid jwt' }, { status: 403 });
        }

        // create new user session
        const session: z.infer<typeof Session> = {
            userId: verified.payload.userId,
            userName: verified.payload.userName ?? 'Unknown',
            projectId: projectId
        };

        // Create and sign JWT
        const token = await new SignJWT(session)
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('24h')
            .sign(new TextEncoder().encode(process.env.CHAT_WIDGET_SESSION_JWT_SECRET));

        const response: z.infer<typeof apiV1.ApiCreateGuestSessionResponse> = {
            sessionId: token,
        };

        return Response.json(response);
    });
    */
}
