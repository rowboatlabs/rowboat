"use server";
import { Claims, getSession } from "@auth0/nextjs-auth0";
import { USE_AUTH } from "../lib/feature_flags";
import { WithStringId, User } from "../lib/types/types";
import { getDbUserForAuthUser } from "../lib/user";
import { z } from "zod";

export async function authCheck(): Promise<WithStringId<z.infer<typeof User>>> {
    let authUser: Claims | null = null;

    // get user from session
    if (!USE_AUTH) {
        authUser = {
            email: 'guestuser@rowboatlabs.com',
            email_verified: true,
            sub: 'guest_user',
        };
    } else {
        const { user: sessionUser } = await getSession() || {};
        if (!sessionUser) {
            throw new Error('User not authenticated');
        }
        authUser = sessionUser;
    }

    // fetch db user
    const dbUser = await getDbUserForAuthUser(authUser);
    return dbUser;
}
