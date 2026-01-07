import fs from 'fs';
import path from 'path';
import { WorkDir } from '../config/config.js';
import { FirefliesClientFactory } from './fireflies-client-factory.js';
import { buildGraph } from './build_graph.js';

// Configuration
const SYNC_DIR = path.join(WorkDir, 'fireflies_transcripts');
const SYNC_INTERVAL_MS = 60 * 1000; // Check every minute
const STATE_FILE = path.join(SYNC_DIR, 'sync_state.json');
const LOOKBACK_DAYS = 30; // Last 1 month

// --- Types for Fireflies API responses ---

interface FirefliesMeeting {
    id: string;
    title?: string;
    dateString?: string;
    date?: string;
    organizerEmail?: string;
    organizer_email?: string;
    participants?: string[];
    meetingAttendees?: Array<{ displayName?: string | null; email: string }>;
    meetingLink?: string;
    duration?: number;
    summary?: {
        short_summary?: string;
        keywords?: string[];
        action_items?: string;
    };
}

interface FirefliesTranscriptSentence {
    text: string;
    speaker_name?: string;
    speakerName?: string;
    start_time?: number;
    startTime?: number;
    end_time?: number;
    endTime?: number;
}

interface FirefliesSummary {
    keywords?: string[];
    action_items?: string[] | string;
    overview?: string;
    short_summary?: string;
    outline?: string[];
    topics?: string[];
}

interface FirefliesMeetingData {
    id: string;
    title?: string;
    dateString?: string;
    date?: string;
    organizerEmail?: string;
    organizer_email?: string;
    participants?: string[];
    meetingAttendees?: Array<{ displayName?: string | null; email: string }>;
    meetingLink?: string;
    transcript?: {
        sentences?: FirefliesTranscriptSentence[];
    };
    sentences?: FirefliesTranscriptSentence[];
    summary?: FirefliesSummary;
    duration?: number;
}

interface McpToolResult {
    content?: Array<{
        type: string;
        text?: string;
    }>;
    isError?: boolean;
}

// --- Helper Functions ---

