# Expert System Requirements

> Date: 2026-04-15
> Status: Draft
> Scope: Standard

## Problem

BoostClaw's current Agent system is designed for technical users who understand concepts like system prompts, skill bindings, and agent configuration. Non-technical users (e.g., cross-border e-commerce operators) want to complete domain-specific tasks without learning AI terminology. They need a guided, purpose-built experience: "I want to generate a marketing video" not "I need to configure an agent with video generation skills."

## Solution

Introduce an **Expert** abstraction layer on top of the existing Agent system. An Expert is a pre-installed, domain-specific AI assistant with a friendly name, curated personality, auto-installed skills, and domain-specific conversational guidance. Experts replace the Agent concept as the primary user-facing interaction model.

## User Experience

### Discovery & Entry

- Sidebar "Agent" entry is replaced by "Expert" entry (or similar friendly label)
- Expert list page shows pre-installed experts as cards with: icon, name, one-line description, category badge
- Clicking an expert card enters its dedicated chat session

### Expert Chat

- Same chat UI as current Agent chat, enhanced with:
  - **Welcome message**: Expert introduces itself and explains what it can do (defined in Expert config)
  - **Suggested prompts**: 3-4 clickable prompt suggestions relevant to the expert's domain (e.g., "Help me create a TikTok video for my product", "Analyze trending products on Amazon")
  - **Skill status indicator**: Shows which skills are active/available for this expert
- Chat interaction is pure conversational (no step-by-step wizard)
- Expert responses leverage auto-installed skills (e.g., video generation, image creation) transparently

### Expert Management

- Experts are pre-installed; users cannot create, delete, or install new experts
- Expert detail view shows: name, description, available skills, usage tips
- No expert configuration exposed to users (model, system prompt, etc. are pre-set)

## Data Model

### ExpertConfig

```
ExpertConfig {
  id: string                  // Unique identifier (e.g., "cross-border-video-expert")
  name: string                // Display name (e.g., "跨境电商视频专家")
  description: string         // One-line description
  icon: string                // Icon identifier or emoji
  category: string            // Category for grouping (e.g., "marketing", "content")
  systemPrompt: string        // SOUL.md content for the underlying Agent
  identityPrompt: string      // IDENTITY.md content
  welcomeMessage: string      // First message shown when entering expert chat
  suggestedPrompts: string[]  // 3-4 suggested user prompts
  requiredSkills: string[]    // Skill IDs to ensure installed & enabled globally
  defaultModel?: string       // Optional model override
  usageTips: string[]         // Short tips shown on the expert detail view
  enabled: boolean            // Whether this expert is visible to users (set by app, not user)
}
```

### Expert-Agent Mapping

- **1 Expert = 1 Agent** (strong binding)
- Creating an expert automatically creates an underlying Agent with:
  - `SOUL.md` = `systemPrompt`
  - `IDENTITY.md` = `identityPrompt`
  - Skills from `requiredSkills` ensured as installed & enabled globally
  - Model set from `defaultModel` (or app default)
- Deleting an expert is not supported (pre-installed only)
- The underlying Agent is hidden from the Agent management page (marked as "expert-managed")
- Expert chat sessions are accessible from the Expert page only, not from the main chat session list. This keeps the Expert experience self-contained and prevents confusion between "expert" and "general" conversations.

## Pre-installed Experts (Initial)

### 1. Cross-border E-commerce Video Expert (跨境电商视频专家)

- **Category**: Marketing
- **Capabilities**: Product analysis, script writing, video generation, platform-specific optimization (TikTok, Amazon, Shopee)
- **Required Skills**: `openai-image-gen`, `nano-banana-pro` (video), `tavily-search` (product research)
- **Suggested Prompts**:
  - "帮我为一款蓝牙耳机生成 TikTok 推广视频"
  - "分析当前亚马逊热门产品趋势"
  - "为我的产品写一个短视频脚本"
  - "帮我生成产品主图"

### 2. Content Writing Expert (文案写作专家)

- **Category**: Content
- **Capabilities**: Product description writing, ad copy, social media posts, SEO-optimized content for cross-border platforms
- **Required Skills**: `tavily-search` (trend research)
- **Suggested Prompts**:
  - "帮我的产品写一个亚马逊五点描述"
  - "生成适合 Shopee 的产品标题和描述"
  - "写一个吸引人的社交媒体推广文案"
  - "优化我的产品详情页文案"

### 3. (Placeholder for future experts)

- Additional experts can be added by updating the pre-installed manifest
- Categories to consider: Data Analysis, Customer Service, Code Development

## Interaction States

### First Launch / Skill Installation
- Expert list page shows experts with a "setting up" indicator while required skills are being installed
- If skill installation fails, expert card shows a "limited mode" badge and a retry button
- Expert is still usable without all skills installed (graceful degradation)

### Expert Chat
- **First visit**: Welcome message + suggested prompts are displayed above the chat input
- **Return visit**: Welcome message is not re-shown; suggested prompts remain available as a collapsible section
- Chat history persists between visits (same session mechanism as Agent chat)

### Error States
- If underlying Agent creation fails during app init, expert card shows "unavailable" with an error description
- If an expert's required model is not configured, expert card shows "needs model setup" and links to model settings

## Technical Constraints

- Expert config is defined in a static manifest file (similar to `resources/skills/preinstalled-manifest.json`)
- Expert lifecycle (creation, skill binding) happens during app initialization or first launch after update
- Expert chat sessions use the same session management as Agent chat (session keys, history, etc.)
- No new backend services required; Expert is a UI/config layer over existing Agent infrastructure
- **Skills are global, not per-agent.** `requiredSkills` means "ensure these skills are installed and enabled globally" — the Expert setup process calls the existing `installSkill` / `enableSkill` APIs. Skills are not "bound" to individual agents.
- **Agent creation API needs extension.** The current `createAgent(name, { inheritWorkspace })` in `electron/utils/agent-config.ts` only copies bootstrap files from the main agent workspace. For Experts, it needs to accept custom content for SOUL.md, IDENTITY.md, and other bootstrap files, or be followed by a post-creation file-write step.

## Scope Boundaries

### In Scope

- Expert data model and configuration
- Expert list page with card-based UI
- Expert chat with welcome message and suggested prompts
- Auto-creation of underlying Agent + skill binding
- Sidebar navigation update (Agent → Expert)
- Pre-installed expert manifest (at least 2 experts at launch)

### Out of Scope

- Online expert marketplace or user-created experts
- Per-expert custom UI components
- Step-by-step wizard workflows
- Expert configuration editing by users
- Expert analytics or usage tracking
- Expert-to-expert collaboration

## Success Criteria

1. Non-technical user can find and start using an expert within 30 seconds of app launch
2. Expert chat experience includes domain-relevant welcome message and suggested prompts
3. Underlying Agent is automatically configured with correct skills and personality
4. Expert chat supports all existing chat features (streaming, file attachments, tool visualization)
5. No regression in existing Agent chat functionality

## Risks

| Risk | Mitigation |
|------|-----------|
| Expert concept confuses existing Agent users | Expert page can show "Advanced: manage agents" link to Agent management |
| Required skills fail to install | Graceful degradation: expert works without skills, shows "limited mode" warning |
| Expert config grows stale | Pre-installed manifest is updated with each app release |

## Dependencies

- Existing Agent system (`electron/utils/agent-config.ts`)
- Existing Skill system (`src/stores/skills.ts`, `resources/skills/`)
- Existing Chat system (`src/stores/chat.ts`, `src/pages/Chat/`)
- Existing Sidebar navigation (`src/components/layout/`)
