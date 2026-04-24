---
title: "feat: Marketing Expert System — Skills, Security, Workspace, Automation"
type: feat
status: active
date: 2026-04-22
origin: docs/brainstorms/marketing-expert-system-requirements.md
---

# feat: Marketing Expert System — Skills, Security, Workspace, Automation

## Overview

Transform the marketing-staff expert from a monolithic, insecure prototype into a production-ready TikTok marketing assistant. Nine changes across security, architecture, automation, and UX: extract skills from SOUL.md, fix credential leakage, redesign workspace files, add auto-publish automation, encrypt API keys, and improve first-use experience.

Builds on top of the Expert System foundation from [004-feat-expert-system-plan](2026-04-15-004-feat-expert-system-plan.md).

## Problem Frame

The marketing-staff expert works for demos but has systemic issues blocking production use: all workflow logic lives in a single 2.9K-token SOUL.md, agent creation copies plaintext API keys to every expert directory, workspace files waste tokens with irrelevant content, and users must manually navigate to the expert every time. There's no automation pipeline, no content safety checks, and API keys require manual user configuration. (see origin: `docs/brainstorms/marketing-expert-system-requirements.md`)

## Requirements Trace

- R1. Security: No runtime files (models.json/auth-profiles.json) copied to expert agent directories
- R2. Security: API keys encrypted at rest via Electron safeStorage, never plaintext in config
- R3. Architecture: 5 skills extracted from monolithic SOUL.md (product-scout, video-maker, content-craft, tiktok-publish, auto-publish-pipeline)
- R4. Architecture: New plugin tool sparkboost_video_compliance for content safety
- R5. Workspace: SOUL.md condensed from ~2.9K to ~0.5K tokens after skill extraction
- R6. Workspace: TOOLS.md and USER.md created with relevant content for expert agents
- R7. UX: Expert auto-loads when it's the only enabled expert (smart routing)
- R8. UX: Chat language follows USER.md language setting (auto-detected from interface)
- R9. UX: First-time users see structured welcome with prerequisite check (shops connected?)
- R10. Automation: Cron-triggered pipeline processes all products across all shops
- R11. Automation: Pipeline crash recovery via state file (resume from last completed product)
- R12. Automation: Compliance check blocks non-compliant videos from publishing
- R13. Migration: Manifest version field triggers bootstrap re-write for existing agents

## Scope Boundaries

- No performance analytics (no API endpoint yet)
- No cross-platform publishing (TikTok only)
- No skill i18n (system instructions stay in Chinese, output language follows USER.md)
- No multi-agent orchestration
- No notification channel setup UI (uses existing OpenClaw channels)
- No API key build pipeline implementation details (separate discussion)

### Deferred to Separate Tasks

- SparkBoost analytics API validation (TODOS.md R4 — blocked on API availability)
- Cron delivery output format standardization (TODOS.md R1 — separate UX discussion)
- Multi-agent pivot timeline (strategic decision, not implementation)

## Context & Research

### Relevant Code and Patterns

- **Expert init**: `electron/utils/expert-init.ts` — `initializeExperts()`, `writeExpertBootstrapFiles()`, `writeExpertMarker()`, `findExistingExpertAgent()`
- **Agent config**: `electron/utils/agent-config.ts` — `createAgent(name, opts)`, `provisionAgentFilesystem()`, `copyRuntimeFiles()`, `AGENT_RUNTIME_FILES`
- **SparkBoost plugin**: `resources/openclaw-plugins/sparkboost/src/index.ts` — `definePluginEntry()`, `api.registerTool()`, 7 existing tools
- **SparkBoost client**: `resources/openclaw-plugins/sparkboost/src/sparkboost-client.ts` — `secret-key` header on all requests, `X-Api-Key` on `/api/` paths only
- **Plugin manifest**: `resources/openclaw-plugins/sparkboost/openclaw.plugin.json` — `configSchema`, `uiHints`, `skills: ["./skills"]`
- **Existing skill**: `resources/openclaw-plugins/sparkboost/skills/tiktok-publisher/SKILL.md` — to be replaced by 5 new skills
- **Expert manifest**: `resources/experts/preinstalled-manifest.json` — 3 experts, marketing-staff has `requiredSkills: []`
- **Secret storage**: `electron/services/secrets/secret-store.ts` — `ElectronStoreSecretStore` stores as plaintext JSON
- **Session switching**: `src/pages/Experts/index.tsx:105-113` — `handleStartExpert()` calls `switchSession()` + `navigate('/')`
- **Chat store**: `src/stores/chat/session-actions.ts:155-188` — `switchSession(key)` clears state and loads history
- **Cron store**: `src/stores/cron.ts` — CRUD via HTTP API, execution in Gateway process
- **Cron types**: `src/types/cron.ts` — `CronSchedule` union, `CronJob` with `delivery.mode: 'none' | 'announce'`

