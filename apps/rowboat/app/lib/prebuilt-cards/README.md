# Prebuilt Cards Directory

This directory contains JSON files that define prebuilt assistant templates. These templates appear as cards in the "Pre-built Assistants" section of the application.

## How to Add New Prebuilt Cards

1. Create a new JSON file in this directory (e.g., `my-assistant.json`)
2. The filename (without extension) will be used as the template key
3. The JSON file should follow the WorkflowTemplate schema structure

## Required Structure

Each prebuilt card JSON file must have:
- `name`: Display name for the template
- `description`: Brief description of what the template does
- `agents`: Array of agent configurations
- `startAgent`: Name of the starting agent
- `tools`: Array of tool configurations (optional)
- `prompts`: Array of prompt configurations (optional)
- `pipelines`: Array of pipeline configurations (optional)
 - `category`: Logical grouping for UI subsections (e.g., `Work Productivity`, `Developer Productivity`)

## Example Prebuilt Cards

See the existing files in this directory:
- `github-data-to-spreadsheet.json` - Fetches GitHub stats and logs to Google Sheets
- `Meeting Prep Assistant.json` - Research meeting attendees and send to Slack
- `interview-scheduler.json` - Automate interview scheduling with Google Sheets/Calendar

## Template Loading

Prebuilt cards are automatically loaded when the application starts. Simply drop a new JSON file here and restart the application to see it appear in the prebuilt assistants section.

## Location

This directory is located at `app/lib/prebuilt-cards/` to keep the template definitions close to the `project_templates.ts` file that loads them.

## Validation

The system validates that each template has:
- A valid `agents` array
- Proper JSON syntax

Invalid templates will be logged as warnings but won't break the application.
