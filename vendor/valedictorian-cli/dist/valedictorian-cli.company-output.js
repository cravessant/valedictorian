const maximumHumanItems = 20;
export function formatCompanyHumanOutput(record, collectionOutput) {
    if (isCompanyMutationResult(record))
        return formatCompanyMutation(record);
    if (isMarkedDistinctResult(record))
        return formatMarkedDistinct(record);
    if (isReassignmentResult(record))
        return formatReassignment(record);
    if (isDuplicateCandidate(record))
        return `Duplicate candidate: ${formatDuplicateCandidate(record)}`;
    if (isJobCompanyAssignment(record))
        return `Job Company assignment: ${formatAssignedJob(record)}`;
    if (isCompanyDetail(record))
        return formatCompanyDetail(record);
    if (isCompanyLookup(record))
        return formatCompanyLookup(record, 'Company lookup');
    if (!Array.isArray(record.items))
        return null;
    if (record.items.length === 0 && collectionOutput) {
        return formatEmptyCompanyCollection(record, collectionOutput);
    }
    const first = record.items[0];
    if (isCompanyMatchPreview(first))
        return formatCompanyMatchPreview(record);
    if (typeof record.truncated === 'boolean')
        return formatCompanySearch(record);
    if (!isPlainRecord(first)) {
        return isPlainRecord(record.pageInfo) && typeof record.totalCount === 'number'
            ? formatCompanyPage('Company page', record, () => 'No items')
            : null;
    }
    if (isPlainRecord(first.left) && isPlainRecord(first.right)) {
        return formatCompanyPage('Duplicate candidates', record, formatDuplicateCandidate);
    }
    if (isPlainRecord(first.workspaceCompany) && primitiveString(first.jobId)) {
        return formatCompanyPage('Assigned Jobs', record, formatAssignedJob);
    }
    if (primitiveString(first.eventId) && primitiveString(first.companyId)) {
        return formatCompanyPage('Company history', record, formatCompanyHistory);
    }
    if (primitiveString(first.canonicalCompanyId)) {
        return formatCompanyPage('Company directory', record, formatDirectoryCompany);
    }
    if (primitiveString(first.companyId) && primitiveString(first.displayName)) {
        return formatCompanySearch(record);
    }
    return null;
}
function formatEmptyCompanyCollection(record, collectionOutput) {
    if (collectionOutput === 'match-preview')
        return formatCompanyMatchPreview(record);
    const formats = {
        'assigned-jobs': { title: 'Assigned Jobs', item: formatAssignedJob },
        directory: { title: 'Company directory', item: formatDirectoryCompany },
        duplicates: { title: 'Duplicate candidates', item: formatDuplicateCandidate },
        history: { title: 'Company history', item: formatCompanyHistory },
    };
    const format = formats[collectionOutput];
    return formatCompanyPage(format.title, record, format.item);
}
function isCompanyDetail(record) {
    return isPlainRecord(record.lookup)
        && typeof record.assignedJobCount === 'number'
        && isPlainRecord(record.history);
}
function isCompanyLookup(record) {
    return isPlainRecord(record.requested) && isPlainRecord(record.canonical);
}
function isCompanyMutationResult(record) {
    return (['created', 'updated', 'archived', 'restored'].includes(primitiveString(record.status) ?? '')
        && primitiveString(record.companyId) !== undefined
        && isPlainRecord(record.company));
}
function isMarkedDistinctResult(record) {
    return primitiveString(record.status) === 'marked_distinct' && isDuplicateCandidate(record.candidate);
}
function isReassignmentResult(record) {
    return primitiveString(record.status) === 'reassigned' && isJobCompanyAssignment(record.assignment);
}
function isDuplicateCandidate(value) {
    return (isPlainRecord(value)
        && primitiveString(value.candidateId) !== undefined
        && primitiveString(value.candidateRevision) !== undefined
        && isPlainRecord(value.left)
        && isPlainRecord(value.right)
        && primitiveString(value.score) !== undefined
        && primitiveString(value.status) !== undefined);
}
function isJobCompanyAssignment(value) {
    return (isPlainRecord(value)
        && primitiveString(value.jobId) !== undefined
        && primitiveString(value.assignmentRevision) !== undefined
        && isPlainRecord(value.workspaceCompany));
}
function isCompanyMatchPreview(value) {
    return (isPlainRecord(value)
        && primitiveString(value.companyId) !== undefined
        && primitiveString(value.revision) !== undefined
        && primitiveString(value.displayName) !== undefined
        && typeof value.score === 'number'
        && Array.isArray(value.reasons));
}
function formatCompanyMutation(record) {
    const company = record.company;
    return [
        `Company ${String(record.status)}: ${formatCompanyIdentity(company)}`,
        `Request revision: ${String(record.requestCompanyRevision)}`,
    ].join('\n');
}
function formatMarkedDistinct(record) {
    const candidate = record.candidate;
    return [
        `Duplicate candidate marked distinct: ${formatDuplicateCandidate(candidate)}`,
        `Request revisions: candidate=${String(record.requestCandidateRevision)} left=${String(record.requestLeftCompanyRevision)} right=${String(record.requestRightCompanyRevision)}`,
    ].join('\n');
}
function formatReassignment(record) {
    const assignment = record.assignment;
    return [
        `Job reassigned: ${formatAssignedJob(assignment)}`,
        `Request revisions: assignment=${String(record.requestAssignmentRevision)} destination-company=${String(record.requestDestinationCompanyRevision)}`,
    ].join('\n');
}
function formatCompanyDetail(record) {
    const lookup = record.lookup;
    const history = record.history;
    const lines = formatLookupLines(lookup, 'Company');
    lines.push(`Assigned Jobs: ${String(record.assignedJobCount)}`);
    lines.push(`Open duplicate candidates: ${String(record.openDuplicateCandidateCount)}`);
    lines.push(`History: ${String(history.eventCount)} events; last=${String(history.lastEventAt)}`);
    return lines.join('\n');
}
function formatCompanyLookup(record, heading) {
    return formatLookupLines(record, heading).join('\n');
}
function formatLookupLines(record, heading) {
    const requested = record.requested;
    const canonical = record.canonical;
    const lines = [`${heading}: ${formatCompanyIdentity(requested)}`];
    lines.push(`Canonical: ${formatCompanyIdentity(canonical)}`);
    lines.push(`Redirect path: ${formatIds(record.redirectPath)}`);
    const aliases = Array.isArray(requested.aliases) ? requested.aliases : [];
    if (aliases.length > 0)
        lines.push(`Aliases: ${formatAliases(aliases)}`);
    return lines;
}
function formatCompanySearch(record) {
    const items = record.items;
    const suffix = record.truncated === true ? ' (truncated)' : '';
    const lines = [`Company search: ${items.length} result${items.length === 1 ? '' : 's'}${suffix}`];
    lines.push(...formatBoundedItems(items, formatSearchCompany));
    return lines.join('\n');
}
function formatCompanyMatchPreview(record) {
    const items = record.items;
    const suffix = record.truncated === true ? ' (truncated)' : '';
    const lines = [`Company match preview: ${items.length} result${items.length === 1 ? '' : 's'}${suffix}`];
    lines.push(...formatBoundedItems(items, formatCompanyMatchPreviewItem));
    return lines.join('\n');
}
function formatCompanyMatchPreviewItem(company) {
    return `${formatCompanyIdentity(company)} score=${String(company.score)} reasons=${formatReasons(company.reasons)}`;
}
function formatCompanyPage(title, record, formatItem) {
    const items = record.items;
    const total = typeof record.totalCount === 'number' ? record.totalCount : items.length;
    const lines = [`${title}: ${items.length} page item${items.length === 1 ? '' : 's'}; total=${total}`];
    lines.push(...formatBoundedItems(items, formatItem));
    lines.push(...formatKeysetPageInfo(record, total));
    return lines.join('\n');
}
function formatBoundedItems(items, formatItem) {
    const shown = items.slice(0, maximumHumanItems).flatMap((item) => isPlainRecord(item) ? [`- ${formatItem(item)}`] : []);
    if (items.length > maximumHumanItems) {
        shown.push(`Showing first ${maximumHumanItems} items from this page.`);
    }
    return shown;
}
function formatKeysetPageInfo(record, total) {
    if (!isPlainRecord(record.pageInfo))
        return [`Total: ${total}`];
    const page = record.pageInfo;
    return [
        `Page: total=${total} start=${String(page.startCursor)} end=${String(page.endCursor)} previous=${String(page.hasPreviousPage)} next=${String(page.hasNextPage)}`,
    ];
}
function formatSearchCompany(company) {
    return `${formatCompanyIdentity(company)} assigned-jobs=${String(company.assignedJobCount)}`;
}
function formatDirectoryCompany(company) {
    return `${formatCompanyIdentity(company)} canonical=${String(company.canonicalCompanyId)} assigned-jobs=${String(company.assignedJobCount)} open-duplicates=${String(company.openDuplicateCandidateCount)} updated=${String(company.updatedAt)}`;
}
function formatDuplicateCandidate(candidate) {
    return `candidate=${String(candidate.candidateId)} revision=${String(candidate.candidateRevision)} status=${String(candidate.status)} score=${String(candidate.score)} reasons=${formatReasons(candidate.reasons)}; left=${formatSearchCompany(candidate.left)}; right=${formatSearchCompany(candidate.right)}`;
}
function formatAssignedJob(job) {
    const company = job.workspaceCompany;
    return `job=${String(job.jobId)} assignment-revision=${String(job.assignmentRevision)} role=${String(job.roleTitle)} facts-company=${String(job.jobFactsCompanyName)} company=${formatCompanyIdentity(company)} names-differ=${String(job.namesDiffer)}`;
}
function formatCompanyHistory(event) {
    const actor = isPlainRecord(event.actor) ? event.actor : {};
    const change = isPlainRecord(event.change) ? event.change : {};
    const changed = Array.isArray(change.changedFields) ? change.changedFields.join(', ') : 'none';
    return `event=${String(event.eventId)} kind=${String(event.kind)} company=${String(event.companyId)} revision=${String(event.companyRevision)} at=${String(event.occurredAt)} actor=${String(actor.type)}:${String(actor.id)} changed=${changed}`;
}
function formatCompanyIdentity(company) {
    const website = primitiveString(company.websiteUrl) ?? primitiveString(company.websiteHost);
    const status = primitiveString(company.status);
    const parts = [
        String(company.displayName),
        `id=${String(company.id ?? company.companyId)}`,
        `revision=${String(company.revision)}`,
    ];
    if (status)
        parts.push(`status=${status}`);
    if (website)
        parts.push(`website=${website}`);
    return parts.join(' ');
}
function formatAliases(aliases) {
    const values = aliases.slice(0, maximumHumanItems).flatMap((alias) => isPlainRecord(alias) ? [`${String(alias.value)} (id=${String(alias.id)})`] : []);
    if (aliases.length > maximumHumanItems)
        values.push(`+${aliases.length - maximumHumanItems} more`);
    return values.join(', ');
}
function formatReasons(value) {
    if (!Array.isArray(value))
        return 'none';
    const reasons = value.slice(0, maximumHumanItems).flatMap((reason) => {
        if (!isPlainRecord(reason))
            return [];
        const code = primitiveString(reason.code);
        const label = primitiveString(reason.label);
        if (!code)
            return [];
        return [label ? `${code} (${label})` : code];
    });
    if (value.length > maximumHumanItems)
        reasons.push(`+${value.length - maximumHumanItems} more`);
    return reasons.join(', ') || 'none';
}
function formatIds(value) {
    if (!Array.isArray(value))
        return 'none';
    const ids = value.slice(0, maximumHumanItems).map(String);
    if (value.length > maximumHumanItems)
        ids.push(`+${value.length - maximumHumanItems} more`);
    return ids.join(' -> ') || 'none';
}
function isPlainRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function primitiveString(value) {
    return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : undefined;
}