### Institutional Learnings

- Expert marker pattern (`EXPERT_ID` file) avoids database lookups but is written after `createAgent()` returns — cannot be used for detection inside `provisionAgentFilesystem()`
- Plugin-bundled SKILL.md files focus on workflow orchestration and decision boundaries; Plugin handles deterministic execution (HTTP, validation, trust boundary wrapping)
- `safeStorage` is available but unused — any encrypted storage work is new infrastructure
- Stale agent cleanup already exists for agents matching `/^agent(-\d+)?$/` pattern
- `electron-store` stores all data as unencrypted JSON in `~/Library/Application Support/BoostClaw/`

### External References

- Electron safeStorage API: `electron.safeStorage.encryptString()` / `decryptString()` — uses OS keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux)

## Key Technical Decisions

1. **`skipRuntimeFiles` flag over marker detection** — EXPERT_ID is written after `createAgent()` returns, so `provisionAgentFilesystem()` cannot check for it. A flag in the options is the only clean approach. (see origin Section 3)
2. **Manifest version field over hash comparison** — Version bumps are explicit and intentional. Hash-based comparison would be fragile (whitespace, encoding). (see origin Section 8)
3. **Additive workspace files** — Expert agents currently have only SOUL.md + IDENTITY.md. TOOLS.md and USER.md are new files, not replacements. No files to delete. (see origin Section 2)
4. **safeStorage over alternatives** — Uses OS-native keychain, zero additional dependencies. Alternatives (keytar, custom encryption) add complexity without benefit. (see origin Section 7)
5. **Interactive chat guard for auto-publish** — OpenClaw loads all requiredSkills regardless of trigger type. Rather than building conditional skill loading, accept that the pipeline can run from chat with a confirmation guard. (see origin Section 1.5)
6. **Pipeline state as JSON file** — Simple, portable, no database dependency. Written after each product completes. Deleted after full run succeeds. (see origin Section 1.5)
7. **No plaintext key fallback** — R2 requires keys encrypted at rest. If safeStorage is unavailable (rare: Linux without libsecret), the marketing expert enters limited mode rather than storing plaintext. No security exceptions. (see origin Section 7)
8. **TOOLS.md scoped to marketing-staff only** — Only marketing-staff uses SparkBoost tools. Other experts (cross-border-video-expert, content-writing-expert) should not get SparkBoost TOOLS.md during re-bootstrap. Write TOOLS.md conditionally based on expert ID.

## Open Questions

### Resolved During Planning

- How to detect expert agents at copy-runtime-files time? → `skipRuntimeFiles` flag (see decision 1 above)
- What happens to existing expert agents when SOUL.md changes? → Manifest version triggers re-write (see decision 2 above)
- How to enforce "cron-only" mode for auto-publish pipeline? → Interactive chat guard instead (see decision 5 above)
- Where do API keys live at rest? → Encrypted via safeStorage, not plaintext in openclaw.json (see decision 4 above)

### Deferred to Implementation

