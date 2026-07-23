// Allowlist machine grammar + control-plane denylist + implement-card ```files block parser.
//
// Spec source: docs/design/ccsop-framework/codex-implement-design.md §4.2.A (grammar, r1
// c_allowlist_boundary_undefined), §4.1 (card agreement: byte-for-byte canonical set equality).
//
// v1 admits EXACT regular-file repo-relative POSIX paths only. Everything else — absolute
// paths, traversal, globs, directories, control characters, Windows separators — is a parse
// error, and the always-on denylist (every root dot-path + AGENTS.md + the sync script)
// overrides any allowlist content.
/** Root-anchored non-dot-path entries that are always forbidden regardless of the allowlist. */
const EXTRA_DENY = new Set(["AGENTS.md", "scripts/sync-public.sh"]);
const GLOB_CHARS = /[*?[\]]/;
// Angle brackets are rejected outright (code r1 i_allowlist_canonicalization_is_not_the_declared
// _grammar): shipped-template `<path/...>` placeholders therefore can never parse as real paths.
const ANGLE_CHARS = /[<>]/;
/**
 * True when the path is denied by the control plane: any path whose FIRST segment starts
 * with "." (covers .git, .gitignore, .gitattributes, .gitmodules, .mcp.json, .ccsop,
 * .codex-review, .claude, .claude-plugin, .codex, .idea, and every other root dot-path),
 * plus the explicit extra entries.
 */
export function isControlPlanePath(normalized) {
    const first = normalized.split("/", 1)[0] ?? "";
    if (first.startsWith("."))
        return true;
    return EXTRA_DENY.has(normalized);
}
/** Validate + normalize one candidate path. Returns the error string or null when valid. */
function validatePath(p) {
    if (p.length === 0)
        return "empty path";
    if (p.trim() !== p)
        return `leading/trailing whitespace: ${JSON.stringify(p)}`;
    // Control chars (C0 + DEL) and NUL are never legal in a dispatch path.
    for (const ch of p) {
        const code = ch.codePointAt(0) ?? 0;
        if (code < 0x20 || code === 0x7f) {
            return `control character in path: ${JSON.stringify(p)}`;
        }
    }
    if (p.includes("\\"))
        return `backslash separator (POSIX paths only): ${JSON.stringify(p)}`;
    if (p.startsWith("/"))
        return `absolute path: ${JSON.stringify(p)}`;
    if (/^[A-Za-z]:/.test(p))
        return `drive-letter path: ${JSON.stringify(p)}`;
    if (p.endsWith("/"))
        return `directory (trailing slash): ${JSON.stringify(p)}`;
    if (GLOB_CHARS.test(p))
        return `glob metacharacter: ${JSON.stringify(p)}`;
    if (ANGLE_CHARS.test(p))
        return `angle bracket (template placeholder?): ${JSON.stringify(p)}`;
    const segments = p.split("/");
    if (segments.some((s) => s.length === 0))
        return `empty segment (//): ${JSON.stringify(p)}`;
    if (segments.some((s) => s === "." || s === "..")) {
        return `traversal segment (. or ..): ${JSON.stringify(p)}`;
    }
    if (isControlPlanePath(p))
        return `control-plane path is always forbidden: ${JSON.stringify(p)}`;
    return null;
}
/**
 * Parse a raw allowlist (tool input or card block lines) into canonical form.
 * Duplicates collapse after normalization; the canonical form is byte-sorted so two
 * lists agree iff their canonical arrays are element-wise identical.
 */
export function parseAllowlist(raw) {
    const errors = [];
    const set = new Set();
    for (const entry of raw) {
        const err = validatePath(entry);
        if (err) {
            errors.push(err);
            continue;
        }
        set.add(entry);
    }
    if (raw.length === 0)
        errors.push("allowlist is empty");
    if (errors.length > 0)
        return { ok: false, errors };
    // Canonical order = UTF-8 byte order (declared grammar), not UTF-16 code-unit order.
    const canonical = [...set].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    return { ok: true, canonical };
}
/**
 * Extract the mandatory ```files fenced block from an implement card.
 *
 * Grammar (design §4.2.A): exactly ONE fenced block opened by a line that is exactly
 * "```files" and closed by a line that is exactly "```"; every line inside is one path
 * (blank lines ignored). Fence tracking is line-based; an unclosed block is an error.
 */
export function parseFilesBlockFromCard(cardText) {
    const lines = cardText.split(/\r?\n/);
    const blocks = [];
    let current = null;
    let insideOtherFence = false;
    let otherFenceMarker = "";
    for (const line of lines) {
        if (current !== null) {
            if (line.trim() === "```") {
                blocks.push(current);
                current = null;
            }
            else {
                current.push(line);
            }
            continue;
        }
        if (insideOtherFence) {
            // A closing fence is marker characters ONLY (no info string) — "```files" inside a
            // ``` fence is content, not a close.
            const t = line.trim();
            if ((otherFenceMarker === "```" && /^`{3,}$/.test(t)) ||
                (otherFenceMarker === "~~~" && /^~{3,}$/.test(t))) {
                insideOtherFence = false;
            }
            continue;
        }
        const trimmed = line.trim();
        if (trimmed === "```files") {
            current = [];
        }
        else if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
            // Some other fenced block (code sample etc.) — skip until it closes so a
            // "```files" line inside it is treated as content, not a marker.
            insideOtherFence = true;
            otherFenceMarker = trimmed.startsWith("~~~") ? "~~~" : "```";
        }
    }
    if (current !== null)
        return { ok: false, errors: ["unclosed ```files block"] };
    if (blocks.length === 0) {
        return { ok: false, errors: ["implement card has no ```files block (mandatory, design §4.2.A)"] };
    }
    if (blocks.length > 1) {
        return { ok: false, errors: [`implement card has ${blocks.length} \`\`\`files blocks; exactly one required`] };
    }
    // RAW line validation (code r1): only truly empty lines are skipped; leading/trailing
    // whitespace is a grammar error surfaced by validatePath, never silently trimmed away.
    const paths = blocks[0].filter((l) => l.length > 0);
    return parseAllowlist(paths);
}
/** Byte-for-byte canonical set equality (design §4.1 card agreement). */
export function canonicalSetsEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}
//# sourceMappingURL=allowlist.js.map