# FLY-0018 — Progressive Skill Guidance

The router returns metadata IDs/version/hashes only; `buildSkillGuide(reader,route,{maxChars?,projectId?,reference?})` loads only those selected specialist bodies after verification. It never reads a broad directory implicitly, executes scripts, or mutates the task board.

The whole SKILL.md is included if within budget. An oversized entry is omitted and returned in `omittedSkillIds` rather than unsafely cutting off a safety rule. Explicit reference requests must stay under `references/`, be declared in the manifest and fit the remaining context budget; no arbitrary filesystem reads. Bundle ID, SHA and version must still match or `SKILL_CONTENT_STALE` is returned.

Project-imported guidance is opt-in and remains advisory. This is a hard boundary: a Skill cannot bypass actual domain approval, QA, report or ownership gates. FLY-0021 integrates the existing shared CLI/HTTP facade. Measure cold-start token/toolcall baseline after integration.
