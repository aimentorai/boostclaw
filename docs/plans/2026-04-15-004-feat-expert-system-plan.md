---
title: "feat: Add Expert System"
type: feat
status: active
date: 2026-04-15
origin: docs/brainstorms/expert-system-requirements.md
---

# feat: Add Expert System

## Overview

Add an Expert abstraction layer on top of the existing Agent system. Experts are pre-installed, domain-specific AI assistants with friendly names, curated personalities, auto-installed skills, and domain-specific conversational guidance. The Expert page replaces the Agent page as the primary user-facing interaction model for non-technical users.

## Problem Frame

BoostClaw's Agent system targets technical users who understand system prompts and skill bindings. Non-technical users (e.g., cross-border e-commerce operators) need guided, domain-specific experiences without learning AI terminology. The Expert system provides this by wrapping the Agent system with pre-configured personalities, auto-installed skills, and domain-specific chat guidance. (see origin: `docs/brainstorms/expert-system-requirements.md`)

## Requirements Trace

- R1. Expert data model with manifest-based configuration
- R2. Expert list page with card-based UI showing icon, name, description, category
- R3. Expert chat with domain-specific welcome message and suggested prompts
- R4. Auto-creation of underlying Agent + global skill installation on app init
- R5. Sidebar navigation: Agent entry replaced by Expert entry
- R6. Pre-installed expert manifest with at least 2 experts at launch
- R7. Expert-managed agents hidden from Agent management page
- R8. Expert sessions isolated from main chat session list
- R9. Graceful degradation when skills fail to install ("limited mode")
- R10. Non-technical user can find and start using an expert within 30 seconds

## Scope Boundaries

- No online expert marketplace or user-created experts
- No per-expert custom UI components beyond welcome/prompts/skill status
- No step-by-step wizard workflows
- No expert configuration editing by users
- No expert analytics or usage tracking

## Context & Research

### Relevant Code and Patterns

- **Sidebar navigation**: `src/components/layout/Sidebar.tsx` — `topNavItems` array defines nav entries as `{ to, icon, label, testId }`
- **App routing**: `src/App.tsx` — React Router routes nested under `<MainLayout />`
- **Agent store**: `src/stores/agents.ts` — Zustand store with `fetchAgents()`, `createAgent()`, `AgentSummary` type
- **Agent config**: `electron/utils/agent-config.ts` — `createAgent(name, { inheritWorkspace })`, `AGENT_BOOTSTRAP_FILES` list
- **Skill store**: `src/stores/skills.ts` — `installSkill(slug)`, `enableSkill(skillId)`, global skill management
- **Chat session management**: `src/stores/chat/session-actions.ts` — `switchSession(key)`, `getAgentIdFromSessionKey(key)`, session key format `agent:<agentId>:main`
- **Chat routing**: `src/stores/chat/runtime-send-actions.ts` — `resolveMainSessionKeyForAgent(targetAgentId)` routes messages to agent sessions
- **Welcome screen**: `src/pages/Chat/index.tsx` — `WelcomeScreen` component shown when `isEmpty` is true
- **Manifest pattern**: `resources/skills/preinstalled-manifest.json` — JSON array with `slug`, source fields, `version`, `autoEnable`
- **i18n**: `src/i18n/` — supports en, zh, ja locales

### Key Technical Decisions

1. **Separate Expert store from Agent store** — The Expert store manages the Expert manifest, expert-agent mapping, and UI state. It reads from the Agent store for underlying agent data but does not modify the Agent store's public API. This keeps concerns separated and avoids polluting agent management.

2. **Expert manifest follows skill manifest pattern** — `resources/experts/preinstalled-manifest.json` mirrors the existing `resources/skills/preinstalled-manifest.json` structure. This is a familiar pattern that the build scripts already know how to bundle.

3. **Expert agents are tagged via a marker file** — During agent creation, an `EXPERT_ID` file is written to the agent directory. The Agent store's `fetchAgents()` reads this marker and adds an `expertId` field to `AgentSummary`. The Agents page filters out agents with this marker.

4. **Expert sessions use standard session keys** — No special session key format. Expert sessions use `agent:<agentId>:main` just like regular agent sessions. The Expert store maps expert IDs to agent IDs for routing.

