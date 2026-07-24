const DEFAULT_REDACTION_MARKERS = ['[redacted]', '⟦redacted⟧', '<<REDACTED>>'];
export function redactExactValues(text, values) {
    const uniqueNonEmpty = [...new Set(values.filter((value) => value.length > 0))].sort((left, right) => right.length - left.length || left.localeCompare(right));
    if (uniqueNonEmpty.length === 0) {
        return text;
    }
    let marker = chooseRedactionMarker(uniqueNonEmpty);
    let result = text;
    // Repeated longest-first replacement until no known value remains. Empty-marker
    // fallback guarantees monotone length decrease when a nonempty marker would stall
    // or recreate values across replacement boundaries.
    while (uniqueNonEmpty.some((value) => result.includes(value))) {
        const before = result;
        for (const value of uniqueNonEmpty) {
            result = result.split(value).join(marker);
        }
        if (!uniqueNonEmpty.some((value) => result.includes(value))) {
            break;
        }
        if (result === before || (marker !== '' && result.length >= before.length)) {
            marker = '';
            if (result === before) {
                // Force progress on the next pass with the empty marker.
                continue;
            }
        }
    }
    return result;
}
function chooseRedactionMarker(values) {
    for (const candidate of DEFAULT_REDACTION_MARKERS) {
        if (values.every((value) => !candidate.includes(value))) {
            return candidate;
        }
    }
    return '';
}