- Exact SparkBoost compliance API endpoint and parameters — API exists but endpoint details need verification at implementation time
- Pipeline state file location — likely agent workspace or agent dir, decided during implementation
- USER.md language detection: exact mechanism to read BoostClaw interface locale from Electron main process — renderer sends locale via IPC or manifest reads at init time
- welcomeMessage language update: whether to store bilingual welcome messages in manifest or generate dynamically

## Output Structure

```
resources/openclaw-plugins/sparkboost/
├── skills/
│   ├── tiktok-publisher/SKILL.md          ← DELETE
│   ├── product-scout/SKILL.md             ← NEW
│   ├── video-maker/SKILL.md               ← NEW
│   ├── content-craft/SKILL.md             ← NEW
│   ├── tiktok-publish/SKILL.md            ← NEW
│   └── auto-publish-pipeline/SKILL.md     ← NEW
└── src/
    └── index.ts                           ← MODIFY (add compliance tool)
```

## Implementation Units

### Phase 1: Security Foundation

- [ ] **Unit 1: Skip runtime file copy for expert agents**

**Goal:** Prevent models.json and auth-profiles.json from being copied to expert agent directories, and clean up existing copies.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `electron/utils/agent-config.ts`
- Modify: `electron/utils/expert-init.ts`
- Test: `electron/__tests__/agent-config.test.ts` (create if needed)

**Approach:**
- Extend `createAgent()` options type with `skipRuntimeFiles?: boolean`
- **Also extend `provisionAgentFilesystem()` options type** (`{ inheritWorkspace?: boolean }` at line 426) to include `skipRuntimeFiles?: boolean`
- **Update the pass-through** at `createAgent()` line 650: change `{ inheritWorkspace: options?.inheritWorkspace }` to `{ inheritWorkspace: options?.inheritWorkspace, skipRuntimeFiles: options?.skipRuntimeFiles }`
- In `provisionAgentFilesystem()`, check `options.skipRuntimeFiles` before calling `copyRuntimeFiles()`
- In `initializeExperts()`, pass `skipRuntimeFiles: true` to `createAgent()`
- Add cleanup: after finding existing expert agents, delete `models.json` and `auth-profiles.json` from their agent dirs if present. Use `try/catch` with ENOENT tolerance for concurrent cleanup races.

**Patterns to follow:**
- Existing option extension pattern: `createAgent(name, { inheritWorkspace?: boolean })` at `agent-config.ts:608`
- File cleanup pattern: `removeAgentWorkspaceDirectory()` in `expert-init.ts`

**Test scenarios:**
- Happy path: `createAgent('test', { skipRuntimeFiles: true })` does NOT create models.json in agent dir
- Happy path: `createAgent('test')` (no flag) DOES create models.json (backward compat)
- Edge case: Existing expert agent dirs get models.json/auth-profiles.json removed during `initializeExperts()`
- Edge case: Main agent's models.json is never touched by cleanup
- Edge case: Concurrent initializeExperts calls — second cleanup of already-deleted files does not throw (ENOENT tolerant)

**Verification:**
- After running `initializeExperts()`, no expert agent directory contains `models.json` or `auth-profiles.json`
- Regular agent creation still copies runtime files as before

---

### Phase 2: Infrastructure

- [ ] **Unit 2: Manifest versioning and migration**

**Goal:** Add version field to expert manifest entries and extend EXPERT_ID marker to store version, so bootstrap files can be re-written when manifest changes.

**Requirements:** R13

**Dependencies:** None (independent of Unit 1)

**Files:**
- Modify: `electron/utils/expert-init.ts`
- Modify: `resources/experts/preinstalled-manifest.json`
- Test: `electron/__tests__/expert-init.test.ts` (create if needed)