5. **Welcome screen is replaced via context** — When the Chat page detects the current session belongs to an expert-managed agent, it renders the expert welcome screen instead of the generic `WelcomeScreen`. No routing changes needed.

6. **Skill installation is global, not per-agent** — The `requiredSkills` in the expert manifest triggers global `installSkill` / `enableSkill` calls. Skills are installed once and available to all experts/agents. (see origin: Technical Constraints)

## Open Questions

### Resolved During Planning

- How to tag expert-created agents? → Marker file `EXPERT_ID` in agent directory, read by agent store
- Where do expert sessions appear? → Only in Expert page, not in main chat session list
- How to handle welcome message lifecycle? → Show once on first visit, suggested prompts persist as collapsible section

### Deferred to Implementation

- Exact welcome message content and suggested prompt copy for each expert
- Whether the Agent management page needs a "show expert agents" toggle
- i18n keys and translations for expert UI labels

## Implementation Units

- [ ] **Unit 1: Expert Config Types & Manifest**

**Goal:** Define the ExpertConfig type, create the pre-installed expert manifest file, and add the Expert store skeleton.

**Requirements:** R1, R6

**Dependencies:** None

**Files:**
- Create: `src/types/expert.ts`
- Create: `resources/experts/preinstalled-manifest.json`
- Create: `src/stores/experts.ts`
- Test: `tests/unit/stores/experts.test.ts`

**Approach:**
- Define `ExpertConfig` type in `src/types/expert.ts` matching the requirements doc data model
- Create manifest JSON with 2 experts (video + content writing) including systemPrompt, identityPrompt, welcomeMessage, suggestedPrompts
- Create Zustand store `useExpertsStore` with state: `experts: ExpertConfig[]`, `loading`, `error`, `initialized`, and actions: `loadExperts()`, `initializeExperts()`, `getExpertByAgentId(agentId)`
- Manifest loading reads from bundled resource (same pattern as skill manifest in `electron/utils/`)

**Patterns to follow:**
- `src/types/agent.ts` for type definition style
- `src/stores/skills.ts` for store structure (loading state, error handling)
- `resources/skills/preinstalled-manifest.json` for manifest structure

**Test scenarios:**
- Happy path: loadExperts() reads manifest and populates experts array
- Edge case: manifest file missing or malformed — returns empty array with no crash
- Happy path: getExpertByAgentId returns correct expert for a known agent ID
- Edge case: getExpertByAgentId returns undefined for non-expert agent

**Verification:**
- Expert store loads manifest without errors
- TypeScript types compile cleanly

---

- [ ] **Unit 2: Expert Initialization Service**

**Goal:** On app startup (or first launch after update), automatically create underlying agents for each expert and ensure required skills are installed globally.

**Requirements:** R4, R9

**Dependencies:** Unit 1

**Files:**
- Create: `electron/utils/expert-init.ts`
- Modify: `electron/utils/agent-config.ts` (extend createAgent or add post-creation file writer)
- Modify: `electron/main/ipc-handlers.ts` (add expert init IPC handler)
- Test: `tests/unit/expert-init.test.ts`

**Approach:**
- Create `expert-init.ts` with `initializeExperts()` function that:
  1. Reads expert manifest
  2. For each expert, checks if its agent already exists (by marker file)
  3. If not, calls `createAgent()` then writes custom SOUL.md, IDENTITY.md, and `EXPERT_ID` marker file to the agent directory
  4. For each expert's `requiredSkills`, calls the existing skill install/enable flow (runs in Electron main process)
  5. Tracks installation status per expert (for UI "limited mode" display)
- Add IPC handler `expert:init` that triggers initialization and returns status
- Handle partial failure: if one expert's agent creation fails, continue with others

**Execution note:** Test-first — write integration tests for agent creation with custom bootstrap files before implementing.

**Patterns to follow:**
- `electron/utils/agent-config.ts` for file I/O patterns (reading/writing agent files)
- `scripts/bundle-preinstalled-skills.mjs` for skill installation flow

**Test scenarios:**
- Happy path: initializeExperts creates agents for all experts in manifest
- Happy path: custom SOUL.md and IDENTITY.md written correctly
- Edge case: agent already exists (idempotent — skip creation, verify files)
- Error path: agent creation fails for one expert — others still succeed
- Error path: skill installation fails — expert tracked as "limited mode"
- Integration: EXPERT_ID marker file is written and readable

