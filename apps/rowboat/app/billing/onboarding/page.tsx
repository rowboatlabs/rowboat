import { redirect } from "next/navigation";
import App from "./app";
import { USE_BILLING } from "@/app/lib/feature_flags";

export default async function Page() {
    if (!USE_BILLING) {
        redirect('/projects');
    }

    return <App />;
}