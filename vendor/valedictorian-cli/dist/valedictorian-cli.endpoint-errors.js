import { ConnectorOptionQueryHttpError, ConnectorRetirementConflictError, ConnectorScheduleHttpError, LocalSecretResolutionHttpError, ProfileDocumentHttpError, ValedictorianHttpError, ValedictorianProtocolError, careerSourceErrorBodySchema, careerSourceErrorKindByCode, careerSourceErrorStatusByCode, connectorOptionQueryErrorBodySchema, connectorOptionQueryErrorCodes, connectorOptionQueryErrorKindByCode, connectorOptionQueryErrorStatusByCode, connectorRetirementActiveWorkConflictKind, connectorRetirementActiveWorkConflictSchema, connectorRetirementActiveWorkConflictStatus, connectorScheduleErrorBodySchema, connectorScheduleErrorCodes, connectorScheduleErrorKindByCode, connectorScheduleErrorStatusByCode, localSecretResolutionErrorBodySchema, localSecretResolutionErrorCodes, localSecretResolutionErrorKindByCode, localSecretResolutionErrorStatusByCode, profileDocumentErrorBodySchema, profileDocumentErrorCodes, profileDocumentErrorKindByCode, profileDocumentErrorStatusByCode, sourceAccessErrorBodySchema, sourceAccessErrorKindByCode, sourceAccessErrorStatusByCode, sourceBrowseErrorBodySchema, sourceBrowseErrorKindByCode, sourceBrowseErrorStatusByCode, sourceInfrastructureErrorBodySchema, sourceInfrastructureErrorKindByCode, sourceInfrastructureErrorStatusByCode, sourceProbeErrorBodySchema, sourceProbeErrorKindByCode, sourceProbeErrorStatusByCode, sourceRuleErrorBodySchema, sourceRuleErrorKindByCode, sourceRuleErrorStatusByCode, sourceRunErrorBodySchema, sourceRunErrorKindByCode, sourceRunErrorStatusByCode, sourceScheduleErrorBodySchema, sourceScheduleErrorKindByCode, sourceScheduleErrorStatusByCode, validateValedictorianEndpointError, valedictorianInternalErrorBodySchema, valedictorianInternalErrorCode, valedictorianInternalErrorKind, valedictorianInternalErrorStatus, valedictorianSafeRequestFailedMessage, } from '@sparxie/sdk';
function httpErrorFromBody(body, status, kind) {
    return new ValedictorianHttpError({
        body,
        kind,
        message: body.message,
        status,
        ...(body.requestId !== undefined ? { requestId: body.requestId } : {}),
    });
}
function matchedResult(body, status, kind, error) {
    return {
        code: body.code,
        kind,
        status,
        message: body.message,
        error,
        ...(body.requestId !== undefined ? { requestId: body.requestId } : {}),
        ...(body.path !== undefined ? { path: body.path } : {}),
        ...(body.line !== undefined ? { line: body.line } : {}),
        ...(body.column !== undefined ? { column: body.column } : {}),
    };
}
function tryValidate(body, status, spec, toError) {
    const validated = validateValedictorianEndpointError({
        body,
        status,
        spec: spec,
    });
    if (validated.ok) {
        const error = toError(validated.body, validated.status, validated.kind);
        const matchedBody = validated.body;
        return {
            ok: true,
            matched: matchedResult(matchedBody, validated.status, validated.kind, error),
        };
    }
    if (validated.reason === 'status_mismatch') {
        return { ok: false, reason: 'protocol' };
    }
    return { ok: false, reason: 'none' };
}
/** Cross-cutting auth bodies accepted on every generic surface. */
const sharedAccessTry = (body, status) => tryValidate(body, status, {
    bodySchema: sourceAccessErrorBodySchema,
    statusByCode: sourceAccessErrorStatusByCode,
    kindByCode: sourceAccessErrorKindByCode,
}, (parsed, parsedStatus, kind) => httpErrorFromBody(parsed, parsedStatus, kind));
function trySharedInternal(body, status) {
    const internal = valedictorianInternalErrorBodySchema.safeParse(body);
    if (internal.success) {
        if (status !== valedictorianInternalErrorStatus) {
            return { ok: false, reason: 'protocol' };
        }
        const error = new ValedictorianHttpError({
            body: internal.data,
            kind: valedictorianInternalErrorKind,
            message: internal.data.message,
            requestId: internal.data.requestId,
            status,
        });
        return {
            ok: true,
            matched: matchedResult(internal.data, status, valedictorianInternalErrorKind, error),
        };
    }
    if (typeof body === 'object'
        && body !== null
        && 'code' in body
        && body.code === valedictorianInternalErrorCode) {
        return { ok: false, reason: 'protocol' };
    }
    return { ok: false, reason: 'none' };
}
const capabilityCatalog = [
    (body, status) => tryValidate(body, status, {
        bodySchema: profileDocumentErrorBodySchema,
        statusByCode: profileDocumentErrorStatusByCode,
        kindByCode: profileDocumentErrorKindByCode,
    }, (parsed, parsedStatus) => new ProfileDocumentHttpError(parsed, parsedStatus)),
    (body, status) => tryValidate(body, status, {
        bodySchema: localSecretResolutionErrorBodySchema,
        statusByCode: localSecretResolutionErrorStatusByCode,
        kindByCode: localSecretResolutionErrorKindByCode,
        supportsRetryAfter: true,
    }, (parsed, parsedStatus) => new LocalSecretResolutionHttpError(parsed, parsedStatus)),
    (body, status) => tryValidate(body, status, {
        bodySchema: connectorScheduleErrorBodySchema,
        statusByCode: connectorScheduleErrorStatusByCode,
        kindByCode: connectorScheduleErrorKindByCode,
    }, (parsed, parsedStatus) => new ConnectorScheduleHttpError(parsed, parsedStatus)),
    (body, status) => tryValidate(body, status, {
        bodySchema: connectorOptionQueryErrorBodySchema,
        statusByCode: connectorOptionQueryErrorStatusByCode,
        kindByCode: connectorOptionQueryErrorKindByCode,
    }, (parsed, parsedStatus) => new ConnectorOptionQueryHttpError(parsed, parsedStatus)),
    (body, status) => tryValidate(body, status, {
        bodySchema: sourceBrowseErrorBodySchema,
        statusByCode: sourceBrowseErrorStatusByCode,
        kindByCode: sourceBrowseErrorKindByCode,
    }, (parsed, parsedStatus, kind) => httpErrorFromBody(parsed, parsedStatus, kind)),
    (body, status) => tryValidate(body, status, {
        bodySchema: sourceInfrastructureErrorBodySchema,
        statusByCode: sourceInfrastructureErrorStatusByCode,
        kindByCode: sourceInfrastructureErrorKindByCode,
        supportsRetryAfter: true,
    }, (parsed, parsedStatus, kind) => httpErrorFromBody(parsed, parsedStatus, kind)),
    (body, status) => tryValidate(body, status, {
        bodySchema: sourceProbeErrorBodySchema,
        statusByCode: sourceProbeErrorStatusByCode,
        kindByCode: sourceProbeErrorKindByCode,
    }, (parsed, parsedStatus, kind) => httpErrorFromBody(parsed, parsedStatus, kind)),
    (body, status) => tryValidate(body, status, {
        bodySchema: sourceRuleErrorBodySchema,
        statusByCode: sourceRuleErrorStatusByCode,
        kindByCode: sourceRuleErrorKindByCode,
    }, (parsed, parsedStatus, kind) => httpErrorFromBody(parsed, parsedStatus, kind)),
    (body, status) => tryValidate(body, status, {
        bodySchema: sourceRunErrorBodySchema,
        statusByCode: sourceRunErrorStatusByCode,
        kindByCode: sourceRunErrorKindByCode,
    }, (parsed, parsedStatus, kind) => httpErrorFromBody(parsed, parsedStatus, kind)),
    (body, status) => tryValidate(body, status, {
        bodySchema: sourceScheduleErrorBodySchema,
        statusByCode: sourceScheduleErrorStatusByCode,
        kindByCode: sourceScheduleErrorKindByCode,
    }, (parsed, parsedStatus, kind) => httpErrorFromBody(parsed, parsedStatus, kind)),
    (body, status) => tryValidate(body, status, {
        bodySchema: careerSourceErrorBodySchema,
        statusByCode: careerSourceErrorStatusByCode,
        kindByCode: careerSourceErrorKindByCode,
    }, (parsed, parsedStatus, kind) => httpErrorFromBody(parsed, parsedStatus, kind)),
];
function tryRetirement(body, status) {
    const retirement = connectorRetirementActiveWorkConflictSchema.safeParse(body);
    if (retirement.success) {
        if (status !== connectorRetirementActiveWorkConflictStatus) {
            return { ok: false, reason: 'protocol' };
        }
        const error = new ConnectorRetirementConflictError(retirement.data);
        return {
            ok: true,
            matched: matchedResult({
                code: 'connector_retirement_active_work_conflict',
                message: retirement.data.message,
            }, status, connectorRetirementActiveWorkConflictKind, error),
        };
    }
    return { ok: false, reason: 'none' };
}
/** Capability-owned catalogs that must never be treated as authoritative off-surface. */
const foreignCapabilityTries = [
    ...capabilityCatalog,
    tryRetirement,
];
/** Per-surface declared closed codes (in addition to shared internal + shared access). */
const surfaceDeclaredTries = {
    // Workspace admin routes declare no capability-owned codes beyond shared.
    workspace: [],
};
function firstMatch(tries, body, status) {
    let sawProtocol = false;
    for (const tryEndpoint of tries) {
        const result = tryEndpoint(body, status);
        if (result.ok)
            return result;
        if (result.reason === 'protocol')
            sawProtocol = true;
    }
    if (sawProtocol)
        return { ok: false, reason: 'protocol' };
    return { ok: false, reason: 'none' };
}
/** Closed set of every public error code the CLI knows how to validate authoritatively. */
const knownPublicErrorCodes = new Set([
    valedictorianInternalErrorCode,
    'connector_retirement_active_work_conflict',
    ...profileDocumentErrorCodes,
    ...localSecretResolutionErrorCodes,
    ...connectorScheduleErrorCodes,
    ...connectorOptionQueryErrorCodes,
    ...Object.keys(sourceAccessErrorStatusByCode),
    ...Object.keys(sourceBrowseErrorStatusByCode),
    ...Object.keys(sourceInfrastructureErrorStatusByCode),
    ...Object.keys(sourceProbeErrorStatusByCode),
    ...Object.keys(sourceRuleErrorStatusByCode),
    ...Object.keys(sourceRunErrorStatusByCode),
    ...Object.keys(sourceScheduleErrorStatusByCode),
    ...Object.keys(careerSourceErrorStatusByCode),
]);
function advertisesKnownPublicErrorCode(body) {
    return (typeof body === 'object'
        && body !== null
        && 'code' in body
        && typeof body.code === 'string'
        && knownPublicErrorCodes.has(body.code));
}
export function matchPublicEndpointError(body, status, surface) {
    const sharedInternal = trySharedInternal(body, status);
    if (sharedInternal.ok || sharedInternal.reason === 'protocol') {
        return sharedInternal;
    }
    const sharedAccess = sharedAccessTry(body, status);
    if (sharedAccess.ok || sharedAccess.reason === 'protocol') {
        return sharedAccess;
    }
    const declared = firstMatch(surfaceDeclaredTries[surface], body, status);
    if (declared.ok || declared.reason === 'protocol') {
        return declared;
    }
    // Known public capability body for a different surface => protocol, never preserve.
    const foreign = firstMatch(foreignCapabilityTries, body, status);
    if (foreign.ok || foreign.reason === 'protocol') {
        return { ok: false, reason: 'protocol' };
    }
    // Recognized public code whose body failed its authoritative schema => protocol.
    // Truly unknown malformed bodies remain generic fail-closed.
    if (advertisesKnownPublicErrorCode(body)) {
        return { ok: false, reason: 'protocol' };
    }
    return { ok: false, reason: 'none' };
}
export function createFailClosedRequestError(status, responseBody, surface) {
    const matched = matchPublicEndpointError(responseBody, status, surface);
    if (matched.ok) {
        return matched.matched.error;
    }
    if (matched.reason === 'protocol') {
        return new ValedictorianProtocolError();
    }
    return new ValedictorianHttpError({
        body: null,
        message: valedictorianSafeRequestFailedMessage,
        status,
    });
}