function cleanFilename(name: string): string {
    return name.replace(/[\\/*?:"<>|]/g, "_").substring(0, 100).trim();
}

function formatDuration(seconds?: number): string {
    if (!seconds) return 'Unknown';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
}

function formatTimestamp(seconds?: number): string {
    if (seconds === undefined) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
}

function loadState(): { lastSyncDate?: string; syncedIds?: string[] } {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        } catch {
            return {};
        }
    }
    return {};
}

function saveState(lastSyncDate: string, syncedIds: string[]) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
        lastSyncDate,
        syncedIds,
        last_sync: new Date().toISOString()
    }, null, 2));
}

/**
 * Parse MCP tool result to extract JSON data
 */
function parseMcpResult<T>(result: McpToolResult): T | null {
    if (result.isError) {
        console.error('[Fireflies] MCP tool returned error');
        return null;
    }
    
    if (!result.content || result.content.length === 0) {
        return null;
    }
    
    // Find text content
    const textContent = result.content.find(c => c.type === 'text' && c.text);
    if (!textContent || !textContent.text) {
        return null;
    }
    
    try {
        return JSON.parse(textContent.text) as T;
    } catch {
        // If not JSON, return the text as-is (for toon format)
        console.log('[Fireflies] Response is not JSON, may be in toon format');
        return null;
    }
}

/**
 * Parse toon format transcript text into sentences
 * Format: "Sentences: Speaker Name: text.\nSpeaker Name: text.\n..."
 */
function parseToonTranscript(text: string): FirefliesTranscriptSentence[] {
    const sentences: FirefliesTranscriptSentence[] = [];
    
    // Find the Sentences section
    const sentencesMatch = text.match(/Sentences:\s*([\s\S]*)/);
    if (!sentencesMatch) {
        return sentences;
    }
    
    const sentencesText = sentencesMatch[1];
    
    // Split by newlines and parse each line
    // Format: "Speaker Name: sentence text"
    const lines = sentencesText.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
        // Match "Speaker Name: text" pattern
        const match = line.match(/^([^:]+):\s*(.+)$/);
        if (match) {
            sentences.push({
                speakerName: match[1].trim(),
                text: match[2].trim(),
            });
        }
    }
    
    return sentences;
}

/**
 * Get raw text from MCP result
 */
function getRawText(result: McpToolResult): string | null {
    if (result.isError || !result.content || result.content.length === 0) {
        return null;
    }
    
    const textContent = result.content.find(c => c.type === 'text' && c.text);
    return textContent?.text || null;
}

/**
 * Convert meeting data to markdown format
 */
function meetingToMarkdown(meeting: FirefliesMeetingData): string {
    let md = `# ${meeting.title || 'Untitled Meeting'}\n\n`;
    
    // Metadata
    md += `**Meeting ID:** ${meeting.id}\n`;
    
    const dateStr = meeting.dateString || meeting.date;
    if (dateStr) {
        const date = new Date(dateStr);
        md += `**Date:** ${date.toLocaleString()}\n`;
    }
    
    const organizer = meeting.organizerEmail || meeting.organizer_email;
    if (organizer) {
        md += `**Organizer:** ${organizer}\n`;
    }
    
    // Handle participants from either participants array or meetingAttendees
    const participants = meeting.participants || 
        meeting.meetingAttendees?.map(a => a.displayName || a.email) || [];
    if (participants.length > 0) {
        md += `**Participants:** ${participants.join(', ')}\n`;
    }
    
    if (meeting.meetingLink) {
        md += `**Meeting Link:** ${meeting.meetingLink}\n`;
    }
    
    if (meeting.duration) {
        md += `**Duration:** ${formatDuration(meeting.duration)}\n`;
    }
    
    md += '\n---\n\n';
    
    // Summary section
    if (meeting.summary) {
        const summary = meeting.summary;
        
        // Handle short_summary or overview
        const overview = summary.short_summary || summary.overview;
        if (overview) {
            md += `## Overview\n\n${overview}\n\n`;
        }
        
        if (summary.keywords && summary.keywords.length > 0) {
            md += `## Keywords\n\n${summary.keywords.join(', ')}\n\n`;
        }
        
        if (summary.topics && summary.topics.length > 0) {
            md += `## Topics Discussed\n\n`;
            for (const topic of summary.topics) {
                md += `- ${topic}\n`;
            }
            md += '\n';
        }
        
        // Handle action_items as string or array
        if (summary.action_items) {
            md += `## Action Items\n\n`;
            if (typeof summary.action_items === 'string') {
                // It's a formatted string, include as-is
                md += `${summary.action_items}\n\n`;
            } else if (Array.isArray(summary.action_items) && summary.action_items.length > 0) {
                for (const item of summary.action_items) {
                    md += `- [ ] ${item}\n`;
                }
                md += '\n';
            }
        }
        
        if (summary.outline && summary.outline.length > 0) {
            md += `## Outline\n\n`;
            for (const point of summary.outline) {
                md += `- ${point}\n`;
            }
            md += '\n';
        }
    }
    
    // Transcript section - handle both nested and flat sentence arrays
    const sentences = meeting.transcript?.sentences || meeting.sentences;
    if (sentences && sentences.length > 0) {
        md += `## Transcript\n\n`;
        
        let currentSpeaker = '';
        for (const sentence of sentences) {
            const speaker = sentence.speaker_name || sentence.speakerName || 'Unknown';
            const startTime = sentence.start_time ?? sentence.startTime;
            const timestamp = formatTimestamp(startTime);
            
            if (speaker !== currentSpeaker) {
                md += `\n### ${speaker}\n`;
                currentSpeaker = speaker;
            }
            
            md += `${timestamp} ${sentence.text}\n`;
        }
    }
    
    return md;
}

// --- Sync Logic ---

async function syncMeetings() {
    console.log('[Fireflies] Starting sync...');
    
    // Ensure sync directory exists
    if (!fs.existsSync(SYNC_DIR)) {
        fs.mkdirSync(SYNC_DIR, { recursive: true });
    }
    
    const client = await FirefliesClientFactory.getClient();
    if (!client) {
        console.log('[Fireflies] No valid client available');
        return;
    }
    
    const state = loadState();
    const syncedIds = new Set(state.syncedIds || []);
    
    // Calculate date range (last 30 days)
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - LOOKBACK_DAYS);
    
    const fromDateStr = fromDate.toISOString().split('T')[0]; // YYYY-MM-DD
    const toDateStr = toDate.toISOString().split('T')[0];
    
    console.log(`[Fireflies] Fetching meetings from ${fromDateStr} to ${toDateStr}...`);
    
    try {
        // Step 1: Get list of transcripts
        const transcriptsResult = await client.callTool({
            name: 'fireflies_get_transcripts',
            arguments: {
                fromDate: fromDateStr,
                toDate: toDateStr,
                limit: 50,
                format: 'json',
            },
        }) as McpToolResult;
        
        // Parse result - API returns array directly, not { transcripts: [...] }
        const parsedData = parseMcpResult<FirefliesMeeting[] | { transcripts?: FirefliesMeeting[] }>(transcriptsResult);
        
        // Handle both array and object responses
        let meetings: FirefliesMeeting[];
        if (Array.isArray(parsedData)) {
            meetings = parsedData;
        } else if (parsedData?.transcripts) {
            meetings = parsedData.transcripts;
        } else {
            meetings = [];
        }
        
        if (meetings.length === 0) {
            console.log('[Fireflies] No transcripts found in date range');
            saveState(toDateStr, Array.from(syncedIds));
            return;
        }
        
        console.log(`[Fireflies] Found ${meetings.length} transcripts`);
        
        // Step 2: Fetch and save each transcript
        let newCount = 0;
        for (const meeting of meetings) {
            const meetingId = meeting.id;
            
            // Skip if already synced
            if (syncedIds.has(meetingId)) {
                console.log(`[Fireflies] Skipping already synced: ${meeting.title || meetingId}`);
                continue;
            }
            
            try {
                console.log(`[Fireflies] Fetching full transcript: ${meeting.title || meetingId}`);
                
                // Try to get transcript sentences using fireflies_get_transcript
                let sentences: FirefliesTranscriptSentence[] = [];
                try {
                    const transcriptResult = await client.callTool({
                        name: 'fireflies_get_transcript',
                        arguments: {
                            transcriptId: meetingId,
                        },
                    }) as McpToolResult;
                    
                    // Try JSON first
                    const transcriptData = parseMcpResult<{ sentences?: FirefliesTranscriptSentence[] } | FirefliesTranscriptSentence[]>(transcriptResult);
                    
                    if (transcriptData) {
                        if (Array.isArray(transcriptData)) {
                            sentences = transcriptData;
                        } else if (transcriptData.sentences) {
                            sentences = transcriptData.sentences;
                        }
                    } else {
                        // Try parsing toon format
                        const rawText = getRawText(transcriptResult);
                        if (rawText) {
                            sentences = parseToonTranscript(rawText);
                            console.log(`[Fireflies] Parsed ${sentences.length} sentences from toon format`);
                        }
                    }
                } catch (err) {
                    console.log(`[Fireflies] Could not fetch transcript sentences: ${err}`);
                }
                
                // Build meeting data from the list response + transcript
                const meetingData: FirefliesMeetingData = {
                    id: meeting.id,
                    title: meeting.title,
                    dateString: meeting.dateString,
                    organizerEmail: meeting.organizerEmail,
                    participants: meeting.participants,
                    meetingAttendees: meeting.meetingAttendees,
                    meetingLink: meeting.meetingLink,
                    duration: meeting.duration,
                    summary: meeting.summary,
                    sentences: sentences,
                };
                
                // Convert to markdown and save
                const markdown = meetingToMarkdown(meetingData);
                const filename = `${meetingId}_${cleanFilename(meetingData.title || 'untitled')}.md`;
                const filePath = path.join(SYNC_DIR, filename);
                
                fs.writeFileSync(filePath, markdown);
                console.log(`[Fireflies] Saved: ${filename}`);
                
                syncedIds.add(meetingId);
                newCount++;
            } catch (error) {
                console.error(`[Fireflies] Error fetching meeting ${meetingId}:`, error);
                // Continue with next meeting
            }
        }
        
        console.log(`[Fireflies] Synced ${newCount} new transcripts`);
        
        // Save state
        saveState(toDateStr, Array.from(syncedIds));
        
        // Build knowledge graph after successful sync
        if (newCount > 0) {
            console.log('\n[Fireflies] Starting knowledge graph build...');
            try {
                await buildGraph();
            } catch (error) {
                console.error('[Fireflies] Error building knowledge graph:', error);
            }
        }
        
    } catch (error) {
        console.error('[Fireflies] Error during sync:', error);
        
        // Check if it's an auth error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
            console.log('[Fireflies] Auth error, clearing cache');
            await FirefliesClientFactory.clearCache();
        }
    }
}

/**
 * Main sync loop
 */
export async function init() {
    console.log('[Fireflies] Starting Fireflies Sync...');
    console.log(`[Fireflies] Will check for credentials every ${SYNC_INTERVAL_MS / 1000} seconds.`);
    console.log(`[Fireflies] Syncing transcripts from the last ${LOOKBACK_DAYS} days.`);

    while (true) {
        try {
            // Check if credentials are available
            const hasCredentials = await FirefliesClientFactory.hasValidCredentials();
            
            if (!hasCredentials) {
                console.log('[Fireflies] OAuth credentials not available. Sleeping...');
            } else {
                // Perform sync
                await syncMeetings();
            }
        } catch (error) {
            console.error('[Fireflies] Error in main loop:', error);
        }

        // Sleep before next check
        console.log(`[Fireflies] Sleeping for ${SYNC_INTERVAL_MS / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, SYNC_INTERVAL_MS));
    }
}

