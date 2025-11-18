import { Metadata } from "next";
import { App } from "./app";
import { USE_RAG, USE_RAG_UPLOADS, USE_RAG_S3_UPLOADS, USE_RAG_SCRAPING, USE_BILLING } from "@/app/lib/feature_flags";
import { notFound } from "next/navigation";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { container } from "@/di/container";
import { getEligibleModels } from "@/app/lib/billing";
import { ModelsResponse } from "@/app/lib/types/billing_types";
import { requireAuth } from "@/app/lib/auth";
import { IFetchProjectController } from "@/src/interface-adapters/controllers/projects/fetch-project.controller";
import { IListDataSourcesController } from "@/src/interface-adapters/controllers/data-sources/list-data-sources.controller";
import { IListScheduledJobRulesController } from "@/src/interface-adapters/controllers/scheduled-job-rules/list-scheduled-job-rules.controller";
import { IListRecurringJobRulesController } from "@/src/interface-adapters/controllers/recurring-job-rules/list-recurring-job-rules.controller";
import { IListComposioTriggerDeploymentsController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/list-composio-trigger-deployments.controller";
import { z } from "zod";
import { transformTriggersForCopilot, DEFAULT_TRIGGER_FETCH_LIMIT } from "./trigger-transform";

const fetchProjectController = container.resolve<IFetchProjectController>('fetchProjectController');
const listDataSourcesController = container.resolve<IListDataSourcesController>('listDataSourcesController');
const listScheduledJobRulesController = container.resolve<IListScheduledJobRulesController>('listScheduledJobRulesController');
const listRecurringJobRulesController = container.resolve<IListRecurringJobRulesController>('listRecurringJobRulesController');
const listComposioTriggerDeploymentsController = container.resolve<IListComposioTriggerDeploymentsController>('listComposioTriggerDeploymentsController');

const DEFAULT_MODEL = process.env.PROVIDER_DEFAULT_MODEL || "gpt-4.1";

export const metadata: Metadata = {
    title: "Workflow"
}

export default async function Page(
    props: {
        params: Promise<{ projectId: string }>;
    }
) {
    const params = await props.params;
    const user = await requireAuth();
    const customer = await requireActiveBillingSubscription();
    console.log('->>> workflow page being rendered');

    const project = await fetchProjectController.execute({
        caller: "user",
        userId: user.id,
        projectId: params.projectId,
    });
    if (!project) {
        notFound();
    }

    const [sources, scheduledTriggers, recurringTriggers, composioTriggers] = await Promise.all([
        listDataSourcesController.execute({
            caller: "user",
            userId: user.id,
            projectId: params.projectId,
        }),
        listScheduledJobRulesController.execute({
            caller: "user",
            userId: user.id,
            projectId: params.projectId,
            limit: DEFAULT_TRIGGER_FETCH_LIMIT,
        }),
        listRecurringJobRulesController.execute({
            caller: "user",
            userId: user.id,
            projectId: params.projectId,
            limit: DEFAULT_TRIGGER_FETCH_LIMIT,
        }),
        listComposioTriggerDeploymentsController.execute({
            caller: "user",
            userId: user.id,
            projectId: params.projectId,
            limit: DEFAULT_TRIGGER_FETCH_LIMIT,
        }),
    ]);

    let eligibleModels: z.infer<typeof ModelsResponse> | "*" = '*';
    if (USE_BILLING) {
        eligibleModels = await getEligibleModels(customer.id);
    }

    const triggers = transformTriggersForCopilot({
        scheduled: scheduledTriggers.items ?? [],
        recurring: recurringTriggers.items ?? [],
        composio: composioTriggers.items ?? [],
    });

    console.log('/workflow page.tsx serve');

    return (
        <App
            initialProjectData={project}
            initialDataSources={sources}
            initialTriggers={triggers}
            eligibleModels={eligibleModels}
            useRag={USE_RAG}
            useRagUploads={USE_RAG_UPLOADS}
            useRagS3Uploads={USE_RAG_S3_UPLOADS}
            useRagScraping={USE_RAG_SCRAPING}
            defaultModel={DEFAULT_MODEL}
            chatWidgetHost={process.env.CHAT_WIDGET_HOST || ''}
        />
    );
}
