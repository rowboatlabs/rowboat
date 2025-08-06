import { TriggerEvent, Composio } from "@composio/core";

const composio = new Composio();
export async function POST(request: Request) {
    const json = await request.json();
    console.log('compsio webhook received', JSON.stringify(json));
    const triggerType = await composio.triggers.getType(json.type);
    console.log('triggerType', JSON.stringify(triggerType));
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
  
{
    "slug": "GITHUB_ISSUE_ADDED_EVENT",
    "name": "Issue Added Event",
    "description": "Triggered when a new issue is added to the repository.",
    "instructions": "This trigger fires every time a new issue is added to the repository.",
    "toolkit": {
      "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/github.png",
      "slug": "github",
      "name": "github"
    },
    "payload": {
      "properties": {
        "action": {
          "description": "The action that was performed on the issue",
          "examples": [
            "opened"
          ],
          "title": "Action",
          "type": "string"
        },
        "createdAt": {
          "description": "The timestamp when the issue was created",
          "examples": [
            "2021-04-14T02:15:15Z"
          ],
          "title": "Createdat",
          "type": "string"
        },
        "createdBy": {
          "description": "The GitHub username of the user who created the issue",
          "examples": [
            "octocat"
          ],
          "title": "Createdby",
          "type": "string"
        },
        "description": {
          "default": "",
          "description": "A detailed description of the issue",
          "examples": [
            "There is a bug in the code that needs to be fixed."
          ],
          "title": "Description",
          "type": "string"
        },
        "issue_id": {
          "description": "The unique ID assigned to the issue",
          "examples": [
            101
          ],
          "title": "Issue Id",
          "type": "integer"
        },
        "number": {
          "description": "The unique number assigned to the issue",
          "examples": [
            42
          ],
          "title": "Number",
          "type": "integer"
        },
        "title": {
          "description": "The title of the issue",
          "examples": [
            "Bug in code"
          ],
          "title": "Title",
          "type": "string"
        },
        "url": {
          "description": "The GitHub URL of the issue",
          "examples": [
            "https://github.com/octocat/Hello-World/issues/42"
          ],
          "title": "Url",
          "type": "string"
        }
      },
      "required": [
        "action",
        "issue_id",
        "number",
        "title",
        "createdBy",
        "createdAt",
        "url"
      ],
      "title": "IssueAddedPayloadSchema",
      "type": "object"
    },
    "config": {
      "properties": {
        "owner": {
          "description": "Owner of the repository",
          "title": "Owner",
          "type": "string"
        },
        "repo": {
          "description": "Repository name",
          "title": "Repo",
          "type": "string"
        }
      },
      "required": [
        "owner",
        "repo"
      ],
      "title": "WebhookConfigSchema",
      "type": "object"
    }
  }
 */ 