**Approach:**
- Add `version?: number` to `ExpertManifestEntry` type (default 1 if absent)
- Update `writeExpertMarker()` to write `expertId\nversion` format
- **Critical:** Update `findExistingExpertAgent()` matching logic — change `marker === expertId` to `marker.split('\n')[0] === expertId` so it correctly matches both old format (`marketing-staff`) and new format (`marketing-staff\n2`)
- Update `readExpertMarker()` to parse version: split on `\n`, first line is expertId, second line (if present) is version number, absent = version 0
- In `initializeExperts()`, when an existing expert agent is found, compare stored version with manifest version. If stored < manifest, re-run `writeExpertBootstrapFiles()`
- Set `version: 2` on marketing-staff entry (first version bump). Other experts keep default version 1 — since old markers are treated as version 0, they will re-bootstrap once to version 1 on first launch

**Patterns to follow:**
- Marker file pattern: `EXPERT_ID` at `~/.openclaw/agents/<id>/agent/EXPERT_ID`
- Version comparison pattern: simple integer comparison

**Test scenarios:**
- Happy path: New expert creation writes marker with version number
- Happy path: Existing expert with same version skips bootstrap re-write
- Happy path: Existing expert with lower version triggers bootstrap re-write
- Edge case: Old marker format (just expertId, no version) treated as version 0 → triggers re-write
- Edge case: Manifest entry without version field defaults to version 1

**Verification:**
- Bumping manifest version from 2→3 causes `initializeExperts()` to re-write SOUL.md and IDENTITY.md for the matching expert

---

- [ ] **Unit 3: Workspace redesign — SOUL.md condensation + TOOLS.md + USER.md**

**Goal:** Condense marketing-staff systemPrompt from ~2.9K to ~0.5K tokens after skill extraction. Extend `writeExpertBootstrapFiles()` to also create TOOLS.md and USER.md with relevant content.

**Requirements:** R5, R6, R8

**Dependencies:** Unit 2 (manifest versioning needed so the workspace changes take effect for existing agents)

**Files:**
- Modify: `electron/utils/expert-init.ts`
- Modify: `resources/experts/preinstalled-manifest.json`

**Approach:**
- Replace marketing-staff `systemPrompt` in manifest with the condensed version from requirements doc Section 2 (~0.5K, behavior rules + handoff boundaries + language rule)
- Extend `writeExpertBootstrapFiles()` to accept the full expert entry (not just systemPrompt/identityPrompt) and conditionally write:
  - `TOOLS.md` — only for marketing-staff expert (check `expert.id === 'marketing-staff'`), contains SparkBoost tool reference table. Other experts don't use SparkBoost tools.
  - `USER.md` — for all experts, auto-detected timezone and language
- Timezone detection: `Intl.DateTimeFormat().resolvedOptions().timeZone` — available in both Electron main and renderer
- Language detection: read from BoostClaw settings store or default to `zh-CN`. Implementation-time decision on exact mechanism (deferred).
- Bump marketing-staff manifest version to 2 (triggers re-write for existing agents via Unit 2)

**Patterns to follow:**
- Current `writeExpertBootstrapFiles()` at `expert-init.ts:101-113` — writes files to workspace dir
- Content from requirements doc Section 2 templates

**Test scenarios:**
- Happy path: New marketing-staff expert gets SOUL.md (condensed), IDENTITY.md, TOOLS.md (SparkBoost table), USER.md (timezone + language)
- Happy path: TOOLS.md contains all 7 SparkBoost tools with Query/Operate classification
- Happy path: USER.md contains valid IANA timezone and language code
- Edge case: Existing marketing-staff agent (version 1) gets files re-written when version bumps to 2
- Integration: Agent session loads TOOLS.md and USER.md into context — verify total workspace tokens < 2K

**Verification:**
- Expert workspace contains 4 files with expected content
- Total token count of all workspace files is under 2K (down from ~3.2K)

---

### Phase 3: Core Feature

- [ ] **Unit 4: Skill architecture — 5 new SKILL.md files**

**Goal:** Create 5 skill files that extract workflow logic from SOUL.md, replacing the monolithic tiktok-publisher skill.

**Requirements:** R3

**Dependencies:** None (can run in parallel with Phase 2)

