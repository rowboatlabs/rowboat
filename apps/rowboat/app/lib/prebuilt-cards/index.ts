// Static index of prebuilt workflow templates so they are bundled in Vercel
// If you add/remove a JSON here, update this file accordingly.

import githubDataToSpreadsheet from './github-data-to-spreadsheet.json';
import interviewScheduler from './interview-scheduler.json';
import meetingPrepAssistant from './Meeting Prep Assistant.json';
import redditOnSlack from './Reddit on Slack.json';

// Keep keys consistent with prior file basenames to avoid breaking links.
export const prebuiltTemplates = {
  'github-data-to-spreadsheet': githubDataToSpreadsheet,
  'interview-scheduler': interviewScheduler,
  'Meeting Prep Assistant': meetingPrepAssistant,
  'Reddit on Slack': redditOnSlack,
};

