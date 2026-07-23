export interface AllowlistParseOk {
    ok: true;
    /** Normalized, de-duplicated, byte-sorted path set — the canonical comparison form. */
    canonical: string[];
}
export interface AllowlistParseError {
    ok: false;
    errors: string[];
}
export type AllowlistParseResult = AllowlistParseOk | AllowlistParseError;
/**
 * True when the path is denied by the control plane: any path whose FIRST segment starts
 * with "." (covers .git, .gitignore, .gitattributes, .gitmodules, .mcp.json, .ccsop,
 * .codex-review, .claude, .claude-plugin, .codex, .idea, and every other root dot-path),
 * plus the explicit extra entries.
 */
export declare function isControlPlanePath(normalized: string): boolean;
/**
 * Parse a raw allowlist (tool input or card block lines) into canonical form.
 * Duplicates collapse after normalization; the canonical form is byte-sorted so two
 * lists agree iff their canonical arrays are element-wise identical.
 */
export declare function parseAllowlist(raw: readonly string[]): AllowlistParseResult;
/**
 * Extract the mandatory ```files fenced block from an implement card.
 *
 * Grammar (design §4.2.A): exactly ONE fenced block opened by a line that is exactly
 * "```files" and closed by a line that is exactly "```"; every line inside is one path
 * (blank lines ignored). Fence tracking is line-based; an unclosed block is an error.
 */
export declare function parseFilesBlockFromCard(cardText: string): AllowlistParseResult;
/** Byte-for-byte canonical set equality (design §4.1 card agreement). */
export declare function canonicalSetsEqual(a: readonly string[], b: readonly string[]): boolean;
//# sourceMappingURL=allowlist.d.ts.map