**Files:**
- Create: `resources/openclaw-plugins/sparkboost/skills/product-scout/SKILL.md`
- Create: `resources/openclaw-plugins/sparkboost/skills/video-maker/SKILL.md`
- Create: `resources/openclaw-plugins/sparkboost/skills/content-craft/SKILL.md`
- Create: `resources/openclaw-plugins/sparkboost/skills/tiktok-publish/SKILL.md`
- Create: `resources/openclaw-plugins/sparkboost/skills/auto-publish-pipeline/SKILL.md`
- Delete: `resources/openclaw-plugins/sparkboost/skills/tiktok-publisher/SKILL.md`
- Modify: `resources/experts/preinstalled-manifest.json` (update requiredSkills array)

**Approach:**
- Write each SKILL.md following the established pattern from `tiktok-publisher/SKILL.md`: workflow steps, decision boundary table, trust boundary note
- Content for each skill comes from requirements doc Section 1.1–1.5
- Update marketing-staff manifest entry: `"requiredSkills": ["product-scout", "video-maker", "content-craft", "tiktok-publish", "auto-publish-pipeline"]`
- The plugin manifest's `"skills": ["./skills"]` automatically discovers all SKILL.md files in the skills directory

**Patterns to follow:**
- Existing `tiktok-publisher/SKILL.md` — decision boundary table format, trust boundary section
- Plugin skill auto-discovery: `"skills": ["./skills"]` in `openclaw.plugin.json`

**Test scenarios:**
- Test expectation: none — these are prompt files (SKILL.md), not executable code. Verification is manual: load marketing-staff expert and confirm skills are available via `useSkillsStore`.

**Verification:**
- All 5 skill directories exist with SKILL.md files
- marketing-staff expert's `requiredSkills` matches the 5 new skill names
- Old `tiktok-publisher/` directory removed
- Expert loads successfully with skills bound

---

- [ ] **Unit 5: New tool — sparkboost_video_compliance**

**Goal:** Register a new SparkBoost tool that calls the compliance API to check if a generated video meets platform standards.

**Requirements:** R4

**Dependencies:** None (independent of other units)

**Files:**
- Modify: `resources/openclaw-plugins/sparkboost/src/index.ts`
- Modify: `resources/openclaw-plugins/sparkboost/src/sparkboost-client.ts` (if new endpoint needed)

**Approach:**
- Register `sparkboost_video_compliance` tool with `api.registerTool()` following the same pattern as existing tools
- Parameters: `{ videoUrl: string }` (TypeBox schema)
- Returns: `{ pass: boolean, reason?: string }` wrapped in trust boundary
- Exact API endpoint deferred to implementation — needs verification of SparkBoost compliance API path

**Patterns to follow:**
- Existing tool registration pattern in `sparkboost/src/index.ts`
- Trust boundary wrapping: `wrapResponse()` / `wrapError()`
- TypeBox schema pattern from existing tools

**Test scenarios:**
- Happy path: Tool calls compliance API with videoUrl, returns pass/fail
- Error path: API returns error → wrapped with `wrapError()`, reported to agent
- Edge case: videoUrl is empty or invalid → validation error before API call

**Verification:**
- Tool appears in SparkBoost plugin tool list
- Manual test: call tool with a known video URL, verify response format

---

### Phase 4: UX

- [ ] **Unit 6: Smart routing for single-expert default**

**Goal:** When only one expert is enabled, auto-redirect to its session on app startup instead of showing the generic main agent.

**Requirements:** R7

**Dependencies:** None (independent)

**Files:**
- Modify: `src/pages/Experts/index.tsx`
- Possibly modify: `src/App.tsx` or create a new routing guard component

**Approach:**
- Add a `useEffect` to the Experts page (or a new routing guard) that runs on mount:
  1. Check `useExpertsStore` for enabled experts with `status === 'ready'`
  2. If exactly 1 ready expert and no localStorage redirect flag → call `handleStartExpert()` for that expert
  3. Set localStorage flag `boostclaw-expert-redirected` to prevent re-redirect on page refresh
  4. If multiple ready experts → show expert list (current behavior)