**Verification:**
- After app startup, expert agents appear in agent config
- SOUL.md contains the expert's systemPrompt
- Skills marked as installed in skill store

---

- [ ] **Unit 3: Agent Store Integration**

**Goal:** Extend the Agent store to recognize expert-managed agents and support filtering them from the Agent management page.

**Requirements:** R7

**Dependencies:** Unit 2

**Files:**
- Modify: `src/types/agent.ts` (add `expertId?: string` to `AgentSummary`)
- Modify: `src/stores/agents.ts` (read EXPERT_ID marker, expose filtered lists)
- Test: `tests/unit/stores/agents.test.ts`

**Approach:**
- Add optional `expertId` field to `AgentSummary` type
- When `fetchAgents()` loads agent data from the server, check for the EXPERT_ID marker and populate `expertId`
- Add computed getter `nonExpertAgents` that filters out agents with `expertId`
- Agents page uses `nonExpertAgents` for display; Expert store uses full list for mapping

**Patterns to follow:**
- Existing `AgentSummary` type and `fetchAgents()` implementation

**Test scenarios:**
- Happy path: agents with EXPERT_ID have expertId populated
- Happy path: nonExpertAgents excludes expert-managed agents
- Edge case: agent with no EXPERT_ID has expertId as undefined

**Verification:**
- Agents page no longer shows expert-created agents
- Expert store can still access full agent list

---

- [ ] **Unit 4: Expert List Page**

**Goal:** Create the Expert list page with card-based UI, category badges, and navigation to expert chat.

**Requirements:** R2, R5, R10

**Dependencies:** Unit 1, Unit 3

**Files:**
- Create: `src/pages/Experts/index.tsx`
- Modify: `src/App.tsx` (add `/experts` route)
- Modify: `src/components/layout/Sidebar.tsx` (replace Agent nav item with Expert)
- Test: `tests/e2e/experts-page.spec.ts`

**Approach:**
- Create Experts page component rendering expert cards in a grid
- Each card shows: icon, name, description, category badge, skill status indicator
- Clicking a card resolves the expert's underlying agent, switches to its main session, and navigates to `/` (chat) with the expert's agent as the target
- Cards show "setting up" spinner during initialization, "limited mode" badge if skills failed, "unavailable" if agent creation failed
- Replace the Agents nav item in `topNavItems` with an Experts entry pointing to `/experts`
- Add "Advanced: manage agents" link at bottom of Experts page for power users
- Add route `/experts` in App.tsx

**Patterns to follow:**
- `src/pages/Agents/index.tsx` for page layout patterns
- `src/pages/Skills/index.tsx` for card-based grid layout
- `src/components/layout/Sidebar.tsx` for nav item format

**Test scenarios:**
- Happy path: Expert list page renders 2 expert cards
- Happy path: clicking a card navigates to chat with correct agent
- Edge case: expert in "limited mode" shows badge but is still clickable
- Edge case: expert "unavailable" shows error state
- Integration: "Advanced: manage agents" link navigates to /agents

**Verification:**
- Sidebar shows "Experts" instead of "Agents"
- Expert page renders correctly with all cards
- Clicking an expert card enters its chat session

---

- [ ] **Unit 5: Expert Chat Enhancements**

**Goal:** Enhance the Chat page with expert-specific welcome screen, suggested prompts, and skill status display when in expert mode.

**Requirements:** R3, R8

**Dependencies:** Unit 3, Unit 4

**Files:**
- Modify: `src/pages/Chat/index.tsx` (expert-aware welcome screen, session filtering)
- Create: `src/pages/Chat/ExpertWelcome.tsx`
- Modify: `src/stores/chat/session-actions.ts` (optional: expert session filtering)
- Test: `tests/e2e/expert-chat.spec.ts`

**Approach:**
- Create `ExpertWelcome` component that displays expert icon, name, welcome message, and suggested prompt buttons
- In `Chat/index.tsx`, when `isEmpty` is true and the current agent is expert-managed, render `ExpertWelcome` instead of generic `WelcomeScreen`
- Suggested prompts are clickable buttons that populate the chat input (not auto-send)
- On return visits (session has history), show only a collapsible "suggested prompts" section, not the full welcome
- For session isolation: the chat session list (in Sidebar history pane) filters out expert sessions when on the main Chat view; expert sessions are only visible when accessed from the Expert page
- Add `isExpertSession(sessionKey)` helper that checks if the agent for a session has an `expertId`

