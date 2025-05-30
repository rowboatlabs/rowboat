"use server";
import { getSession } from "@auth0/nextjs-auth0";
import { USE_AUTH } from "../lib/feature_flags";
import { WithStringId, User } from "../lib/types/types";
import { getUserFromSessionId, GUEST_DB_USER } from "../lib/auth";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { usersCollection } from "../lib/mongodb";

export async function authCheck(): Promise<WithStringId<z.infer<typeof User>>> {
    if (!USE_AUTH) {
        return GUEST_DB_USER;
    }

    const { user } = await getSession() || {};
    if (!user) {
        throw new Error('User not authenticated');
    }

    const dbUser = await getUserFromSessionId(user.sub);
    if (!dbUser) {
        throw new Error('User record not found');
    }
    return dbUser;
}

const EmailOnly = z.object({
    email: z.string().email(),
});

export async function updateUserEmail(email: string) {
    if (!USE_AUTH) {
        return;
    }
    const user = await authCheck();

    if (!email.trim()) {
        throw new Error('Email is required');
    }
    if (!EmailOnly.safeParse({ email }).success) {
        throw new Error('Invalid email');
    }

    // update customer email in db
    await usersCollection.updateOne({
        _id: new ObjectId(user._id),
    }, {
        $set: {
            email,
            updatedAt: new Date().toISOString(),
        }
    });
}