- Clear redirect flag when navigating away from chat or on expert list explicit visit
- Use the existing `handleStartExpert()` pattern: `switchSession(sessionKey)` + `navigate('/')`

**Patterns to follow:**
- `handleStartExpert()` at `src/pages/Experts/index.tsx:105-113`
- `switchSession()` from `useChatStore`

**Test scenarios:**
- Happy path: Single enabled expert → auto-redirect to its chat session
- Happy path: Multiple enabled experts → show expert list page
- Edge case: Page refresh → localStorage flag prevents re-redirect
- Edge case: Expert status changes from 'ready' to 'limited' → no redirect
- Edge case: No experts enabled → show default main agent chat

**Verification:**
- With only marketing-staff enabled, opening the app lands directly in its chat
- With multiple experts, the expert list page appears

---

- [ ] **Unit 7: Onboarding prerequisite check + language auto-detect**

**Goal:** Expert shows structured welcome with shop status check on first entry. Agent output language follows USER.md setting.

**Requirements:** R8, R9

**Dependencies:** Unit 3 (USER.md must exist for language detection to work)

**Files:**
- Modify: `resources/experts/preinstalled-manifest.json` (welcomeMessage updates)
- Possibly modify: `electron/utils/expert-init.ts` (welcomeMessage based on interface language)

**Approach:**
- Update `welcomeMessage` in manifest to the two-variant format from requirements doc Section 6 (with-shops / without-shops)
- The agent's first message on new session should trigger `sparkboost_snapshot` to check shop status
- This is primarily a prompt change in SOUL.md/manifest, not code — the condensed SOUL.md already includes "行动前先 snapshot 了解全局状态"
- For language: the condensed SOUL.md already includes the language rule. USER.md language field (from Unit 3) provides the value. Onboarding flow uses the agent's natural language.
- welcomeMessage language: at agent creation time, detect interface locale and set welcomeMessage accordingly. Implementation-time decision on exact mechanism (deferred).

**Patterns to follow:**
- Existing `welcomeMessage` in `preinstalled-manifest.json` — static string set at manifest level
- `suggestedPrompts` array — already exists in manifest

**Test scenarios:**
- Happy path: First chat with marketing-staff → agent calls snapshot, shows shop status, lists available actions
- Happy path: No shops connected → agent warns user, suggests setup steps
- Integration: Agent responds in the language specified in USER.md

**Verification:**
- New user opens marketing-staff expert → sees prerequisite-aware welcome message
- Agent output language matches USER.md language field

---

### Phase 5: Security Enhancement

- [ ] **Unit 8: API key bundling with encrypted storage**

**Goal:** Bundle shared SparkBoost API keys in the app and encrypt them at rest using Electron safeStorage, eliminating user configuration.

**Requirements:** R2

**Dependencies:** None (independent)

**Files:**
- Modify: `electron/services/secrets/secret-store.ts`
- Modify: `resources/openclaw-plugins/sparkboost/openclaw.plugin.json`
- Possibly modify: `resources/openclaw-plugins/sparkboost/src/index.ts` (fallback key reading)
- Possibly modify: `electron/utils/plugin-install.ts` (key injection during plugin setup)

**Approach:**
1. Add safeStorage encryption methods to `ElectronStoreSecretStore`: `encryptAndStore(key, value)`, `retrieveAndDecrypt(key)` — use `electron.safeStorage.encryptString()` / `decryptString()`
2. Make `secretKey` and `apiKey` optional in `configSchema` (remove from `required` array)
3. Remove both from `uiHints` — users never see these fields
4. Plugin entry (`index.ts`): if `pluginConfig` values are absent, read from encrypted store instead
5. Build-time: keys stored in `.env` (not in git), read during `after-pack.cjs` and written to plugin config with encryption
6. First-launch: detect if keys are missing from encrypted store, inject from bundled defaults

