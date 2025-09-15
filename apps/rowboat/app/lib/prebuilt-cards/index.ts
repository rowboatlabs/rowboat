// Static index of prebuilt workflow templates so they are bundled in Vercel
// If you add/remove a JSON here, update this file accordingly.

import githubDataToSpreadsheet from './github-data-to-spreadsheet.json';
import interviewScheduler from './interview-scheduler.json';
import meetingPrepAssistant from './meeting-prep-assistant.json';
import redditOnSlack from './reddit-on-slack.json';
import twitterSentiment from './twitter-sentiment.json';
import tweetWithGeneratedImage from './tweet-with-generated-image.json';
import customerSupport from './customer-support.json';
import githubIssueToSlack from './github-issue-to-slack.json';
import githubPrToSlack from './github-pr-to-slack.json';
import eisenhowerEmailOrganiser from './eisenhower-email-organiser.json';

// Keep keys consistent with prior file basenames to avoid breaking links.
export const prebuiltTemplates = {
  'github-data-to-spreadsheet': githubDataToSpreadsheet,
  'interview-scheduler': interviewScheduler,
  'Meeting Prep Assistant': meetingPrepAssistant,
  'Reddit on Slack': redditOnSlack,
  'Twitter Sentiment': twitterSentiment,
  'Tweet with generated image': tweetWithGeneratedImage,
  'Customer Support': customerSupport,
  'GitHub Issue to Slack': githubIssueToSlack,
  'GitHub PR to Slack': githubPrToSlack,
  'Eisenhower Email Organiser': eisenhowerEmailOrganiser,
};

