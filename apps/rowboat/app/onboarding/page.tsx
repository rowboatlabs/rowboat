import { redirect } from "next/navigation";
import App from "./app";
import { requireAuth } from "../lib/auth";
import { USE_AUTH } from "../lib/feature_flags";

export const dynamic = 'force-dynamic';

export default async function Page() {
    if (!USE_AUTH) {
        redirect('/projects');
    }
    await requireAuth();
    return <App />;
}