**Patterns to follow:**
- Existing `ElectronStoreSecretStore` at `electron/services/secrets/secret-store.ts`
- `electron-store` for persistence, `safeStorage` for encryption layer on top

**Test scenarios:**
- Happy path: First app launch → keys injected to encrypted store, plugin loads successfully
- Happy path: Subsequent launches → keys read from encrypted store, no re-injection
- Error path: safeStorage unavailable (Linux without libsecret) → SparkBoost plugin shows "Encryption unavailable" error, marketing-staff expert enters limited mode. Do NOT fall back to plaintext — R2 prohibits plaintext keys at rest.
- Edge case: Encrypted store corrupted or decryption fails → re-inject from bundled defaults and re-encrypt
- Security: Verify keys are NOT readable as plaintext in `~/.openclaw/openclaw.json` or `BoostClaw-providers.json`

**Verification:**
- Plugin loads without user configuration
- `openclaw.json` does not contain plaintext SparkBoost keys
- `safeStorage.decryptString()` returns the correct key

---

## System-Wide Impact

- **Interaction graph:** `initializeExperts()` flow changes — new option to createAgent, extended bootstrap file writes, version-aware migration. All expert agents are affected on next app launch.
- **Error propagation:** Plugin initialization failure when keys are missing from encrypted store → need clear error message and recovery path (re-inject defaults).
- **State lifecycle risks:** Pipeline state file (`pipeline-state.json`) must be cleaned up after successful run. If cron session crashes, stale state file remains — next trigger resumes correctly. State file should include timestamp to detect very old stale state.
- **API surface parity:** The `createAgent()` API gains a new option. All existing callers pass no options (default behavior unchanged). Only expert-init passes the new flag.
- **Integration coverage:** Expert initialization + agent creation is the critical path. Unit 1 changes must not break regular agent creation (non-expert agents must still get runtime files copied).
- **Unchanged invariants:** Regular agent creation flow, Gateway process management, plugin tool registration pattern, cron CRUD API — none of these change.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SparkBoost compliance API endpoint unknown | Medium | Medium | Deferred to implementation — verify endpoint before writing tool code |
| safeStorage unavailable on some Linux distros | Low | Medium | Fallback to plaintext with warning log, graceful degradation |
| Pipeline state file conflicts between overlapping cron runs | Low | High | State file includes a PID/session identifier and timestamp. On new trigger: if state file exists AND was written within the last 2 hours, abort (another run is in progress). If stale (>2 hours), resume from last position. Implemented in auto-publish-pipeline SKILL.md logic. |
| Manifest version bump causes all experts to re-bootstrap simultaneously | Low | Low | Re-bootstrap is idempotent (overwrites files), happens once per version bump |
| Skill loading order affects cross-skill delegation | Medium | Low | Skills are prompt files, not code — delegation is natural language, order doesn't matter |
| Existing expert agents lose current SOUL.md content on version bump | Low | Medium | By design — version bump signals intentional content change. Old content is in git history. |

## Phased Delivery

### Phase 1 — Security + Infrastructure (Units 1, 2)
Ship first: stops credential leakage and enables migration. Can deploy independently.

### Phase 2 — Core Feature (Units 3, 4, 5)
Ship together: skills, workspace, and compliance tool are interdependent. SOUL.md condensation only makes sense once skills exist.

### Phase 3 — UX (Units 6, 7)
Ship after Phase 2: smart routing and onboarding depend on workspace files being correct.

### Phase 4 — Encryption (Unit 8)
Can ship independently but logically last: encryption adds security hardening but doesn't block other features.

## Sources & References

- **Origin document:** [marketing-expert-system-requirements.md](../brainstorms/marketing-expert-system-requirements.md)
- **Prior plan:** [004-feat-expert-system-plan](2026-04-15-004-feat-expert-system-plan.md)
- Related code: `electron/utils/expert-init.ts`, `electron/utils/agent-config.ts`, `resources/openclaw-plugins/sparkboost/`
- Open issues: `TODOS.md` (R1, R4)
