import fs from 'fs';
import path from 'path';
import { WorkDir } from './config.js';
import {
    NoteCreationStrictness,
    setStrictnessAndMarkConfigured,
    isStrictnessConfigured,
} from './note_creation_config.js';

const GMAIL_SYNC_DIR = path.join(WorkDir, 'gmail_sync');

interface EmailInfo {
    threadId: string;
    subject: string;
    senders: string[];
    senderEmails: string[];
    body: string;
    date: Date | null;
}

interface AnalysisResult {
    totalEmails: number;
    uniqueSenders: number;
    newsletterCount: number;
    automatedCount: number;
    consumerServiceCount: number;
    businessCount: number;
    mediumWouldCreate: number;
    lowWouldCreate: number;
    recommendation: NoteCreationStrictness;
    reason: string;
}

// Common newsletter/marketing patterns
const NEWSLETTER_PATTERNS = [
    /unsubscribe/i,
    /opt[- ]?out/i,
    /email preferences/i,
    /manage.*subscription/i,
    /via sendgrid/i,
    /via mailchimp/i,
    /via hubspot/i,
    /via constantcontact/i,
    /list-unsubscribe/i,
];

const NEWSLETTER_SENDER_PATTERNS = [
    /^noreply@/i,
    /^no-reply@/i,
    /^newsletter@/i,
    /^marketing@/i,
    /^hello@/i,
    /^info@/i,
    /^team@/i,
    /^updates@/i,
    /^news@/i,
];

// Automated/transactional patterns
const AUTOMATED_PATTERNS = [
    /^notifications?@/i,
    /^alerts?@/i,
    /^support@/i,
    /^billing@/i,
    /^receipts?@/i,
    /^orders?@/i,
    /^shipping@/i,
    /^noreply@/i,
    /^donotreply@/i,
    /^mailer-daemon/i,
    /^postmaster@/i,
];

const AUTOMATED_SUBJECT_PATTERNS = [
    /password reset/i,
    /verify your email/i,
    /login alert/i,
    /security alert/i,
    /your order/i,
    /order confirmation/i,
    /shipping confirmation/i,
    /receipt for/i,
    /invoice/i,
    /payment received/i,
    /\[GitHub\]/i,
    /\[Jira\]/i,
    /\[Slack\]/i,
    /\[Linear\]/i,
    /\[Notion\]/i,
];

// Consumer service domains (not business-relevant)
const CONSUMER_SERVICE_DOMAINS = [
    'amazon.com', 'amazon.co.uk',
    'netflix.com',
    'spotify.com',
    'uber.com', 'ubereats.com',
    'doordash.com', 'grubhub.com',
    'apple.com', 'apple.id',
    'google.com', 'youtube.com',
    'facebook.com', 'meta.com', 'instagram.com',
    'twitter.com', 'x.com',
    'linkedin.com',
    'dropbox.com',
    'paypal.com', 'venmo.com',
    'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com',
    'att.com', 'verizon.com', 't-mobile.com',
    'comcast.com', 'xfinity.com',
    'delta.com', 'united.com', 'southwest.com', 'aa.com',
    'airbnb.com', 'vrbo.com',
    'walmart.com', 'target.com', 'bestbuy.com',
    'costco.com',
];

/**
 * Parse a synced email markdown file
 */
function parseEmailFile(filePath: string): EmailInfo | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        // Extract subject from first heading
        const subjectLine = lines.find(l => l.startsWith('# '));
        const subject = subjectLine ? subjectLine.slice(2).trim() : '';

        // Extract thread ID
        const threadIdLine = lines.find(l => l.startsWith('**Thread ID:**'));
        const threadId = threadIdLine ? threadIdLine.replace('**Thread ID:**', '').trim() : path.basename(filePath, '.md');

        // Extract all senders
        const senders: string[] = [];
        const senderEmails: string[] = [];
        let latestDate: Date | null = null;

        for (const line of lines) {
            if (line.startsWith('### From:')) {
                const from = line.replace('### From:', '').trim();
                senders.push(from);

                // Extract email from "Name <email@domain.com>" format
                const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s<]+@[^\s>]+)/);
                if (emailMatch) {
                    senderEmails.push(emailMatch[1].toLowerCase());
                }
            }
            if (line.startsWith('**Date:**')) {
                const dateStr = line.replace('**Date:**', '').trim();
                try {
                    const parsed = new Date(dateStr);
                    if (!isNaN(parsed.getTime())) {
                        if (!latestDate || parsed > latestDate) {
                            latestDate = parsed;
                        }
                    }
                } catch {
                    // ignore parse errors
                }
            }
        }

        return {
            threadId,
            subject,
            senders,
            senderEmails,
            body: content,
            date: latestDate,
        };
    } catch (error) {
        console.error(`Error parsing email file ${filePath}:`, error);
        return null;
    }
}

/**
 * Check if email is a newsletter/mass email
 */
