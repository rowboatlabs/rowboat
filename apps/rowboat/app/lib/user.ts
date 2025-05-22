import { Claims } from "@auth0/nextjs-auth0";
import { usersCollection, projectsCollection, projectMembersCollection } from "./mongodb";
import { User, WithStringId } from "./types/types";
import { z } from "zod";
import { ObjectId } from "mongodb";

export async function getDbUserForAuthUser(authUser: Claims): Promise<WithStringId<z.infer<typeof User>>> {
    let dbUser = await usersCollection.findOne({
        auth0Id: authUser.sub
    });
    // if user not found, create a new user
    if (!dbUser) {
        dbUser = {
            _id: new ObjectId(),
            auth0Id: authUser.sub,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await usersCollection.insertOne(dbUser);

        // since auth feature was rolled out later,
        // set all project authors to new user id instead
        // of user.sub
        await projectsCollection.updateMany({
            createdByUserId: authUser.sub
        }, {
            $set: {
                createdByUserId: dbUser._id.toString(),
                lastUpdatedAt: new Date().toISOString(),
            }
        });

        // update project memberships as well
        await projectMembersCollection.updateMany({
            userId: authUser.sub
        }, {
            $set: {
                userId: dbUser._id.toString(),
                lastUpdatedAt: new Date().toISOString(),
            }
        });
    }

    const { _id, ...rest } = dbUser;
    return {
        ...rest,
        _id: _id.toString(),
    };
}