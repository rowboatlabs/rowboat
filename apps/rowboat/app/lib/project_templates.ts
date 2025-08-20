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
                instructions: "## 🧑‍💼 Role:\nYou are a helpful customer support assistant.\n\n## Inputs:\n- User support requests and issues\n- User email address for follow-up\n\n## ⚙️ Operating Procedure:\n- Gather information about the user's issue or question\n- Collect the user's email address for follow-up communication\n- Provide initial assistance and set expectations for further contact\n\n## 🎯 Scope:\nHandling customer support inquiries and collecting contact information. Does not provide detailed technical support or handle unrelated questions.\n\nWhen out-of-scope: Call @Example Agent if the user asks anything that is out of your scope.",
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
        "description": "Fetches meetings from your calendar and prepares you for them",
        "agents": [
            {
                "name": "Meeting Prep Hub",
                "type": "conversation",
                "description": "Hub agent to orchestrate fetching attendee details and preparing a meeting brief.",
                "instructions": "## 🧑‍💼 Role:\nYou orchestrate the workflow to fetch attendee details for a calendar event and prepare a meeting brief by researching attendees and their companies.\n\n## Inputs:\n- Event title and time from user\n- Meeting preparation requests\n\n## ⚙️ Operating Procedure:\n- Gather event details from user (title and time if needed)\n- Coordinate with attendee fetch agent to retrieve participant information\n- Direct attendee research agent to compile meeting preparation briefing\n- Deliver comprehensive meeting brief to user\n\n## 🎯 Scope:\nOrchestrating the workflow for meeting preparation. Does not directly fetch attendee details or research attendees.\n\nWhen out-of-scope: This is a hub agent that handles the main meeting preparation workflow.",
                "model": DEFAULT_MODEL,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "controlType": "retain",
                "outputVisibility": "user_facing",
                "examples": "- **User** : I want to prepare for my 'Q3 Planning Meeting'.\n - **Agent actions**: Call [@agent:Attendee Fetch Agent](#mention)\n\n- **Agent receives attendee list** :\n - **Agent actions**: Call [@agent:Attendee Research Agent](#mention)\n\n- **Agent receives meeting brief** :\n - **Agent response**: Here is your meeting brief: [summary]\n\n- **User** : I want to prepare for a meeting but don't know the event title.\n - **Agent response**: Please provide the event title (and time, if possible) so I can fetch the attendee details."
            },
            {
                "name": "Attendee Fetch Agent",
                "type": "conversation",
                "description": "Fetches attendee details for a specified event from the user's primary calendar.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nYou fetch attendee details (name, email, company if available) for a specified event from the user's primary calendar by searching through events using the List Events tool.\n\n## Inputs:\n- Event title and optional time from parent agent\n\n## ⚙️ Operating Procedure:\n- Use calendar search tools to locate events matching provided criteria\n- Extract comprehensive attendee information from matching events\n- Handle multiple event matches by using time disambiguation when available\n- Return structured attendee data to parent agent\n\n## 🎯 Scope:\nFetching attendee details for specified events by searching the user's primary calendar. Does not research attendees or companies.\n\nWhen out-of-scope: Call @Meeting Prep Hub if the user asks anything that is out of your scope.",
                "model": DEFAULT_MODEL,
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "controlType": "relinquish_to_parent",
                "outputVisibility": "internal",
                "maxCallsPerParentAgent": 3,
                "examples": "- **Parent agent** : Fetch attendees for 'Q3 Planning Meeting' at 2024-07-25T10:00:00Z\n - **Agent actions**: Call [@tool:List Events](#mention) with calendarId='primary', q='Q3 Planning Meeting', timeMin/timeMax as needed\n- **Agent receives event list** :\n - **Agent response**: [List of attendees with name, email, company]\n\n- **Parent agent** : Fetch attendees for 'Weekly Sync'\n - **Agent actions**: Call [@tool:List Events](#mention) with calendarId='primary', q='Weekly Sync'\n- **Agent receives event list** :\n - **Agent response**: [List of attendees with name, email, company]"
            },
            {
                "name": "Attendee Research Agent",
                "type": "conversation",
                "description": "Researches each attendee and their company using Google search, then summarizes findings for meeting preparation.",
                "disabled": false,
                "instructions": "## 🧑‍💼 Role:\nYou research each attendee and their company using Google search, then summarize findings to prepare the user for a meeting.\n\n## Inputs:\n- List of attendees (name, email, company if available) from parent agent\n\n## ⚙️ Operating Procedure:\n- Conduct comprehensive research on each attendee using web search tools\n- Gather information about attendees' roles, background, and recent activities\n- Research associated companies for industry context and recent developments\n- Compile actionable meeting brief with key findings and notable information\n\n## 🎯 Scope:\nResearching attendees and their companies, summarizing findings for meeting preparation. Does not fetch attendee details from calendar.\n\nWhen out-of-scope: Call @Meeting Prep Hub if the user asks anything that is out of your scope.",
                "model": DEFAULT_MODEL,
                "locked": false,
                "toggleAble": true,
                "ragReturnType": "chunks",
                "ragK": 3,
                "controlType": "retain",
                "outputVisibility": "user_facing",
                "maxCallsPerParentAgent": 3,
                "examples": "- **User** : (N/A, internal agent)\n- **Parent agent** : Research these attendees: [Jane Doe, Acme Corp, jane@acme.com]\n - **Agent actions**: Call [@tool:Composio Google Search](#mention) for 'Jane Doe Acme Corp', then for 'Acme Corp'\n- **Agent receives search results** :\n - **Agent response**: \nMeeting Brief:\n- Jane Doe (Acme Corp): VP of Product. Recent interview in TechCrunch. ...\n- Acme Corp: Leading SaaS provider, 500 employees, raised Series C in 2023."
            }
        ],
        "prompts": [],
        "tools": [
            {
                "name": "List Events",
                "description": "Returns events on the specified calendar.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "alwaysIncludeEmail": {
                            "default": null,
                            "description": "Deprecated and ignored.",
                            "nullable": true,
                            "title": "Always Include Email",
                            "type": "boolean"
                        },
                        "calendarId": {
                            "description": "Calendar identifier. To retrieve calendar IDs call the calendarList.list method. If you want to access the primary calendar of the currently logged in user, use the \"primary\" keyword.",
                            "examples": [
                                "primary"
                            ],
                            "title": "Calendar Id",
                            "type": "string"
                        },
                        "eventTypes": {
                            "default": null,
                            "description": "Event types to return. Optional. This parameter can be repeated multiple times to return events of different types. If unset, returns all event types. Acceptable values are: \"birthday\", \"default\", \"focusTime\", \"fromGmail\", \"outOfOffice\", \"workingLocation\".",
                            "nullable": true,
                            "title": "Event Types",
                            "type": "string"
                        },
                        "iCalUID": {
                            "default": null,
                            "description": "Specifies an event ID in the iCalendar format to be provided in the response. Optional. Use this if you want to search for an event by its iCalendar ID.",
                            "nullable": true,
                            "title": "I Cal Uid",
                            "type": "string"
                        },
                        "maxAttendees": {
                            "default": null,
                            "description": "The maximum number of attendees to include in the response. If there are more than the specified number of attendees, only the participant is returned. Optional.",
                            "nullable": true,
                            "title": "Max Attendees",
                            "type": "integer"
                        },
                        "maxResults": {
                            "default": null,
                            "description": "Maximum number of events returned on one result page. The number of events in the resulting page may be less than this value, or none at all, even if there are more events matching the query. Incomplete pages can be detected by a non-empty nextPageToken field in the response. By default the value is 250 events. The page size can never be larger than 2500 events. Optional.",
                            "nullable": true,
                            "title": "Max Results",
                            "type": "integer"
                        },
                        "orderBy": {
                            "default": null,
                            "description": "The order of the events returned in the result. Optional. The default is an unspecified, stable order. Acceptable values are: \"startTime\", \"updated\".",
                            "nullable": true,
                            "title": "Order By",
                            "type": "string"
                        },
                        "pageToken": {
                            "default": null,
                            "description": "Token specifying which result page to return. Optional.",
                            "nullable": true,
                            "title": "Page Token",
                            "type": "string"
                        },
                        "privateExtendedProperty": {
                            "default": null,
                            "description": "Extended properties constraint specified as propertyName=value. Matches only private properties. This parameter might be repeated multiple times to return events that match all given constraints.",
                            "nullable": true,
                            "title": "Private Extended Property",
                            "type": "string"
                        },
                        "q": {
                            "default": null,
                            "description": "Free text search terms to find events that match these terms in various fields. Optional.",
                            "nullable": true,
                            "title": "Q",
                            "type": "string"
                        },
                        "sharedExtendedProperty": {
                            "default": null,
                            "description": "Extended properties constraint specified as propertyName=value. Matches only shared properties. This parameter might be repeated multiple times to return events that match all given constraints.",
                            "nullable": true,
                            "title": "Shared Extended Property",
                            "type": "string"
                        },
                        "showDeleted": {
                            "default": null,
                            "description": "Whether to include deleted events (with status equals \"cancelled\") in the result. Optional. The default is False.",
                            "nullable": true,
                            "title": "Show Deleted",
                            "type": "boolean"
                        },
                        "showHiddenInvitations": {
                            "default": null,
                            "description": "Whether to include hidden invitations in the result. Optional. The default is False.",
                            "nullable": true,
                            "title": "Show Hidden Invitations",
                            "type": "boolean"
                        },
                        "singleEvents": {
                            "default": null,
                            "description": "Whether to expand recurring events into instances and only return single one-off events and instances of recurring events. Optional. The default is False.",
                            "nullable": true,
                            "title": "Single Events",
                            "type": "boolean"
                        },
                        "syncToken": {
                            "default": null,
                            "description": "Token obtained from the nextSyncToken field returned on the last page of results from the previous list request. Optional. The default is to return all entries.",
                            "nullable": true,
                            "title": "Sync Token",
                            "type": "string"
                        },
                        "timeMax": {
                            "default": null,
                            "description": "Upper bound (exclusive) for an event's start time to filter by. Optional. The default is not to filter by start time. Must be an RFC3339 timestamp with mandatory time zone offset, for example, 2011-06-03T10:00:00-07:00, 2011-06-03T10:00:00Z. Milliseconds may be provided but are ignored. If timeMin is set, timeMax must be greater than timeMin.",
                            "nullable": true,
                            "title": "Time Max",
                            "type": "string"
                        },
                        "timeMin": {
                            "default": null,
                            "description": "Lower bound (exclusive) for an event's end time to filter by. Optional. The default is not to filter by end time. Must be an RFC3339 timestamp with mandatory time zone offset, for example, 2011-06-03T10:00:00-07:00, 2011-06-03T10:00:00Z. Milliseconds may be provided but are ignored. If timeMax is set, timeMin must be smaller than timeMax.",
                            "nullable": true,
                            "title": "Time Min",
                            "type": "string"
                        },
                        "timeZone": {
                            "default": null,
                            "description": "Time zone used in the response. Optional. The default is the user's primary time zone.",
                            "nullable": true,
                            "title": "Time Zone",
                            "type": "string"
                        },
                        "updatedMin": {
                            "default": null,
                            "description": "Lower bound for an event's last modification time (as a RFC3339 timestamp) to filter by. When specified, entries deleted since this time will always be included regardless of showDeleted. Optional. The default is not to filter by last modification time.",
                            "nullable": true,
                            "title": "Updated Min",
                            "type": "string"
                        }
                    },
                    "required": [
                        "calendarId"
                    ]
                },
                "mockTool": true,
                "isComposio": true,
                "composioData": {
                    "slug": "GOOGLECALENDAR_EVENTS_LIST",
                    "noAuth": false,
                    "toolkitName": "Googlecalendar",
                    "toolkitSlug": "googlecalendar",
                    "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/google-calendar.svg"
                }
            },
            {
                "name": "Composio Google Search",
                "description": "Perform a google search using the composio google search api.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "description": "The search query for the Composio Google Search API.",
                            "examples": [
                                "Coffee"
                            ],
                            "title": "Query",
                            "type": "string"
                        }
                    },
                    "required": [
                        "query"
                    ]
                },
                "mockTool": true,
                "isComposio": true,
                "composioData": {
                    "slug": "COMPOSIO_SEARCH_SEARCH",
                    "noAuth": true,
                    "toolkitName": "Composio search",
                    "toolkitSlug": "composio_search",
                    "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master//composio-logo.png"
                }
            }
        ],
        "startAgent": "Meeting Prep Hub",
    }
}

export const starting_copilot_prompts: { [key: string]: string } = {
    "Credit Card Assistant": "Create a credit card assistant that helps users with credit card related queries like card recommendations, benefits, rewards, application process, and general credit card advice. Provide accurate and helpful information while maintaining a professional and friendly tone.",

    "Scheduling Assistant": "Create an appointment scheduling assistant that helps users schedule, modify, and manage their appointments efficiently. Help with finding available time slots, sending reminders, rescheduling appointments, and answering questions about scheduling policies and procedures. Maintain a professional and organized approach.",

    "Blog Assistant": "Create a blog writer assistant with agents for researching, compiling, outlining and writing the blog. The research agent will research the topic and compile the information. The outline agent will write bullet points for the blog post. The writing agent will expand upon the outline and write the blog post. The blog post should be 1000 words or more.",
}