**Patterns to follow:**
- Existing `WelcomeScreen` component in `src/pages/Chat/index.tsx`
- `getAgentIdFromSessionKey` for session-agent mapping

**Test scenarios:**
- Happy path: first visit to expert chat shows welcome message and suggested prompts
- Happy path: clicking a suggested prompt populates chat input
- Happy path: return visit shows chat history, no full welcome
- Edge case: non-expert session still shows generic WelcomeScreen
- Integration: expert sessions not visible in sidebar session list

**Verification:**
- Expert welcome displays correctly with domain-specific content
- Suggested prompts are clickable and populate input
- Expert sessions isolated from main session list

---

- [ ] **Unit 6: Expert Manifest Content & i18n**

**Goal:** Populate the expert manifest with full content (systemPrompt, identityPrompt, welcomeMessage, suggestedPrompts) for both launch experts, and add i18n keys for expert UI labels.

**Requirements:** R6

**Dependencies:** Unit 1

**Files:**
- Modify: `resources/experts/preinstalled-manifest.json` (full content)
- Modify: `src/i18n/en/chat.json` (expert-related keys)
- Modify: `src/i18n/zh/chat.json` (expert-related keys)
- Modify: `src/i18n/ja/chat.json` (expert-related keys)

**Approach:**
- Write comprehensive SOUL.md and IDENTITY.md content for each expert that establishes domain expertise
- Write welcome messages that introduce each expert's capabilities in user-friendly language
- Write 4 suggested prompts per expert targeting common use cases
- Add i18n keys for: nav label ("Experts"), page title, card labels, skill status, limited mode, error states

**Test expectation:** none — content files, verified by visual inspection

**Verification:**
- Manifest contains complete content for both experts
- i18n keys exist in all three locales
- No missing translation keys in UI

## System-Wide Impact

- **Interaction graph:** Expert initialization runs during app startup, before user interaction. It creates agents and installs skills via existing APIs. The chat system routes to expert agents via the existing `targetAgentId` mechanism.
- **Error propagation:** Skill install failures are caught per-expert and surfaced as "limited mode" badges. Agent creation failures surface as "unavailable" cards. Neither blocks app startup.
- **State lifecycle risks:** Expert initialization must be idempotent — re-running on subsequent launches must not duplicate agents or overwrite modified bootstrap files. Check for marker file existence before creating.
- **API surface parity:** The Expert store is a new surface; it does not modify existing Agent or Chat store APIs. The Agent store gains one optional field (`expertId`) and one computed getter (`nonExpertAgents`).
- **Integration coverage:** Expert card click → session switch → chat render → message send is a cross-layer flow that should have an E2E test.
- **Unchanged invariants:** Existing Agent chat, session management, skill installation, and sidebar navigation (aside from the nav item rename) continue to work identically. Expert is purely additive.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `createAgent` API doesn't support custom bootstrap content | Post-creation file write step: create agent with default name, then overwrite SOUL.md/IDENTITY.md with expert content |
| Skills require API keys not yet configured | Graceful degradation — expert works in "limited mode" without skills, shows setup instructions |
| Expert manifest grows stale between releases | Bundled with app, updated on each release — same as skill manifest |
| Rate limiting during skill installation on first launch | Install skills sequentially with retry; show progress in Expert UI |
| Expert agents visible in Agent page after downgrade | Marker file persists; filter continues to work |

## Sources & References

- **Origin document:** [docs/brainstorms/expert-system-requirements.md](docs/brainstorms/expert-system-requirements.md)
- Agent system: `electron/utils/agent-config.ts`
- Agent store: `src/stores/agents.ts`
- Skill store: `src/stores/skills.ts`
- Chat system: `src/stores/chat/`, `src/pages/Chat/`
- Sidebar: `src/components/layout/Sidebar.tsx`
- App routing: `src/App.tsx`
- Manifest pattern: `resources/skills/preinstalled-manifest.json`
