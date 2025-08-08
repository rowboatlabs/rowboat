import { PrefixLogger } from "@/app/lib/utils";
import { container } from "@/di/container";
import { IHandleComposioWebhookRequestController } from "@/src/interface-adapters/controllers/composio/webhook/handle-composio-webhook-request.controller";
import { nanoid } from "nanoid";

const handleComposioWebhookRequestController = container.resolve<IHandleComposioWebhookRequestController>("handleComposioWebhookRequestController");

export async function POST(request: Request) {
    const id = nanoid();
    const logger = new PrefixLogger(`composio-webhook-[${id}]`);
    const payload = await request.text();
    const headers = Object.fromEntries(request.headers.entries());
    logger.log('received event', JSON.stringify(headers));

    // handle webhook
    try {
        await handleComposioWebhookRequestController.execute({
            headers,
            payload,
        });
    } catch (error) {
        logger.log('Error handling composio webhook', error);
    }

    return Response.json({
        success: true,
    });
}

/*
{
    "type": "slack_receive_message",
    "timestamp": "2025-08-06T01:49:46.008Z",
    "data": {
        "bot_id": null,
        "channel": "C08PTQKM2DS",
        "channel_type": "channel",
        "team_id": null,
        "text": "test",
        "ts": "1754444983.699449",
        "user": "U077XPW36V9",
        "connection_id": "551d86b3-44e3-4c62-b996-44648ccf77b3",
        "connection_nano_id": "ca_2n0cZnluJ1qc",
        "trigger_nano_id": "ti_dU7LJMfP5KSr",
        "trigger_id": "ec96b753-c745-4f37-b5d8-82a35ce0fa0b",
        "user_id": "987dbd2e-c455-4c8f-8d55-a997a2d7680a"
    }
}

{
    "type": "github_issue_added_event",
    "timestamp": "2025-08-06T02:00:13.680Z",
    "data": {
        "action": "opened",
        "createdAt": "2025-08-06T02:00:10Z",
        "createdBy": "ramnique",
        "description": "this is a test issue",
        "issue_id": 3294929549,
        "number": 1,
        "title": "test issue",
        "url": "https://github.com/ramnique/stack-reload-bug/issues/1",
        "connection_id": "06d7c6b9-bd41-4ce7-a6b4-b17a65315c99",
        "connection_nano_id": "ca_HmQ-SSOdxUEu",
        "trigger_nano_id": "ti_IjLPi4O0d4xo",
        "trigger_id": "ccbf3ad3-442b-491c-a1c5-e23f8b606592",
        "user_id": "987dbd2e-c455-4c8f-8d55-a997a2d7680a"
    }
}
*/