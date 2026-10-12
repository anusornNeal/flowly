# FLY-0023 — Skill Provenance and Report Integration

The guidance provenance adapter writes **explicit, bounded** selection or corroborated action references to the existing immutable `audit_log` through `SkillProvenance.record`. It does not add a second implementation report store or assert that an unverified action happened.

A record includes project/task, actor/channel, Skill ID, exact version/hash, router reason code, intended operation and optional source Activity ID, session ID, full Git hash and evidence **identifiers only**. An operation that mutates state must link to a previous authoritative audit record by the **same actor** with matching operation. Guide/route/next/preview-only selections have status `selected` rather than "executed". Raw request payloads, secrets, screenshots, markdown bodies and Git diffs are never logged.

`skills.audit.record` is an explicit user/agent action, `skills.audit.list` a bounded read-only query, `skills.audit.report` joins the existing authoritative engineering Decision/Implementation metadata and commit hashes without copying reports into another database.

A claim of selection does **not** grant permission to bypass QA, review or an engineering gate. Project/task isolation, trustworthy Skill version pinning and actor correlation are enforced at write time.
