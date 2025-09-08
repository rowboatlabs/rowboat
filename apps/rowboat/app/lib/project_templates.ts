import { WorkflowTemplate } from "./types/workflow_types";
import { z } from 'zod';

const DEFAULT_MODEL = process.env.PROVIDER_DEFAULT_MODEL || "gpt-4.1";

export const templates: { [key: string]: z.infer<typeof WorkflowTemplate> } = {
    // Default template
    'default': {
        name: 'Blank Template',
        description: 'A blank canvas to build your agents.',
        startAgent: "Example Agent",
        agents: [
            {
                name: "Example Agent",
                type: "conversation",
                description: "An example agent",
                instructions: "## 🧑‍ Role:\nYou are an helpful customer support assistant\n\n---\n## ⚙️ Steps to Follow:\n1. Ask the user what they would like help with\n2. Ask the user for their email address and let them know someone will contact them soon.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Asking the user their issue\n- Getting their email\n\n❌ Out of Scope:\n- Questions unrelated to customer support\n- If a question is out of scope, politely inform the user and avoid providing an answer.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- ask user their issue\n\n❌ Don'ts:\n- don't ask user any other detail than email",
                model: DEFAULT_MODEL,
                toggleAble: true,
                ragReturnType: "chunks",
                ragK: 3,
                controlType: "retain",
                outputVisibility: "user_facing",
            },
        ],
        prompts: [],
        tools: [],
    },

    "meeting-prep": {
        "name": "Meeting Prep",
        "description": "Pipeline that researches meeting attendees and sends the compiled summary to a specified Slack channel",
        "agents": [
            {
                "name": "Research Agent",
                "type": "pipeline",
                "description": "Internal agent that researches meeting attendees and returns a compiled summary.",
                "disabled": false,
                "instructions": "## Role\nYou are a pipeline agent that researches meeting attendees.\n\n---\n## Task\n1. You will receive attendee details from a previous step.\n2. For each attendee, you **must** research them **one at a time** using the [@tool:Search](#mention). Do NOT research the user `{{Exclude user}}`!\n3. After all searches are complete, compile the findings into a single, plain text summary.\n4. If no information is found for an attendee, state \"No public information found.\" for that person.\n5. Return **only** the final compiled summary.\n\n---\n## Constraint\nDo **NOT** interact with users or send messages. Your only output is the final summary text.",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "controlType": "relinquish_to_parent",
                "outputVisibility": "internal",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "Slack Send Agent",
                "type": "pipeline",
                "description": "Internal agent that sends the compiled research summary to a channel via Slack direct message and returns confirmation.",
                "disabled": false,
                "instructions": "## Role\nYou are a pipeline agent that sends a research summary to a Slack channel.\n\n---\n## Task\n1. You will receive a compiled text summary from the previous step.\n2. Use the [@tool:Send message](#mention) tool to post this summary, using these parameters:\n    * **channel**: `{{Slack Channel}}`\n    * **markdown_text**: Create a message starting with the subject \"*Meeting Attendee Research Summary*\", followed by the summary text you received.\n3. Your job is complete after sending the message.\n\n---\n## Constraint\nDo **NOT** perform any action other than sending the Slack message as instructed.\n\n---\n## Examples\n- **Parent agent** : <provides attendee research>\n - **Agent actions**: Call [@tool:Send message](#mention)\n - **Agent response**: Message sent to Slack channel.",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "controlType": "relinquish_to_parent",
                "outputVisibility": "internal",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "Attendee Research & Slack Pipeline Step 1",
                "type": "pipeline",
                "description": "",
                "disabled": false,
                "instructions": "",
                "model": "gpt-4o",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "controlType": "relinquish_to_parent",
                "outputVisibility": "internal",
                "maxCallsPerParentAgent": 3
            }
        ],
        "prompts": [
            {
                "name": "Slack Channel",
                "type": "base_prompt",
                "prompt": "<needs to be added>"
            },
            {
                "name": "Exclude user",
                "type": "base_prompt",
                "prompt": "<needs to be added>"
            }
        ],
        "tools": [
            {
                "name": "Search",
                "description": "Performs a web search and scrapes content from the top results.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query."
                        }
                    },
                    "required": [
                        "query"
                    ]
                },
                "mockTool": true,
                "isComposio": true,
                "composioData": {
                    "slug": "FIRECRWAL_SEARCH",
                    "noAuth": false,
                    "toolkitName": "firecrawl",
                    "toolkitSlug": "firecrawl",
                    "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/firecrawl.svg"
                }
            },
            {
                "name": "Send message",
                "description": "Posts a message to a slack channel, direct message, or private group; requires content via `text`, `blocks`, or `attachments`.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "as_user": {
                            "description": "Post as the authenticated user instead of as a bot. Defaults to `false`. If `true`, `username`, `icon_emoji`, and `icon_url` are ignored. If `false`, the message is posted as a bot, allowing appearance customization.",
                            "title": "As User",
                            "type": "boolean"
                        },
                        "attachments": {
                            "description": "URL-encoded JSON array of message attachments, a legacy method for rich content. See Slack API documentation for structure.",
                            "examples": [
                                "%5B%7B%22fallback%22%3A%20%22Required%20plain-text%20summary%20of%20the%20attachment.%22%2C%20%22color%22%3A%20%22%2336a64f%22%2C%20%22pretext%22%3A%20%22Optional%20text%20that%20appears%20above%20the%20attachment%20block%22%2C%20%22author_name%22%3A%20%22Bobby%20Tables%22%2C%20%22title%22%3A%20%22Slack%20API%20Documentation%22%2C%20%22title_link%22%3A%20%22https%3A%2F%2Fapi.slack.com%2F%22%2C%20%22text%22%3A%20%22Optional%20text%20that%20appears%20within%20the%20attachment%22%7D%5D"
                            ],
                            "title": "Attachments",
                            "type": "string"
                        },
                        "blocks": {
                            "description": "DEPRECATED: Use `markdown_text` field instead. URL-encoded JSON array of layout blocks for rich/interactive messages. See Slack API Block Kit docs for structure.",
                            "examples": [
                                "%5B%7B%22type%22%3A%20%22section%22%2C%20%22text%22%3A%20%7B%22type%22%3A%20%22mrkdwn%22%2C%20%22text%22%3A%20%22Hello%2C%20world%21%22%7D%7D%5D"
                            ],
                            "title": "Blocks",
                            "type": "string"
                        },
                        "channel": {
                            "description": "ID or name of the channel, private group, or IM channel to send the message to.",
                            "examples": [
                                "C1234567890",
                                "general"
                            ],
                            "title": "Channel",
                            "type": "string"
                        },
                        "icon_emoji": {
                            "description": "Emoji for bot's icon (e.g., ':robot_face:'). Overrides `icon_url`. Applies if `as_user` is `false`.",
                            "examples": [
                                ":tada:",
                                ":slack:"
                            ],
                            "title": "Icon Emoji",
                            "type": "string"
                        },
                        "icon_url": {
                            "description": "Image URL for bot's icon (must be HTTPS). Applies if `as_user` is `false`.",
                            "examples": [
                                "https://slack.com/img/icons/appDir_2019_01/Tonito64.png"
                            ],
                            "title": "Icon Url",
                            "type": "string"
                        },
                        "link_names": {
                            "description": "Automatically hyperlink channel names (e.g., #channel) and usernames (e.g., @user) in message text. Defaults to `false` for bot messages.",
                            "title": "Link Names",
                            "type": "boolean"
                        },
                        "markdown_text": {
                            "description": "PREFERRED: Write your message in markdown for nicely formatted display. Supports: headers (# ## ###), bold (**text** or __text__), italic (*text* or _text_), strikethrough (~~text~~), inline code (`code`), code blocks (```), links ([text](url)), block quotes (>), lists (- item, 1. item), dividers (--- or ***), context blocks (:::context with images), and section buttons (:::section-button). IMPORTANT: Use \\n for line breaks (e.g., 'Line 1\\nLine 2'), not actual newlines. USER MENTIONS: To tag users, use their user ID with <@USER_ID> format (e.g., <@U1234567890>), not username. ",
                            "examples": [
                                "# Status Update\\n\\nSystem is **running smoothly** with *excellent* performance.\\n\\n```bash\\nkubectl get pods\\n```\\n\\n> All services operational ✅",
                                "## Daily Report\\n\\n- **Deployments**: 5 successful\\n- *Issues*: 0 critical\\n- ~~Maintenance~~: **Completed**\\n\\n---\\n\\n**Next**: Monitor for 24h"
                            ],
                            "title": "Markdown Text",
                            "type": "string"
                        },
                        "mrkdwn": {
                            "description": "Disable Slack's markdown for `text` field if `false`. Default `true` (allows *bold*, _italic_, etc.).",
                            "title": "Mrkdwn",
                            "type": "boolean"
                        },
                        "parse": {
                            "description": "Message text parsing behavior. Default `none` (no special parsing). `full` parses as user-typed (links @mentions, #channels). See Slack API docs for details.",
                            "examples": [
                                "none",
                                "full"
                            ],
                            "title": "Parse",
                            "type": "string"
                        },
                        "reply_broadcast": {
                            "description": "If `true` for a threaded reply, also posts to main channel. Defaults to `false`.",
                            "title": "Reply Broadcast",
                            "type": "boolean"
                        },
                        "text": {
                            "description": "DEPRECATED: This sends raw text only, use markdown_text field. Primary textual content. Recommended fallback if using `blocks` or `attachments`. Supports mrkdwn unless `mrkdwn` is `false`.",
                            "examples": [
                                "Hello from your friendly bot!",
                                "Reminder: Team meeting at 3 PM today."
                            ],
                            "title": "Text",
                            "type": "string"
                        },
                        "thread_ts": {
                            "description": "Timestamp (`ts`) of an existing message to make this a threaded reply. Use `ts` of the parent message, not another reply. Example: '1476746824.000004'.",
                            "examples": [
                                "1618033790.001500"
                            ],
                            "title": "Thread Ts",
                            "type": "string"
                        },
                        "unfurl_links": {
                            "description": "Enable unfurling of text-based URLs. Defaults `false` for bots, `true` if `as_user` is `true`.",
                            "title": "Unfurl Links",
                            "type": "boolean"
                        },
                        "unfurl_media": {
                            "description": "Disable unfurling of media content from URLs if `false`. Defaults to `true`.",
                            "title": "Unfurl Media",
                            "type": "boolean"
                        },
                        "username": {
                            "description": "Bot's name in Slack (max 80 chars). Applies if `as_user` is `false`.",
                            "examples": [
                                "MyBot",
                                "AlertBot"
                            ],
                            "title": "Username",
                            "type": "string"
                        }
                    },
                    "required": [
                        "channel"
                    ]
                },
                "mockTool": true,
                "isComposio": true,
                "composioData": {
                    "slug": "SLACK_SEND_MESSAGE",
                    "noAuth": false,
                    "toolkitName": "slack",
                    "toolkitSlug": "slack",
                    "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/slack.svg"
                }
            }
        ],
        "pipelines": [
            {
                "name": "Attendee Research & Slack Pipeline",
                "description": "Pipeline that researches meeting attendees and sends the compiled summary to a specified Slack channel.",
                "agents": [
                    "Research Agent",
                    "Slack Send Agent"
                ]
            }
        ],
        "startAgent": "Attendee Research & Slack Pipeline"
    },

    "interview-scheduler": {
        "name": "Interview Scheduler",
        "description": "Orchestrates interview scheduling with candidates from a Google Sheet and handles calendar RSVPs",
        "agents": [
            {
                "name": "Recruitment HR Bot",
                "type": "conversation",
                "description": "Hub agent to orchestrate interview scheduling with candidates from a Google Sheet.",
                "instructions": "## 🧑‍💼 Role:\nYou are the Recruitment HR Bot, responsible for orchestrating the process of scheduling interviews with candidates from a Google Sheet and updating their status, or handling calendar event RSVPs.\n\n---\n## ⚙️ Steps to Follow:\n1. Greet the user.\n2. **IF** the input is a calendar event RSVP (e.g., 'accepted', 'declined') and contains the candidate's email, Google Sheet ID, sheet name, and status column:\n   - Directly call [@agent:Calendar Response Handler](#mention) with the candidate's email, the RSVP response, the Google Sheet ID, the sheet name, and the status column.\n   - Inform the user that the calendar response has been processed.\n3. **ELSE** (if it's not a calendar event RSVP or missing details for it):\n   - Check if the 'google sheet id' and 'Sheet range' prompts are available. If so, use their values. Otherwise, ask the user for the Google Sheet ID and the range containing candidate names and emails (e.g., 'Sheet1!A2:B').\n   - Check if the 'interview start date and time' and 'Status column' prompts are available. If so, use their values. Otherwise, ask for the desired start date and time for interviews (e.g., 'YYYY-MM-DDTHH:MM:SS'), the duration of the interview in minutes, and the sheet name and column (e.g., 'Sheet1!C') where the interview status should be updated.\n   - Once all necessary information is collected, call [@pipeline:Interview Scheduling Pipeline](#mention) with the collected details.\n   - Inform the user when the interview scheduling process is complete.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Orchestrating the workflow for fetching candidates, scheduling interviews, and updating sheet status.\n- Handling calendar event RSVPs and updating sheet status accordingly.\n\n❌ Out of Scope:\n- Directly fetching candidate data, scheduling interviews, or updating sheet status (handled by pipeline agents).\n- Directly processing calendar responses (handled by Calendar Response Handler).\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- Prioritize handling calendar event RSVPs if the necessary information is present.\n- Always confirm all necessary details (Sheet ID, ranges, interview time, duration, status column) with the user before initiating the pipeline for interview scheduling.\n- Ensure all steps are completed in sequence.\n- If inputs are already in the context, directly use them instead of asking or confirming with the user.\n\n🚫 Don'ts:\n- Do not perform data fetching, scheduling, or status updates directly.\n- Do not skip any step in the workflow.\n- Do not mention internal agent names to the user.\n- Do not say 'connecting you to another agent'.\n- CRITICAL: Only transfer to one agent at a time and wait for its response before proceeding.\n\n---\n## 📥 Inputs:\n- **Google Sheet ID**: The unique identifier of the Google Spreadsheet containing candidate data. (e.g., '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')\n- **Sheet Range**: The range in A1 notation (e.g., 'Sheet1!A2:B') containing candidate names and emails.\n- **Interview Start Date and Time**: The desired start date and time for interviews in 'YYYY-MM-DDTHH:MM:SS' format. Default: '2025-08-26T09:00:00'\n- **Interview Duration**: The duration of the interview in minutes. Default: 30\n- **Status Column**: The sheet name and column (e.g., 'Sheet1!C') where the interview status should be updated.\n\n---\n## Examples:\n- **User** : I want to schedule interviews for candidates from a Google Sheet.\n - **Agent response**: Sure! Please provide the desired start date and time for interviews (e.g., 'YYYY-MM-DDTHH:MM:SS'), the duration of the interview in minutes, and the sheet name and column (e.g., 'Sheet1!C') where the interview status should be updated.\n\n- **User** : Start Time: 2024-09-01T10:00:00, Duration: 30, Status Column: Sheet1!C\n - **Agent actions**: Call [@pipeline:Interview Scheduling Pipeline](#mention)\n\n- **Agent receives pipeline completion** :\n - **Agent response**: The interview scheduling process is complete.\n\n- **User** : Candidate [candidate_email] has accepted the interview. Sheet ID: [sheet_id], Sheet Name: [sheet_name], Status Column: [status_column]\n - **Agent actions**: Call [@agent:Calendar Response Handler](#mention)\n\n- **Agent receives Calendar Response Handler completion** :\n - **Agent response**: The calendar response has been processed and the sheet updated.",
                "model": "google/gemini-2.5-flash",
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "user_facing",
                "controlType": "retain"
            },
            {
                "name": "Pipeline Step 1 - Fetch Candidates",
                "type": "pipeline",
                "description": "Reads candidate names and emails from a specified Google Sheet range.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nFetch candidate names and emails from the provided Google Sheet and ranges.\n\n---\n## ⚙️ Steps to Follow:\n1. Use [@tool:Batch get spreadsheet](#mention) with the given spreadsheet_id and ranges (e.g., 'Sheet1!A2:B').\n2. Return a normalized array of { name, email } objects.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Fetching rows from Google Sheets and returning structured data.\n\n❌ Out of Scope:\n- Scheduling interviews or updating sheet status.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- Validate rows and skip empties.\n🚫 Don'ts:\n- Do not schedule interviews or update sheet status.",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "Pipeline Step 2 - Schedule Interview",
                "type": "pipeline",
                "description": "Schedules an interview for each candidate using Google Calendar.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nSchedule an interview for each candidate.\n\n---\n## ⚙️ Steps to Follow:\n1. Receive a list of { name, email } objects from the previous step.\n2. For each candidate, use [@tool:Create Event](#mention) to schedule an interview. The event summary should be 'Interview with [Candidate Name]', and the attendee should be the candidate's email. You will need to ask the user for the start_datetime and duration of the interview.\n3. Return a list of { candidate_email, status: 'scheduled' } for each successfully scheduled interview.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Scheduling interviews on Google Calendar.\n\n❌ Out of Scope:\n- Fetching candidate data or updating sheet status.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- Ensure all required fields for event creation are provided.\n🚫 Don'ts:\n- Do not fetch candidate data or update sheet status.",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "Pipeline Step 3 - Update Sheet Status",
                "type": "pipeline",
                "description": "Updates the status column in the Google Sheet to 'interview scheduled' for each candidate.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nUpdate the status column in the Google Sheet for scheduled interviews.\n\n---\n## ⚙️ Steps to Follow:\n1. Receive a list of { candidate_email, status: 'scheduled' } objects from the previous step.\n2. For each candidate, use [@tool:Batch update spreadsheet](#mention) to update the corresponding row in the Google Sheet. You will need to ask the user for the spreadsheet_id, sheet_name, and the column where the status needs to be updated.\n3. The value to be updated should be 'invite sent'.\n4. Return a confirmation of the updates.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Updating the status column in the Google Sheet.\n\n❌ Out of Scope:\n- Fetching candidate data or scheduling interviews.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- Ensure the correct row and column are updated.\n🚫 Don'ts:\n- Do not fetch candidate data or schedule interviews.",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "Interview Scheduling Pipeline Step 1",
                "type": "pipeline",
                "description": "",
                "disabled": false,
                "instructions": "",
                "model": "gpt-4o",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "Calendar Response Handler",
                "type": "conversation",
                "description": "Handles calendar accept/reject responses and updates the Google Sheet status accordingly.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nProcess calendar responses (accept/reject) and update the Google Sheet with the appropriate interview status.\n\n---\n## ⚙️ Steps to Follow:\n1. Receive the candidate's email, the calendar response (e.g., 'accepted', 'declined'), the Google Sheet ID, the sheet name, and the column where the status needs to be updated.\n2. If the response is 'accepted', set the status to 'interview scheduled'.\n3. If the response is 'declined', set the status to 'declined'.\n4. Use [@tool:Batch update spreadsheet](#mention) to update the corresponding row in the Google Sheet with the determined status.\n5. Return a confirmation of the update.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Interpreting calendar responses and updating the Google Sheet status.\n\n❌ Out of Scope:\n- Scheduling interviews or fetching candidate data.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- Accurately map calendar responses to interview statuses.\n- Ensure the correct row and column are updated in the Google Sheet.\n🚫 Don'ts:\n- Do not interact with the user directly.\n- Do not schedule interviews.",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            }
        ],
        "prompts": [
            {
                "name": "google sheet id",
                "type": "base_prompt",
                "prompt": "<needs to be added>"
            },
            {
                "name": "Sheet range",
                "type": "base_prompt",
                "prompt": "<needs to be added>"
            },
            {
                "name": "interview start date and time",
                "type": "base_prompt",
                "prompt": "<needs to be added>"
            },
            {
                "name": "Status column",
                "type": "base_prompt",
                "prompt": "<needs to be added>"
            }
        ],
        "tools": [
            {
                "name": "Batch get spreadsheet",
                "description": "Retrieves data from specified cell ranges in a google spreadsheet; ensure the spreadsheet has at least one worksheet and any explicitly referenced sheet names in ranges exist.",
                "mockTool": false,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "ranges": {
                            "description": "A list of cell ranges in A1 notation (e.g., 'Sheet1!A1:B2', 'A1:C5') from which to retrieve data. If this list is omitted or empty, all data from the first sheet of the spreadsheet will be fetched. A range can specify a sheet name (e.g., 'Sheet2!A:A'); if no sheet name is provided in a range string (e.g., 'A1:B2'), it defaults to the first sheet.",
                            "examples": [
                                "Sheet1!A1:B2",
                                "Sheet1!A:A",
                                "Sheet1!1:2",
                                "Sheet1!A5:A",
                                "A1:B2"
                            ],
                            "items": {
                                "type": "string"
                            },
                            "title": "Ranges",
                            "type": "array"
                        },
                        "spreadsheet_id": {
                            "description": "The unique identifier of the Google Spreadsheet from which data will be retrieved.",
                            "title": "Spreadsheet Id",
                            "type": "string"
                        }
                    },
                    "required": [
                        "spreadsheet_id"
                    ]
                },
                "isComposio": true,
                "composioData": {
                    "slug": "GOOGLESHEETS_BATCH_GET",
                    "noAuth": false,
                    "toolkitName": "googlesheets",
                    "toolkitSlug": "googlesheets",
                    "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/google-sheets.svg"
                }
            },
            {
                "name": "Create Event",
                "description": "Creates an event on a google calendar, needing rfc3339 utc start/end times (end after start) and write access to the calendar. by default, adds the organizer as an attendee unless exclude organizer is set to true.",
                "mockTool": false,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "attendees": {
                            "default": null,
                            "description": "List of attendee emails (strings).",
                            "items": {
                                "type": "string"
                            },
                            "nullable": true,
                            "title": "Attendees",
                            "type": "array"
                        },
                        "calendar_id": {
                            "default": "primary",
                            "description": "Target calendar: 'primary' for the user's main calendar, or the calendar's email address.",
                            "examples": [
                                "primary",
                                "user@example.com",
                                "abcdefghijklmnopqrstuvwxyz@group.calendar.google.com"
                            ],
                            "title": "Calendar Id",
                            "type": "string"
                        },
                        "create_meeting_room": {
                            "default": null,
                            "description": "If true, a Google Meet link is created and added to the event. CRITICAL: As of 2024, this REQUIRES a paid Google Workspace account ($13+/month). Personal Gmail accounts will fail with 'Invalid conference type value' error. Solutions: 1) Upgrade to Workspace, 2) Use domain-wide delegation with Workspace user, 3) Use the new Google Meet REST API, or 4) Create events without conferences. See https://github.com/googleapis/google-api-nodejs-client/issues/3234",
                            "nullable": true,
                            "title": "Create Meeting Room",
                            "type": "boolean"
                        },
                        "description": {
                            "default": null,
                            "description": "Description of the event. Can contain HTML. Optional.",
                            "nullable": true,
                            "title": "Description",
                            "type": "string"
                        },
                        "eventType": {
                            "default": "default",
                            "description": "Type of the event, immutable post-creation. Currently, only 'default' and 'workingLocation' can be created.",
                            "enum": [
                                "default",
                                "outOfOffice",
                                "focusTime",
                                "workingLocation"
                            ],
                            "title": "Event Type",
                            "type": "string"
                        },
                        "event_duration_hour": {
                            "default": 0,
                            "description": "Number of hours (0-24). Increase by 1 here rather than passing 60 in `event_duration_minutes`",
                            "maximum": 24,
                            "minimum": 0,
                            "title": "Event Duration Hour",
                            "type": "integer"
                        },
                        "event_duration_minutes": {
                            "default": 30,
                            "description": "Duration in minutes (0-59 ONLY). NEVER use 60+ minutes - use event_duration_hour=1 instead. Maximum value is 59.",
                            "maximum": 59,
                            "minimum": 0,
                            "title": "Event Duration Minutes",
                            "type": "integer"
                        },
                        "exclude_organizer": {
                            "default": false,
                            "description": "If True, the organizer will NOT be added as an attendee. Default is False (organizer is included).",
                            "title": "Exclude Organizer",
                            "type": "boolean"
                        },
                        "guestsCanInviteOthers": {
                            "default": null,
                            "description": "Whether attendees other than the organizer can invite others to the event.",
                            "nullable": true,
                            "title": "Guests Can Invite Others",
                            "type": "boolean"
                        },
                        "guestsCanSeeOtherGuests": {
                            "default": null,
                            "description": "Whether attendees other than the organizer can see who the event's attendees are.",
                            "nullable": true,
                            "title": "Guests Can See Other Guests",
                            "type": "boolean"
                        },
                        "guests_can_modify": {
                            "default": false,
                            "description": "If True, guests can modify the event.",
                            "title": "Guests Can Modify",
                            "type": "boolean"
                        },
                        "location": {
                            "default": null,
                            "description": "Geographic location of the event as free-form text.",
                            "nullable": true,
                            "title": "Location",
                            "type": "string"
                        },
                        "recurrence": {
                            "default": null,
                            "description": "List of RRULE, EXRULE, RDATE, EXDATE lines for recurring events. Supported frequencies are DAILY, WEEKLY, MONTHLY, YEARLY.",
                            "items": {
                                "type": "string"
                            },
                            "nullable": true,
                            "title": "Recurrence",
                            "type": "array"
                        },
                        "send_updates": {
                            "default": null,
                            "description": "Defaults to True. Whether to send updates to the attendees.",
                            "nullable": true,
                            "title": "Send Updates",
                            "type": "boolean"
                        },
                        "start_datetime": {
                            "description": "Naive date/time (YYYY-MM-DDTHH:MM:SS) with NO offsets or Z. e.g. '2025-01-16T13:00:00'",
                            "title": "Start Datetime",
                            "type": "string"
                        },
                        "summary": {
                            "default": null,
                            "description": "Summary (title) of the event.",
                            "nullable": true,
                            "title": "Summary",
                            "type": "string"
                        },
                        "timezone": {
                            "default": null,
                            "description": "IANA timezone name (e.g., 'America/New_York'). Required if datetime is naive. If datetime includes timezone info (Z or offset), this field is optional and defaults to UTC.",
                            "nullable": true,
                            "title": "Timezone",
                            "type": "string"
                        },
                        "transparency": {
                            "default": "opaque",
                            "description": "'opaque' (busy) or 'transparent' (available).",
                            "enum": [
                                "opaque",
                                "transparent"
                            ],
                            "title": "Transparency",
                            "type": "string"
                        },
                        "visibility": {
                            "default": "default",
                            "description": "Event visibility: 'default', 'public', 'private', or 'confidential'.",
                            "enum": [
                                "default",
                                "public",
                                "private",
                                "confidential"
                            ],
                            "title": "Visibility",
                            "type": "string"
                        }
                    },
                    "required": [
                        "start_datetime"
                    ]
                },
                "isComposio": true,
                "composioData": {
                    "slug": "GOOGLECALENDAR_CREATE_EVENT",
                    "noAuth": false,
                    "toolkitName": "googlecalendar",
                    "toolkitSlug": "googlecalendar",
                    "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/google-calendar.svg"
                }
            },
            {
                "name": "Batch update spreadsheet",
                "description": "Updates a specified range in a google sheet with given values, or appends them as new rows if `first cell location` is omitted; ensure the target sheet exists and the spreadsheet contains at least one worksheet.",
                "mockTool": false,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "first_cell_location": {
                            "description": "The starting cell for the update range, specified in A1 notation (e.g., 'A1', 'B2'). The update will extend from this cell to the right and down, based on the provided values. If omitted, values are appended to the sheet.",
                            "examples": [
                                "A1",
                                "D3"
                            ],
                            "title": "First Cell Location",
                            "type": "string"
                        },
                        "includeValuesInResponse": {
                            "default": false,
                            "description": "If set to True, the response will include the updated values from the spreadsheet.",
                            "examples": [
                                true,
                                false
                            ],
                            "title": "Include Values In Response",
                            "type": "boolean"
                        },
                        "sheet_name": {
                            "description": "The name of the specific sheet within the spreadsheet to update.",
                            "examples": [
                                "Sheet1"
                            ],
                            "title": "Sheet Name",
                            "type": "string"
                        },
                        "spreadsheet_id": {
                            "description": "The unique identifier of the Google Sheets spreadsheet to be updated.",
                            "examples": [
                                "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                            ],
                            "title": "Spreadsheet Id",
                            "type": "string"
                        },
                        "valueInputOption": {
                            "default": "USER_ENTERED",
                            "description": "How input data is interpreted. 'USER_ENTERED': Values parsed as if typed by a user (e.g., strings may become numbers/dates, formulas are calculated); recommended for formulas. 'RAW': Values stored as-is without parsing (e.g., '123' stays string, '=SUM(A1:B1)' stays string).",
                            "enum": [
                                "RAW",
                                "USER_ENTERED"
                            ],
                            "examples": [
                                "USER_ENTERED",
                                "RAW"
                            ],
                            "title": "Value Input Option",
                            "type": "string"
                        },
                        "values": {
                            "description": "A 2D list of cell values. Each inner list represents a row. Values can be strings, numbers, or booleans. Ensure columns are properly aligned across rows.",
                            "examples": [
                                [
                                    "Item",
                                    "Cost",
                                    "Stocked",
                                    "Ship Date"
                                ],
                                [
                                    "Wheel",
                                    20.5,
                                    true,
                                    "2020-06-01"
                                ],
                                [
                                    "Screw",
                                    0.5,
                                    true,
                                    "2020-06-03"
                                ],
                                [
                                    "Nut",
                                    0.25,
                                    false,
                                    "2020-06-02"
                                ]
                            ],
                            "items": {
                                "items": {
                                    "anyOf": [
                                        {
                                            "type": "string"
                                        },
                                        {
                                            "type": "integer"
                                        },
                                        {
                                            "type": "number"
                                        },
                                        {
                                            "type": "boolean"
                                        }
                                    ]
                                },
                                "type": "array"
                            },
                            "title": "Values",
                            "type": "array"
                        }
                    },
                    "required": [
                        "spreadsheet_id",
                        "sheet_name",
                        "values"
                    ]
                },
                "isComposio": true,
                "composioData": {
                    "slug": "GOOGLESHEETS_BATCH_UPDATE",
                    "noAuth": false,
                    "toolkitName": "googlesheets",
                    "toolkitSlug": "googlesheets",
                    "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/google-sheets.svg"
                }
            }
        ],
        "pipelines": [
            {
                "name": "Interview Scheduling Pipeline",
                "description": "Automates interview scheduling: fetches candidates from Google Sheet, schedules interviews, and updates sheet status.",
                "agents": [
                    "Pipeline Step 1 - Fetch Candidates",
                    "Pipeline Step 2 - Schedule Interview",
                    "Pipeline Step 3 - Update Sheet Status"
                ]
            }
        ],
        "startAgent": "Recruitment HR Bot"
    },

    "github-data-to-spreadsheet": {
        "name": "Add GitHub Stats to Google Sheets",
        "description": "Fetches GitHub repository stats and logs them to a Google Sheet with Slack notifications",
        "agents": [
            {
                "name": "GitHub Stats Hub",
                "type": "conversation",
                "description": "Hub agent that orchestrates fetching GitHub stats for rowboatlabs/rowboat and logging them to a Google Sheet.",
                "instructions": "## 🧑‍💼 Role:\nYou are the hub agent responsible for orchestrating the process of fetching GitHub repository stats for 'rowboatlabs/rowboat' and logging them to a Google Sheet.\n\n---\n## ⚙️ Steps to Follow:\n1. Receive a user request to log GitHub stats.\n2. FIRST: Call [@agent:GitHub Stats Agent](#mention) and always provide repository owner: 'rowboatlabs' and repo: 'rowboat' as input (do not prompt the user for these values).\n3. Wait for the stats to be returned.\n4. THEN: Call [@agent:GitHub Stats to Sheet Agent](#mention) to append the stats to the Google Sheet.\n5. Wait for confirmation from the Sheets agent.\n6. Inform the user that the data has been logged, or report any error if one occurred.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Orchestrating the sequential workflow: fetch stats for rowboatlabs/rowboat, then log to sheet, then inform the user.\n\n❌ Out of Scope:\n- Fetching stats or logging to the sheet directly (handled by sub-agents).\n- Handling requests unrelated to GitHub stats logging.\n- Accepting or prompting for other repositories.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- Always use 'rowboatlabs' as owner and 'rowboat' as repo when calling the GitHub Stats Agent.\n- Always follow the sequence: GitHub Stats Agent first, then GitHub Stats to Sheet Agent.\n- Wait for each agent's complete response before proceeding.\n- Only interact with the user for the initial request and final confirmation.\n\n🚫 Don'ts:\n- Do not perform stats fetching or sheet logging yourself.\n- Do not try to call both agents at once.\n- Do not reference internal agent names to the user.\n- Do not prompt the user for a repository or accept any other repository.\n- CRITICAL: The system does not support more than 1 tool call in a single output when the tool call is about transferring to another agent (a handoff). You must only put out 1 transfer related tool call in one output.\n\n# Examples\n- **User** : Fetch and store stats\n - **Agent actions**: Call [@agent:GitHub Stats Agent](#mention) with owner: 'rowboatlabs', repo: 'rowboat'\n\n- **Agent receives stats** :\n - **Agent actions**: Call [@agent:GitHub Stats to Sheet Agent](#mention)\n\n- **Agent receives sheet confirmation** :\n - **Agent response**: GitHub stats have been logged to the sheet successfully.\n\n- **Agent receives error from sheet agent** :\n - **Agent response**: There was an error logging the stats to the sheet: [error details]\n\n- **User** : Add a dummy row\n - **Agent response**: Sorry, I can only log actual GitHub stats. Please use the workflow to log real data.",
                "model": "google/gemini-2.5-flash",
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "user_facing",
                "controlType": "retain"
            },
            {
                "name": "GitHub Stats Agent",
                "type": "conversation",
                "description": "Fetches GitHub page view and clone statistics for rowboatlabs/rowboat for the previous day.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nYou are an internal agent that fetches GitHub page view and clone statistics for the repository for the previous day.\n\n---\n## ⚙️ Steps to Follow:\n1. Always use owner: <take from context> and repo: <take from context> (do not expect or prompt for these values from the parent agent).\n2. Use [@tool:Get page views](#mention) with per: 'day' to fetch daily page view stats. You must actually call this tool.\n3. Use [@tool:Get repository clones](#mention) with per: 'day' to fetch daily clone stats. You must actually call this tool.\n4. Filter both results to only include data for the previous day (relative to today, in UTC).\n5. Return both sets of stats (page views and clones for the previous day) to the parent agent.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Fetching and returning GitHub page view and clone stats for 'rowboatlabs/rowboat' for the previous day.\n\n❌ Out of Scope:\n- Answering user questions directly.\n- Modifying repository data.\n- Accepting or prompting for any other repository.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- Return only the stats for the previous day.\n- Return both page views and clone stats in a clear, structured format.\n- **Do not simulate or describe tool calls—always actually call the tools.**\n\n🚫 Don'ts:\n- Do not interact with the user directly.\n- Do not perform any actions other than fetching and returning stats.\n- Do not prompt for or accept any repository input.\n\n# Examples\n- **Parent agent** : Fetch and store stats\n - **Agent actions**: Call [@tool:Get page views](#mention) with owner, repo, per: 'day'. Then call [@tool:Get repository clones](#mention) with owner, repo: 'rowboat', per: 'day'.\n - **Agent response**: [Page views and clone stats for owner/repo for the previous day]\n\n\n\n",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "GitHub Stats to Sheet Agent",
                "type": "conversation",
                "description": "Appends the latest GitHub clone and view stats as a new row to a specified Google Sheet.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nYou are an internal agent that receives GitHub stats (clones and views), extracts the most recent date for each, and appends a row to a Google Sheet with the specified columns.\n\n---\n## ⚙️ Steps to Follow:\n1. Receive GitHub stats data (including arrays of daily clone and view stats, each with date, count, and uniques).\n2. Identify the most recent (latest) date in the clones array and extract its count and uniques.\n3. Identify the most recent (latest) date in the views array and extract its count and uniques.\n4. Use the current UTC date (YYYY-MM-DD) as the run date.\n5. Prepare a row with the following columns (in order):\n   - run date (current UTC date, YYYY-MM-DD)\n   - latest clones stats date (YYYY-MM-DD)\n   - clones (count)\n   - unique clones\n   - latest view stats date (YYYY-MM-DD)\n   - views (count)\n   - unique views\n6. Use [@tool:Append Values to Spreadsheet](#mention) to append this row to the end of the sheet (no headers).\n   - spreadsheetId: <take from context>\n   - range: <take from context> (or the correct sheet name if specified)\n   - valueInputOption: USER_ENTERED\n   - values: [[run date, latest clones stats date, clones, unique clones, latest view stats date, views, unique views]]\n7. Return a confirmation or error message to the parent agent.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Appending a single row of stats to the specified Google Sheet.\n\n❌ Out of Scope:\n- Adding headers or modifying existing data.\n- Interacting with the user directly.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- Only use the most recent date for each stat type.\n- Ensure the row is appended at the end (no headers).\n- Use the correct spreadsheetId and valueInputOption.\n\n🚫 Don'ts:\n- Do not add column headers.\n- Do not overwrite existing data.\n- Do not interact with the user directly.\n\n# Examples\n- **Parent agent** : Insert latest GitHub stats into sheet\n - **Agent actions**: Call [@tool:Append Values to Spreadsheet](#mention) with the latest stats and current date\n - **Agent response**: Row appended confirmation or error message\n\n- **Parent agent** : Insert stats with missing data\n - **Agent actions**: If either clones or views data is missing, append available data and leave missing fields blank\n - **Agent response**: Row appended confirmation or error message\n\n- **Parent agent** : Insert stats for a different repo\n - **Agent actions**: Same as above, using provided stats\n - **Agent response**: Row appended confirmation or error message\n\n- **Parent agent** : Insert stats with only views data\n - **Agent actions**: Append row with views data, leave clone fields blank\n - **Agent response**: Row appended confirmation or error message\n\n- **Parent agent** : Insert stats with only clones data\n - **Agent actions**: Append row with clone data, leave view fields blank\n - **Agent response**: Row appended confirmation or error message\n",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "Pipeline Step 1 - Fetch Views Data",
                "type": "pipeline",
                "description": "Fetches daily page view stats for rowboatlabs/rowboat using the Get page views tool.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nFetch daily page view stats for the repository 'rowboatlabs/rowboat'.\n\n---\n## ⚙️ Steps to Follow:\n1. Use [@tool:Get page views](#mention) with owner: 'rowboatlabs', repo: 'rowboat', per: 'day'.\n2. Return the full result to the next pipeline step.\n\n---\n## 📋 Guidelines:\n- Do not prompt for repository details; always use the specified owner and repo.\n- Do not interact with the user or other agents.",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "Pipeline Step 2 - Fetch Clones Data",
                "type": "pipeline",
                "description": "Fetches daily clone stats for rowboatlabs/rowboat using the Get repository clones tool.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nFetch daily clone stats for the repository 'rowboatlabs/rowboat'.\n\n---\n## ⚙️ Steps to Follow:\n1. Use [@tool:Get repository clones](#mention) with owner: 'rowboatlabs', repo: 'rowboat', per: 'day'.\n2. Return the full result to the next pipeline step, along with the previous step's page views data.\n\n---\n## 📋 Guidelines:\n- Do not prompt for repository details; always use the specified owner and repo.\n- Do not interact with the user or other agents.",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "Pipeline Step 3 - Add Data to Sheet",
                "type": "pipeline",
                "description": "Appends the latest GitHub clone and view stats as a new row to the specified Google Sheet.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nAppend the latest GitHub stats (clones and views) as a new row to the Google Sheet.\n\n---\n## ⚙️ Steps to Follow:\n1. Receive both page views and clone stats (arrays of daily stats, each with date, count, uniques).\n2. Identify the most recent (latest) date in the clones array and extract its count and uniques.\n3. Identify the most recent (latest) date in the views array and extract its count and uniques.\n4. Use the current UTC date (YYYY-MM-DD) as the run date.\n5. Prepare a row with the following columns (in order):\n   - run date (current UTC date, YYYY-MM-DD)\n   - latest clones stats date (YYYY-MM-DD)\n   - clones (count)\n   - unique clones\n   - latest view stats date (YYYY-MM-DD)\n   - views (count)\n   - unique views\n6. Use [@tool:Append Values to Spreadsheet](#mention) to append this row to the end of the sheet (no headers).\n   - spreadsheetId: <take from context>\n   - range: <take from context>\n   - valueInputOption: USER_ENTERED\n   - values: [[run date, latest clones stats date, clones, unique clones, latest view stats date, views, unique views]]\n7. Return the appended row and all relevant stats to the next pipeline step.\n\n---\n## 📋 Guidelines:\n- Only use the most recent date for each stat type.\n- Ensure the row is appended at the end (no headers).\n- Use the correct spreadsheetId and valueInputOption.\n- Do not interact with the user or other agents.\n\n",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "Pipeline Step 4 - Send Slack Summary",
                "type": "pipeline",
                "description": "Sends a summary message to the #stats Slack channel, including a link to the updated sheet.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nSend a summary message to the #stats Slack channel after stats are logged to the sheet.\n\n---\n## ⚙️ Steps to Follow:\n1. Receive the appended row and all relevant stats from the previous step.\n2. Compose a message summarizing the latest GitHub stats update, including:\n   - The run date\n   - The latest clones and views stats (date, count, uniques)\n   - A statement that the data has been updated in the sheet\n   - A link to the sheet: <take from context>\n3. Use [@tool:Send a message to a Slack channel](#mention) to post the message to channel: stats\n4. Return a confirmation or error message.\n\n---\n## 📋 Guidelines:\n- The message should be clear, concise, and include the sheet link.\n- Do not interact with the user or other agents.\n",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "GitHub Stats Logging Pipeline Step 1",
                "type": "pipeline",
                "description": "",
                "disabled": false,
                "instructions": "",
                "model": "gpt-4o",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "internal",
                "controlType": "relinquish_to_parent",
                "maxCallsPerParentAgent": 3
            },
            {
                "name": "GitHub Stats Pipeline Hub",
                "type": "conversation",
                "description": "User-facing hub that triggers the GitHub Stats Logging Pipeline and reports when complete.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nYou are the hub agent responsible for triggering the GitHub Stats Logging Pipeline.\n\n---\n## ⚙️ Steps to Follow:\n1. When the user requests a stats update, call [@pipeline:GitHub Stats Logging Pipeline](#mention).\n2. Wait for the pipeline to complete.\n3. Inform the user that the stats have been logged, the sheet updated, and the Slack channel notified.\n\n---\n## 📋 Guidelines:\n- Do not perform any stats fetching, sheet logging, or Slack messaging yourself.\n- Do not reference internal agent or pipeline names to the user.\n- Only interact with the user for the initial request and final confirmation.",
                "model": "google/gemini-2.5-flash",
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "outputVisibility": "user_facing",
                "controlType": "retain",
                "maxCallsPerParentAgent": 3
            }
        ],
        "prompts": [
            {
                "name": "spreadsheetId",
                "type": "base_prompt",
                "prompt": "<needs to be added>"
            },
            {
                "name": "range",
                "type": "base_prompt",
                "prompt": "<needs to be added>"
            },
            {
                "name": "sheet_link",
                "type": "base_prompt",
                "prompt": "<needs to be added>"
            },
            {
                "name": "Owner",
                "type": "base_prompt",
                "prompt": "<needs to be added>"
            },
            {
                "name": "repo",
                "type": "base_prompt",
                "prompt": "<needs to be added>"
            }
        ],
        "tools": [
            {
                "name": "Get page views",
                "description": "Retrieves page view statistics for a repository over the last 14 days, including total views, unique visitors, and a daily or weekly breakdown.",
                "mockTool": false,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "owner": {
                            "description": "The username of the account that owns the repository. This field is case-insensitive.",
                            "examples": [
                                "octocat"
                            ],
                            "title": "Owner",
                            "type": "string"
                        },
                        "per": {
                            "default": "day",
                            "description": "The time unit for which to aggregate page views.",
                            "enum": [
                                "day",
                                "week"
                            ],
                            "examples": [
                                "day",
                                "week"
                            ],
                            "title": "Per",
                            "type": "string"
                        },
                        "repo": {
                            "description": "The name of the repository, without the `.git` extension. This field is case-insensitive.",
                            "examples": [
                                "Spoon-Knife"
                            ],
                            "title": "Repo",
                            "type": "string"
                        }
                    },
                    "required": [
                        "owner",
                        "repo"
                    ]
                },
                "isComposio": true,
                "composioData": {
                    "slug": "GITHUB_GET_PAGE_VIEWS",
                    "noAuth": false,
                    "toolkitName": "GitHub",
                    "toolkitSlug": "github",
                    "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/github.png"
                }
            },
            {
                "name": "Append Values to Spreadsheet",
                "description": "Tool to append values to a spreadsheet. use when you need to add new data to the end of an existing table in a google sheet.",
                "mockTool": false,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "includeValuesInResponse": {
                            "default": null,
                            "description": "Determines if the update response should include the values of the cells that were appended. By default, responses do not include the updated values.",
                            "examples": [
                                true
                            ],
                            "nullable": true,
                            "title": "Include Values In Response",
                            "type": "boolean"
                        },
                        "insertDataOption": {
                            "default": null,
                            "description": "How the input data should be inserted.",
                            "enum": [
                                "OVERWRITE",
                                "INSERT_ROWS"
                            ],
                            "examples": [
                                "INSERT_ROWS"
                            ],
                            "nullable": true,
                            "title": "Insert Data Option",
                            "type": "string"
                        },
                        "majorDimension": {
                            "default": null,
                            "description": "The major dimension of the values. For output, if the spreadsheet data is: A1=1,B1=2,A2=3,B2=4, then requesting range=A1:B2,majorDimension=ROWS will return [[1,2],[3,4]], whereas requesting range=A1:B2,majorDimension=COLUMNS will return [[1,3],[2,4]].",
                            "enum": [
                                "ROWS",
                                "COLUMNS"
                            ],
                            "examples": [
                                "ROWS"
                            ],
                            "nullable": true,
                            "title": "Major Dimension",
                            "type": "string"
                        },
                        "range": {
                            "description": "The A1 notation of a range to search for a logical table of data. Values are appended after the last row of the table.",
                            "examples": [
                                "Sheet1!A1:B2"
                            ],
                            "title": "Range",
                            "type": "string"
                        },
                        "responseDateTimeRenderOption": {
                            "default": null,
                            "description": "Determines how dates, times, and durations in the response should be rendered. This is ignored if responseValueRenderOption is FORMATTED_VALUE. The default dateTime render option is SERIAL_NUMBER.",
                            "enum": [
                                "SERIAL_NUMBER",
                                "FORMATTED_STRING"
                            ],
                            "examples": [
                                "SERIAL_NUMBER"
                            ],
                            "nullable": true,
                            "title": "Response Date Time Render Option",
                            "type": "string"
                        },
                        "responseValueRenderOption": {
                            "default": null,
                            "description": "Determines how values in the response should be rendered. The default render option is FORMATTED_VALUE.",
                            "enum": [
                                "FORMATTED_VALUE",
                                "UNFORMATTED_VALUE",
                                "FORMULA"
                            ],
                            "examples": [
                                "FORMATTED_VALUE"
                            ],
                            "nullable": true,
                            "title": "Response Value Render Option",
                            "type": "string"
                        },
                        "spreadsheetId": {
                            "description": "The ID of the spreadsheet to update.",
                            "examples": [
                                "1q0gLhLdGXYZblahblahblah"
                            ],
                            "title": "Spreadsheet Id",
                            "type": "string"
                        },
                        "valueInputOption": {
                            "description": "How the input data should be interpreted.",
                            "enum": [
                                "RAW",
                                "USER_ENTERED"
                            ],
                            "examples": [
                                "USER_ENTERED"
                            ],
                            "title": "Value Input Option",
                            "type": "string"
                        },
                        "values": {
                            "description": "The data to be written. This is an array of arrays, the outer array representing all the data and each inner array representing a major dimension. Each item in the inner array corresponds with one cell.",
                            "examples": [
                                [
                                    [
                                        "A1_val1",
                                        "A1_val2"
                                    ],
                                    [
                                        "A2_val1",
                                        "A2_val2"
                                    ]
                                ]
                            ],
                            "items": {
                                "items": {
                                    "anyOf": [
                                        {
                                            "type": "string"
                                        },
                                        {
                                            "type": "integer"
                                        },
                                        {
                                            "type": "number"
                                        },
                                        {
                                            "type": "boolean"
                                        }
                                    ]
                                },
                                "type": "array"
                            },
                            "title": "Values",
                            "type": "array"
                        }
                    },
                    "required": [
                        "spreadsheetId",
                        "range",
                        "valueInputOption",
                        "values"
                    ]
                },
                "isComposio": true,
                "composioData": {
                    "slug": "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND",
                    "noAuth": false,
                    "toolkitName": "Googlesheets",
                    "toolkitSlug": "googlesheets",
                    "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/google-sheets.svg"
                }
            },
            {
                "name": "Get repository clones",
                "description": "Retrieves the total number of clones and a breakdown of clone activity (daily or weekly) for a specified repository over the preceding 14 days.",
                "mockTool": false,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "owner": {
                            "description": "The username of the account that owns the repository. This field is not case-sensitive.",
                            "examples": [
                                "octocat",
                                "github"
                            ],
                            "title": "Owner",
                            "type": "string"
                        },
                        "per": {
                            "default": "day",
                            "description": "Specifies the time frame for aggregating clone data: `day` for daily clone counts, or `week` for weekly clone counts (a week starts on Monday).",
                            "enum": [
                                "day",
                                "week"
                            ],
                            "examples": [
                                "day",
                                "week"
                            ],
                            "title": "Per",
                            "type": "string"
                        },
                        "repo": {
                            "description": "The name of the repository, without the '.git' extension. This field is not case-sensitive.",
                            "examples": [
                                "Hello-World",
                                "mercury"
                            ],
                            "title": "Repo",
                            "type": "string"
                        }
                    },
                    "required": [
                        "owner",
                        "repo"
                    ]
                },
                "isComposio": true,
                "composioData": {
                    "slug": "GITHUB_GET_REPOSITORY_CLONES",
                    "noAuth": false,
                    "toolkitName": "GitHub",
                    "toolkitSlug": "github",
                    "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/github.png"
                }
            },
            {
                "name": "Send a message to a Slack channel",
                "description": "Deprecated: posts a message to a slack channel, direct message, or private group. use `send message` instead.",
                "mockTool": false,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "as_user": {
                            "description": "Post as the authenticated user instead of as a bot. Defaults to `false`. If `true`, `username`, `icon_emoji`, and `icon_url` are ignored. If `false`, the message is posted as a bot, allowing appearance customization.",
                            "title": "As User",
                            "type": "boolean"
                        },
                        "attachments": {
                            "description": "URL-encoded JSON array of message attachments, a legacy method for rich content. See Slack API documentation for structure.",
                            "examples": [
                                "%5B%7B%22fallback%22%3A%20%22Required%20plain-text%20summary%20of%20the%20attachment.%22%2C%20%22color%22%3A%20%22%2336a64f%22%2C%20%22pretext%22%3A%20%22Optional%20text%20that%20appears%20above%20the%20attachment%20block%22%2C%20%22author_name%22%3A%20%22Bobby%20Tables%22%2C%20%22title%22%3A%20%22Slack%20API%20Documentation%22%2C%20%22title_link%22%3A%20%22https%3A%2F%2Fapi.slack.com%2F%22%2C%20%22text%22%3A%20%22Optional%20text%20that%20appears%20within%20the%20attachment%22%7D%5D"
                            ],
                            "title": "Attachments",
                            "type": "string"
                        },
                        "blocks": {
                            "description": "DEPRECATED: Use `markdown_text` field instead. URL-encoded JSON array of layout blocks for rich/interactive messages. See Slack API Block Kit docs for structure.",
                            "examples": [
                                "%5B%7B%22type%22%3A%20%22section%22%2C%20%22text%22%3A%20%7B%22type%22%3A%20%22mrkdwn%22%2C%20%22text%22%3A%20%22Hello%2C%20world%21%22%7D%7D%5D"
                            ],
                            "title": "Blocks",
                            "type": "string"
                        },
                        "channel": {
                            "description": "ID or name of the channel, private group, or IM channel to send the message to.",
                            "examples": [
                                "C1234567890",
                                "general"
                            ],
                            "title": "Channel",
                            "type": "string"
                        },
                        "icon_emoji": {
                            "description": "Emoji for bot's icon (e.g., ':robot_face:'). Overrides `icon_url`. Applies if `as_user` is `false`.",
                            "examples": [
                                ":tada:",
                                ":slack:"
                            ],
                            "title": "Icon Emoji",
                            "type": "string"
                        },
                        "icon_url": {
                            "description": "Image URL for bot's icon (must be HTTPS). Applies if `as_user` is `false`.",
                            "examples": [
                                "https://slack.com/img/icons/appDir_2019_01/Tonito64.png"
                            ],
                            "title": "Icon Url",
                            "type": "string"
                        },
                        "link_names": {
                            "description": "Automatically hyperlink channel names (e.g., #channel) and usernames (e.g., @user) in message text. Defaults to `false` for bot messages.",
                            "title": "Link Names",
                            "type": "boolean"
                        },
                        "markdown_text": {
                            "description": "PREFERRED: Write your message in markdown for nicely formatted display. Supports: headers (# ## ###), bold (**text** or __text__), italic (*text* or _text_), strikethrough (~~text~~), inline code (`code`), code blocks (```), links ([text](url)), block quotes (>), lists (- item, 1. item), dividers (--- or ***), context blocks (:::context with images), and section buttons (:::section-button). IMPORTANT: Use \\n for line breaks (e.g., 'Line 1\\nLine 2'), not actual newlines. USER MENTIONS: To tag users, use their user ID with <@USER_ID> format (e.g., <@U1234567890>), not username. ",
                            "examples": [
                                "# Status Update\n\nSystem is **running smoothly** with *excellent* performance.\n\n```bash\nkubectl get pods\n```\n\n> All services operational ✅",
                                "## Daily Report\n\n- **Deployments**: 5 successful\n- *Issues*: 0 critical\n- ~~Maintenance~~: **Completed**\n\n---\n\n**Next**: Monitor for 24h"
                            ],
                            "title": "Markdown Text",
                            "type": "string"
                        },
                        "mrkdwn": {
                            "description": "Disable Slack's markdown for `text` field if `false`. Default `true` (allows *bold*, _italic_, etc.).",
                            "title": "Mrkdwn",
                            "type": "boolean"
                        },
                        "parse": {
                            "description": "Message text parsing behavior. Default `none` (no special parsing). `full` parses as user-typed (links @mentions, #channels). See Slack API docs for details.",
                            "examples": [
                                "none",
                                "full"
                            ],
                            "title": "Parse",
                            "type": "string"
                        },
                        "reply_broadcast": {
                            "description": "If `true` for a threaded reply, also posts to main channel. Defaults to `false`.",
                            "title": "Reply Broadcast",
                            "type": "boolean"
                        },
                        "text": {
                            "description": "DEPRECATED: This sends raw text only, use markdown_text field. Primary textual content. Recommended fallback if using `blocks` or `attachments`. Supports mrkdwn unless `mrkdwn` is `false`.",
                            "examples": [
                                "Hello from your friendly bot!",
                                "Reminder: Team meeting at 3 PM today."
                            ],
                            "title": "Text",
                            "type": "string"
                        },
                        "thread_ts": {
                            "description": "Timestamp (`ts`) of an existing message to make this a threaded reply. Use `ts` of the parent message, not another reply. Example: '1476746824.000004'.",
                            "examples": [
                                "1618033790.001500"
                            ],
                            "title": "Thread Ts",
                            "type": "string"
                        },
                        "unfurl_links": {
                            "description": "Enable unfurling of text-based URLs. Defaults `false` for bots, `true` if `as_user` is `true`.",
                            "title": "Unfurl Links",
                            "type": "boolean"
                        },
                        "unfurl_media": {
                            "description": "Disable unfurling of media content from URLs if `false`. Defaults to `true`.",
                            "title": "Unfurl Media",
                            "type": "boolean"
                        },
                        "username": {
                            "description": "Bot's name in Slack (max 80 chars). Applies if `as_user` is `false`.",
                            "examples": [
                                "MyBot",
                                "AlertBot"
                            ],
                            "title": "Username",
                            "type": "string"
                        }
                    },
                    "required": [
                        "channel"
                    ]
                },
                "isComposio": true,
                "composioData": {
                    "slug": "SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL",
                    "noAuth": false,
                    "toolkitName": "Slack",
                    "toolkitSlug": "slack",
                    "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/slack.svg"
                }
            }
        ],
        "pipelines": [
            {
                "name": "GitHub Stats Logging Pipeline",
                "description": "Sequential pipeline to fetch GitHub stats, log them to a Google Sheet, and notify #stats Slack channel.",
                "agents": [
                    "Pipeline Step 1 - Fetch Views Data",
                    "Pipeline Step 2 - Fetch Clones Data",
                    "Pipeline Step 3 - Add Data to Sheet",
                    "Pipeline Step 4 - Send Slack Summary"
                ]
            }
        ],
        "startAgent": "GitHub Stats Pipeline Hub"
    }
}

export const starting_copilot_prompts: { [key: string]: string } = {
    "Credit Card Assistant": "Create a credit card assistant that helps users with credit card related queries like card recommendations, benefits, rewards, application process, and general credit card advice. Provide accurate and helpful information while maintaining a professional and friendly tone.",

    "Scheduling Assistant": "Create an appointment scheduling assistant that helps users schedule, modify, and manage their appointments efficiently. Help with finding available time slots, sending reminders, rescheduling appointments, and answering questions about scheduling policies and procedures. Maintain a professional and organized approach.",

    "Blog Assistant": "Create a blog writer assistant with agents for researching, compiling, outlining and writing the blog. The research agent will research the topic and compile the information. The outline agent will write bullet points for the blog post. The writing agent will expand upon the outline and write the blog post. The blog post should be 1000 words or more.",
}