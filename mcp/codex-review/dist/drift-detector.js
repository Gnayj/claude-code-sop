// Per-file design doc sha drift detection + injection planning.
//
// Spec source: docs/methodology/codex-review-bridge-design.md §4.2
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
export function computeFileSha(content) {
    return createHash("sha256").update(content).digest("hex").slice(0, 8);
}
/**
 * Compare current `inputPaths` (with their on-disk content) against `state.design_doc_files`.
 * Removed = path was tracked in state but missing from inputPaths (or file no longer exists on disk).
 */
export function planDrift(state, inputPaths, resolvePath) {
    const prev = state?.design_doc_files ?? {};
    const seen = new Set();
    const entries = [];
    const nextFiles = {};
    for (const path of inputPaths) {
        seen.add(path);
        const absolute = resolvePath(path);
        if (!existsSync(absolute)) {
            // File explicitly listed in input but missing on disk -> treat as removed-from-current.
            const oldSha = prev[path]?.sha ?? null;
            entries.push({
                path,
                category: oldSha ? "removed" : "added", // never tracked => odd request; classify as added so Codex can correct
                oldSha,
                newSha: null,
                content: null,
            });
            nextFiles[path] = {
                sha: oldSha ?? "",
                exists: false,
                last_seen_at: prev[path]?.last_seen_at ?? new Date().toISOString(),
            };
            continue;
        }
        const content = readFileSync(absolute, "utf8");
        const newSha = computeFileSha(content);
        const oldSha = prev[path]?.sha;
        let category;
        if (oldSha === undefined)
            category = "added";
        else if (oldSha === newSha)
            category = "unchanged";
        else
            category = "modified";
        entries.push({
            path,
            category,
            oldSha: oldSha ?? null,
            newSha,
            content: category === "unchanged" ? null : content,
        });
        nextFiles[path] = {
            sha: newSha,
            exists: true,
            last_seen_at: new Date().toISOString(),
        };
    }
    // Removed: tracked in state but not in this round's input paths.
    for (const oldPath of Object.keys(prev)) {
        if (seen.has(oldPath))
            continue;
        const oldEntry = prev[oldPath];
        if (oldEntry === undefined)
            continue;
        if (!oldEntry.exists) {
            // Already known removed; preserve.
            nextFiles[oldPath] = oldEntry;
            continue;
        }
        entries.push({
            path: oldPath,
            category: "removed",
            oldSha: oldEntry.sha,
            newSha: null,
            content: null,
        });
        nextFiles[oldPath] = {
            sha: oldEntry.sha,
            exists: false,
            last_seen_at: new Date().toISOString(),
        };
    }
    return { entries, nextDesignDocFiles: nextFiles };
}
/** Generate the prompt-prefix announcing drift. Empty string if all unchanged. */
export function renderDriftPreface(plan) {
    const dirty = plan.entries.filter((e) => e.category !== "unchanged");
    if (dirty.length === 0)
        return "";
    const lines = [
        "## Design 文档漂移通报（per-file sha 比对，§4.2）",
    ];
    for (const e of dirty) {
        if (e.category === "modified") {
            lines.push(`- 文件 \`${e.path}\` 已更新（旧 sha=${e.oldSha} → 新 sha=${e.newSha}），新版完整内容如下：`);
            lines.push("```");
            lines.push(e.content ?? "");
            lines.push("```");
        }
        else if (e.category === "added") {
            lines.push(`- 本轮新增 design 文档 \`${e.path}\`（sha=${e.newSha}），完整内容如下：`);
            lines.push("```");
            lines.push(e.content ?? "");
            lines.push("```");
        }
        else if (e.category === "removed") {
            lines.push(`- 文件 \`${e.path}\` 已删除/改名（旧 sha=${e.oldSha}）；从本轮起不再 review 该文件。`);
        }
    }
    return lines.join("\n") + "\n";
}
//# sourceMappingURL=drift-detector.js.map