// Static index of prebuilt workflow templates so they are bundled in Vercel
// If you add/remove a JSON here, update this file accordingly.

import githubDataToSpreadsheet from './github-data-to-spreadsheet.json';
import interviewScheduler from './interview-scheduler.json';
import meetingPrepAssistant from './meeting-prep-assistant.json';
import redditOnSlack from './reddit-on-slack.json';
import twitterSentiment from './twitter-sentiment.json';
import tweetAssistant from './tweet-assistant.json';        
import customerSupport from './customer-support.json';
import githubIssueToSlack from './github-issue-to-slack.json';
import githubPrToSlack from './github-pr-to-slack.json';
import eisenhowerEmailOrganizer from './eisenhower-email-organizer.json';

// Keep keys consistent with prior file basenames to avoid breaking links.
export const prebuiltTemplates = {
  'github-data-to-spreadsheet': githubDataToSpreadsheet,
  'interview-scheduler': interviewScheduler,
  'Meeting Prep Assistant': meetingPrepAssistant,
  'Reddit on Slack': redditOnSlack,
  'Twitter Sentiment': twitterSentiment,
  'Tweet Assistant': tweetAssistant,
  'Customer Support': customerSupport,
  'GitHub Issue to Slack': githubIssueToSlack,
  'GitHub PR to Slack': githubPrToSlack,
  'Eisenhower Email Organizer': eisenhowerEmailOrganizer,
  'Test 3': test3,
  'Test 4': test4,
  'Test 5': test5,
  'Test 6': test6,
};

