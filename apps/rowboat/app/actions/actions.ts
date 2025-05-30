'use server';
import { AgenticAPIInitStreamResponse } from "../lib/types/agents_api_types";
import { AgenticAPIChatRequest } from "../lib/types/agents_api_types";
import { WebpageCrawlResponse } from "../lib/types/tool_types";
import { webpagesCollection } from "../lib/mongodb";
import { z } from 'zod';
import FirecrawlApp, { ScrapeResponse } from '@mendable/firecrawl-js';
import { getAgenticResponseStreamId } from "../lib/utils";
import { check_query_limit } from "../lib/rate_limiting";
import { QueryLimitError } from "../lib/client_utils";
import { projectAuthCheck } from "./project_actions";
import { authorizeUserAction } from "./billing_actions";

const crawler = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || '' });

export async function scrapeWebpage(url: string): Promise<z.infer<typeof WebpageCrawlResponse>> {
    const page = await webpagesCollection.findOne({
        "_id": url,
        lastUpdatedAt: {
            '$gte': new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 24 hours
        },
    });
    if (page) {
        // console.log("found webpage in db", url);
        return {
            title: page.title,
            content: page.contentSimple,
        };
    }

    // otherwise use firecrawl
    const scrapeResult = await crawler.scrapeUrl(
        url,
        {
            formats: ['markdown'],
            onlyMainContent: true
        }
    ) as ScrapeResponse;

    // save the webpage using upsert
    await webpagesCollection.updateOne(
        { _id: url },
        {
            $set: {
                title: scrapeResult.metadata?.title || '',
                contentSimple: scrapeResult.markdown || '',
                lastUpdatedAt: (new Date()).toISOString(),
            }
        },
        { upsert: true }
    );

    // console.log("crawled webpage", url);
    return {
        title: scrapeResult.metadata?.title || '',
        content: scrapeResult.markdown || '',
    };
}

export async function getAssistantResponseStreamId(request: z.infer<typeof AgenticAPIChatRequest>): Promise<z.infer<typeof AgenticAPIInitStreamResponse> | { billingError: string }> {
    await projectAuthCheck(request.projectId);
    if (!await check_query_limit(request.projectId)) {
        throw new QueryLimitError();
    }

    // Check billing authorization
    const { success, error } = await authorizeUserAction({
        type: 'agent_response',
        data: {},
    });
    if (!success) {
        return { billingError: error || 'Billing error' };
    }

    const response = await getAgenticResponseStreamId(request);
    return response;
}