function isNewsletter(email: EmailInfo): boolean {
    // Check sender patterns
    for (const senderEmail of email.senderEmails) {
        for (const pattern of NEWSLETTER_SENDER_PATTERNS) {
            if (pattern.test(senderEmail)) {
                return true;
            }
        }
    }

    // Check body for unsubscribe patterns
    for (const pattern of NEWSLETTER_PATTERNS) {
        if (pattern.test(email.body)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if email is automated/transactional
 */
function isAutomated(email: EmailInfo): boolean {
    // Check sender patterns
    for (const senderEmail of email.senderEmails) {
        for (const pattern of AUTOMATED_PATTERNS) {
            if (pattern.test(senderEmail)) {
                return true;
            }
        }
    }

    // Check subject patterns
    for (const pattern of AUTOMATED_SUBJECT_PATTERNS) {
        if (pattern.test(email.subject)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if email is from a consumer service
 */
function isConsumerService(email: EmailInfo): boolean {
    for (const senderEmail of email.senderEmails) {
        const domain = senderEmail.split('@')[1];
        if (domain) {
            // Check exact match or subdomain match (e.g., mail.amazon.com)
            for (const consumerDomain of CONSUMER_SERVICE_DOMAINS) {
                if (domain === consumerDomain || domain.endsWith(`.${consumerDomain}`)) {
                    return true;
                }
            }
        }
    }
    return false;
}

/**
 * Categorize an email based on its characteristics.
 * Returns the category which determines how different strictness levels would handle it.
 */
type EmailCategory = 'internal' | 'newsletter' | 'automated' | 'consumer_service' | 'business';

function categorizeEmail(email: EmailInfo, userDomain: string): {
    category: EmailCategory;
    externalSenders: string[];
} {
    // Filter out user's own domain
    const externalSenders = email.senderEmails.filter(e => !e.endsWith(`@${userDomain}`));
    if (externalSenders.length === 0) {
        return { category: 'internal', externalSenders: [] };
    }

    if (isNewsletter(email)) {
        return { category: 'newsletter', externalSenders };
    }

    if (isAutomated(email)) {
        return { category: 'automated', externalSenders };
    }

    if (isConsumerService(email)) {
        return { category: 'consumer_service', externalSenders };
    }

    return { category: 'business', externalSenders };
}

/**
 * Infer user's domain from email patterns.
 * Looks for the most common sender domain that appears frequently,
 * assuming the user's own emails would be the most common sender.
 */
function inferUserDomain(emails: EmailInfo[]): string {
    const domainCounts = new Map<string, number>();

    for (const email of emails) {
        for (const senderEmail of email.senderEmails) {
            const domain = senderEmail.split('@')[1];
            if (domain) {
                domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
            }
        }
    }

    // Find the most frequent domain (likely the user's domain)
    let maxCount = 0;
    let userDomain = '';

    for (const [domain, count] of domainCounts) {
        // Skip known consumer/service domains
        const isConsumer = CONSUMER_SERVICE_DOMAINS.some(
            d => domain === d || domain.endsWith(`.${d}`)
        );

        if (!isConsumer && count > maxCount) {
            maxCount = count;
            userDomain = domain;
        }
    }

    // Fallback if we couldn't determine
    return userDomain || 'example.com';
}

/**
 * Analyze emails and recommend a strictness level based on email patterns.
 *
 * Strictness levels filter emails as follows:
 * - High: Only creates notes from meetings, emails just update existing notes
 * - Medium: Creates notes for business emails (filters out consumer services)
 * - Low: Creates notes for any human sender (only filters newsletters/automated)
 */
export function analyzeEmailsAndRecommend(): AnalysisResult {
    const emails: EmailInfo[] = [];

    // Read all email files from gmail_sync
    if (fs.existsSync(GMAIL_SYNC_DIR)) {
        const files = fs.readdirSync(GMAIL_SYNC_DIR).filter(f => f.endsWith('.md'));

        // Filter to last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        for (const file of files) {
            const filePath = path.join(GMAIL_SYNC_DIR, file);
            const email = parseEmailFile(filePath);
            if (email) {
                // Include if date is within 30 days or if we can't parse the date
                if (!email.date || email.date >= thirtyDaysAgo) {
                    emails.push(email);
                }
            }
        }
    }

    const userDomain = inferUserDomain(emails);
    console.log(`[StrictnessAnalyzer] Inferred user domain: ${userDomain}`);

    // Track unique senders by category
    const uniqueSenders = new Set<string>();
    const newsletterSenders = new Set<string>();
    const automatedSenders = new Set<string>();
    const consumerServiceSenders = new Set<string>();
    const businessSenders = new Set<string>();

    let newsletterCount = 0;
    let automatedCount = 0;
    let consumerServiceCount = 0;
    let businessCount = 0;

    for (const email of emails) {
        const result = categorizeEmail(email, userDomain);

        for (const sender of result.externalSenders) {
            uniqueSenders.add(sender);
        }

        switch (result.category) {
            case 'newsletter':
                newsletterCount++;
                for (const sender of result.externalSenders) newsletterSenders.add(sender);
                break;
            case 'automated':
                automatedCount++;
                for (const sender of result.externalSenders) automatedSenders.add(sender);
                break;
            case 'consumer_service':
                consumerServiceCount++;
                for (const sender of result.externalSenders) consumerServiceSenders.add(sender);
                break;
            case 'business':
                businessCount++;
                for (const sender of result.externalSenders) businessSenders.add(sender);
                break;
        }
    }

    // Calculate what each strictness level would capture:
    // - Low: business + consumer_service senders (all human, non-automated)
    // - Medium: business senders only (filters consumer services)
    // - High: none from emails (only meetings create notes)
    const lowWouldCreate = businessSenders.size + consumerServiceSenders.size;
    const mediumWouldCreate = businessSenders.size;

    // Determine recommendation based on email patterns
    let recommendation: NoteCreationStrictness;
    let reason: string;

    const totalHumanSenders = lowWouldCreate;
    const noiseRatio = uniqueSenders.size > 0
        ? (newsletterSenders.size + automatedSenders.size) / uniqueSenders.size
        : 0;
    const consumerRatio = totalHumanSenders > 0
        ? consumerServiceSenders.size / totalHumanSenders
        : 0;

    if (totalHumanSenders > 100) {
        // High volume of contacts - recommend high to avoid noise
        recommendation = 'high';
        reason = `High volume of contacts (${totalHumanSenders} potential). High strictness focuses on people you meet, avoiding email overload.`;
    } else if (totalHumanSenders > 50) {
        // Moderate volume - recommend medium
        recommendation = 'medium';
        reason = `Moderate contact volume (${totalHumanSenders}). Medium strictness captures business contacts (${mediumWouldCreate}) while filtering consumer services.`;
    } else if (consumerRatio > 0.5) {
        // Lots of consumer service emails - medium helps filter
        recommendation = 'medium';
        reason = `${Math.round(consumerRatio * 100)}% of emails are from consumer services. Medium strictness filters these to focus on business contacts.`;
    } else if (totalHumanSenders < 30) {
        // Low volume - comprehensive capture is manageable
        recommendation = 'low';
        reason = `Low contact volume (${totalHumanSenders}). Low strictness provides comprehensive capture without overwhelming.`;
    } else {
        recommendation = 'medium';
        reason = `Medium strictness provides a good balance, capturing ${mediumWouldCreate} business contacts.`;
    }

    return {
        totalEmails: emails.length,
        uniqueSenders: uniqueSenders.size,
        newsletterCount,
        automatedCount,
        consumerServiceCount,
        businessCount,
        mediumWouldCreate,
        lowWouldCreate,
        recommendation,
        reason,
    };
}

/**
 * Run analysis and auto-configure strictness if not already done.
 * Returns true if configuration was updated.
 */
export function autoConfigureStrictnessIfNeeded(): boolean {
    if (isStrictnessConfigured()) {
        return false;
    }

    // Check if there are any emails to analyze
    if (!fs.existsSync(GMAIL_SYNC_DIR)) {
        console.log('[StrictnessAnalyzer] No gmail_sync directory found, skipping auto-configuration');
        return false;
    }

    const emailFiles = fs.readdirSync(GMAIL_SYNC_DIR).filter(f => f.endsWith('.md'));
    if (emailFiles.length === 0) {
        console.log('[StrictnessAnalyzer] No emails found to analyze, skipping auto-configuration');
        return false;
    }

    // Need at least 10 emails for meaningful analysis
    if (emailFiles.length < 10) {
        console.log(`[StrictnessAnalyzer] Only ${emailFiles.length} emails found, need at least 10 for meaningful analysis. Using default 'high' strictness.`);
        setStrictnessAndMarkConfigured('high');
        return true;
    }

    console.log('[StrictnessAnalyzer] Running email analysis for auto-configuration...');
    const result = analyzeEmailsAndRecommend();

    console.log('[StrictnessAnalyzer] Analysis complete:');
    console.log(`  - Total emails analyzed: ${result.totalEmails}`);
    console.log(`  - Unique external senders: ${result.uniqueSenders}`);
    console.log(`  - Newsletters/mass emails: ${result.newsletterCount}`);
    console.log(`  - Automated/transactional: ${result.automatedCount}`);
    console.log(`  - Consumer services: ${result.consumerServiceCount}`);
    console.log(`  - Business emails: ${result.businessCount}`);
    console.log(`  - Medium strictness would capture: ${result.mediumWouldCreate} contacts`);
    console.log(`  - Low strictness would capture: ${result.lowWouldCreate} contacts`);
    console.log(`  - Recommendation: ${result.recommendation.toUpperCase()}`);
    console.log(`  - Reason: ${result.reason}`);

    setStrictnessAndMarkConfigured(result.recommendation);
    console.log(`[StrictnessAnalyzer] Auto-configured note creation strictness to: ${result.recommendation}`);

    return true;
}
