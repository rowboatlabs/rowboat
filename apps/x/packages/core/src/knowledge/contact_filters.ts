// Local-part aliases that are almost always automated/role addresses you don't
// compose a fresh message to. Matched as a whole segment of the local part
// (segments split on . _ - +).
const AUTOMATED_LOCAL_PARTS = new Set([
    'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'reply',
    'notifications', 'notification', 'notify',
    'alerts', 'alert', 'updates', 'update',
    'news', 'newsletter', 'newsletters',
    'info', 'information', 'hello', 'hi', 'hey',
    'welcome', 'onboarding', 'getstarted',
    'team', 'marketing', 'promo', 'promos', 'promotions',
    'offer', 'offers', 'deals', 'deal',
    'accounts', 'account', 'billing', 'invoices', 'statements', 'statement',
    'learn', 'learning', 'courses',
    'mailer-daemon', 'mailerdaemon', 'postmaster', 'bounce', 'bounces',
    'automated', 'auto', 'autoconfirm',
    'support-bot', 'noticeboard', 'system',
    'contact', 'connect',
    'sender', 'broadcast', 'digest', 'campaign', 'campaigns',
    'support', 'service', 'help', 'helpdesk', 'feedback',
    'mailer', 'mailers', 'members', 'membership',
    'careers', 'jobs', 'recruit', 'recruiting',
    'tickets', 'orders', 'order', 'receipts', 'receipt',
    'applications', 'apply', 'admissions',
    'health', 'security', 'auth',
]);

// Subdomain labels that flag a bulk/marketing infrastructure domain.
const AUTOMATED_SUBDOMAIN_LABELS = new Set([
    'mail', 'mailer', 'mailers', 'mailing', 'mailgun', 'sendgrid', 'mta',
    'email', 'em', 'e', 'm',
    'news', 'newsletter', 'newsletters',
    'marketing', 'mkt', 'promo', 'promos', 'offers',
    'event', 'events', 'ecomm', 'commerce',
    'notifications', 'notification', 'notify', 'alerts', 'alert', 'updates',
    'messaging', 'message', 'msg',
    'noreply', 'donotreply',
    'creators', 'partners', 'team',
    'info', 'welcome', 'hi', 'hello',
    'bounces', 'bounce',
    'reply', 'user', 'usr', 'auto',
]);

// Specific bulk-mail provider domains (substring match on full domain).
const AUTOMATED_DOMAIN_KEYWORDS = [
    'facebookmail', 'kajabimail', 'substack', 'mailgun', 'sendgrid',
    'mcsv.net', 'mailchimp', 'mailerlite', 'createsend', 'cmail',
    'amazonses', 'sparkpost', 'sendinblue', 'brevo',
    'luma-mail', 'lumamail',
    'umusic-online', 'icloud-mail',
];

function localSegments(local: string): string[] {
    return local.toLowerCase().split(/[._\-+]/).filter(Boolean);
}

export function isAutomatedAddress(email: string): boolean {
    if (!email) return true;
    const at = email.indexOf('@');
    if (at < 0) return true;
    const local = email.slice(0, at).toLowerCase();
    const domain = email.slice(at + 1).toLowerCase();

    // Plus-aliased reply bots: `reply+abc123@...`
    if (/^reply\+/i.test(local)) return true;

    // Encoded VERP/list aliases, e.g. long-token-arjun=rowboat...@domain.
    if (local.includes('=') && /^[a-z0-9]{16,}[-+].*=/.test(local)) return true;

    const segs = localSegments(local);
    for (const s of segs) {
        if (AUTOMATED_LOCAL_PARTS.has(s)) return true;
    }

    if (/(no.?reply|do.?not.?reply|notifications?|news.?letter|mailer.?daemon|postmaster|automated|broadcast|statement)/i.test(local)) {
        return true;
    }

    if (local.length >= 20 && /^[a-z0-9=._\-+]+$/.test(local) && /[0-9]/.test(local)) {
        const digits = (local.match(/[0-9]/g) || []).length;
        const letters = (local.match(/[a-z]/g) || []).length;
        if (digits / local.length >= 0.2 || (digits >= 3 && letters >= 12 && !local.includes('.'))) return true;
    }

    const labels = domain.split('.');
    if (labels.length >= 3) {
        const subs = labels.slice(0, -2);
        for (const label of subs) {
            if (AUTOMATED_SUBDOMAIN_LABELS.has(label)) return true;
        }
    }

    for (const kw of AUTOMATED_DOMAIN_KEYWORDS) {
        if (domain.includes(kw)) return true;
    }

    if (/(^|\.)(mailers?|mailer|mailgun|sendgrid|mailchimp|mailerlite|bounces?|marketing|promo|notifications?|newsletter)(\.|$)/i.test(domain)) {
        return true;
    }

    const sld = labels[labels.length - 1];
    if (['email', 'mail', 'marketing', 'promo', 'news', 'newsletter', 'click', 'link'].includes(sld)) {
        return true;
    }

    // Brand-identity addresses like `uber@uber.com`, `lenovo@lenovo.com` -
    // local part equals the first label of the domain. Almost always a
    // transactional/marketing sender.
    if (labels.length >= 2 && local === labels[0]) {
        return true;
    }

    return false;
}
