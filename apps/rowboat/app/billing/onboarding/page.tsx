import { redirect } from "next/navigation";
import App from "./app";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { getDbUserForAuthUser } from "@/app/lib/user";
import { getSession } from "@auth0/nextjs-auth0";

export default async function Page() {
    if (!USE_BILLING) {
        redirect('/projects');
    }

    // fetch auth0 user
    const { user } = await getSession() || {};
    if (!user) {
        throw new Error('User not authenticated');
    }

    // fetch db user
    const dbUser = await getDbUserForAuthUser(user);
    if (!dbUser) {
        throw new Error('User not found');
    }

    // redirect if user already has a billing customer id
    if (dbUser.billingCustomerId) {
        redirect('/billing');
    }

    return <App />;
}