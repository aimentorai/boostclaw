# Marketing Expert Skills Requirements

> Date: 2026-04-22
> Status: Draft
> Scope: Standard
> Related: expert-system-requirements.md

## Problem

The marketing-staff expert currently has no skills bound (`requiredSkills: []`). Its SOUL.md contains all workflow logic as monolithic text — video generation steps, publishing procedures, content guidelines, and safety rules are all mixed together. This makes it hard to iterate on individual workflows, wastes tokens by loading everything at once, and doesn't scale as new capabilities are added.

## Decision

Split the marketing-staff expert's capabilities into **4 skills**, each aligned with a phase of the cross-border seller content pipeline:

```
Product Scout → Video Maker → Content Craft → TikTok Publish
```

Skills live inside the SparkBoost plugin at `resources/openclaw-plugins/sparkboost/skills/` and are bound to the marketing-staff expert via `requiredSkills` in the manifest.

## Skill Definitions

### 1. `product-scout` (商品情报)

**Purpose:** Product discovery, showcase management, and product selection guidance.

| Field | Value |
|-------|-------|
| Triggers | 商品, 产品, 选品, 橱窗, product, inventory |
| Tools | `sparkboost_snapshot`, `sparkboost_list_accounts`, `sparkboost_list_products` |
| Token estimate | ~1K |

**Workflow:**
1. Snapshot → overview of active accounts
2. User specifies account → list products (with pagination support)
3. Present product summary: title, price, sales count, stock status
4. Suggest which products may benefit from promotion (based on sales velocity, stock level)

**Prompt guidance (in SKILL.md):**
- Always snapshot first to understand current state
- Present products in a scannable format (numbered list with key stats)
- When multiple pages exist, ask if user wants to see more before proceeding
- Suggest promotion candidates based on: low views + good product, or high sales + potential for more

**Future growth:** Trend analysis API, competitor product lookup, product performance history.

---

### 2. `video-maker` (视频生产)

**Purpose:** AI video generation from prompt to finished video URL.

| Field | Value |
|-------|-------|
| Triggers | 生成视频, AI视频, 视频创作, grok, video generation |
| Tools | `sparkboost_grok_submit`, `sparkboost_grok_result` |
| Token estimate | ~1.5K |

**Workflow:**
1. Collect parameters: prompt, duration (6s/10s), aspect ratio (default 9:16)
2. If reference images available, collect image URLs
3. Submit via `sparkboost_grok_submit`
4. Poll `sparkboost_grok_result` every 30s (max 30 minutes)
5. Return `video_url` on success, or report failure

**Prompt optimization guide (in SKILL.md):**
- Specific > abstract: "white sneakers walking on wooden floor, close-up" > "product showcase"
- Include motion: rotation, zoom-in, slow-motion, tracking shot
- Specify style: cinematic, lifestyle, product showcase, before-after
- For product videos: show the product in use, highlight key features visually
- Duration guidance: 6s for simple loops, 10s for narratives

**Failure handling:**
- status=3 → report failure reason, suggest prompt modifications
- Timeout (30min) → suggest user check later with `sparkboost_grok_result`
- Single retry on network error, then hand off to user

**Future growth:** Batch generation, multi-language voiceover, image-to-video template presets.

---

### 3. `content-craft` (内容创作)

**Purpose:** Title generation, script writing, copy optimization, and content safety review. Pure prompt capability — no tool bindings.

| Field | Value |
|-------|-------|
| Triggers | 标题, 文案, 脚本, 内容, copy, title, script |
| Tools | none |
| Token estimate | ~2K |

**Title templates (in SKILL.md):**
- Pain point: "[问题]？试试这个 [产品]"
- Scenario: "在 [场景] 用 [产品]，效果太 [形容词] 了"
- Review: "[产品] 真的 [claim] 吗？看完你就知道了"
- Unboxing: "开箱 [产品]，[第一印象]"
- Comparison: "[产品A] vs [产品B]，[结论]"

**Title rules:**
- Length: 20-80 characters
- Style: conversational, eye-catching, can use emoji (max 2)
- Highlight product selling point or use case
- Avoid: absolute claims ("最好", "第一"), medical/efficacy claims, misleading descriptions

**Script template (for short video):**
1. Hook (0-2s): attention-grabbing visual or question
2. Problem (2-4s): pain point the product solves
3. Solution (4-7s): product demonstration
4. CTA (7-10s): call to action or product anchor

**Content safety checklist:**
- No absolute superlatives or unverified claims
- No medical/health efficacy statements
- No competitor name-calling or defamation
- No watermark/logo obstruction on product images
- Comply with TikTok community guidelines

**Publishing time suggestions:**
- Best: 19:00-21:00 (user activity peak)
- Secondary: 12:00-13:00, 07:00-08:00
- Avoid: 02:00-06:00

**Future growth:** A/B test title generation, SEO keyword optimization, platform-specific format adaptation (Shopee, Amazon, etc.).

---

### 5. `auto-publish-pipeline` (自动推品流水线)

**Purpose:** Cron-triggered fully automated pipeline — from product list to published videos, no human intervention.

| Field | Value |
|-------|-------|
| Triggers | 每日推品, 自动发布, daily publish, auto pipeline |
| Tools | All sparkboost tools + `sparkboost_video_compliance` (new) |
| Token estimate | ~2K |
| Mode | Cron-only (not for interactive chat) |

**Orchestration logic (in SKILL.md):**
1. Snapshot → get all shops
2. For each shop (serial):
   - list_products → get full product catalog
   - For each product (serial):
     - AI generates video prompt from product info
     - grok_submit → submit video generation
     - grok_result → poll until status=2 (success) or status=3 (fail)
     - On success: video_compliance → check platform standards
     - On compliance pass: AI generates title (content-craft templates)
     - publish → publish to shop's video account (continuous, no interval)
     - On any failure: log reason, skip, continue to next product
3. Send summary report to user's notification channel

**Report format:**
```
📊 每日自动推品报告 (2026-04-22)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏪 店铺A: 15 个商品
   ✅ 成功: 12 | ❌ 失败: 2 | ⏭️ 跳过: 1
   ❌ 失败原因:
     - [蓝牙耳机] 视频生成失败: timeout
     - [手机壳] 合规检查不通过: 水印遮挡

🏪 店铺B: 8 个商品
   ✅ 成功: 7 | ❌ 失败: 1 | ⏭️ 跳过: 0
━━━━━━━━━━━━━━━━━━━━━━━━━━━
总计: 22 成功 / 3 失败 / 1 跳过
```

---

### 4. `tiktok-publish` (发布分发)

**Purpose:** Video publishing to TikTok shops with batch support, user confirmation, and status tracking.

| Field | Value |
|-------|-------|
| Triggers | 发布, 推送, publish, distribute, 发视频 |
| Tools | `sparkboost_snapshot`, `sparkboost_publish`, `sparkboost_check_status` |
| Token estimate | ~1.5K |

**Workflow:**
1. Snapshot → confirm active accounts
2. Confirm targets → which accounts? which product?
3. If product not yet selected → delegate to `product-scout`
4. If title not yet generated → delegate to `content-craft`
5. Show full parameter summary, **wait for explicit user confirmation** (mandatory)
6. Publish in batches: 2-3 accounts per batch, 30-minute interval between batches
7. Track each publish task via `sparkboost_check_status`
8. Report batch results: success count, failure count, failure reasons

**Safety boundaries (in SKILL.md):**

| Situation | Action |
|-----------|--------|
| Account not ACTIVE | Skip, report to user. Never silently skip |
| User says "publish to all" | Confirm once per batch, not once per account |
| Publish fails | Report error, do NOT retry without user confirmation |
| 2+ failures in same batch | Stop batch, hand off decision to user |
| Title may violate rules | Flag concern, suggest alternative from content-craft |

**Defaults:**
- Batch size: 2-3 accounts
- Interval between batches: 30 minutes
- Product anchor title: same as video title

**Future growth:** Scheduled publishing, optimal time slot selection, A/B test distribution, cross-platform publishing.

---

## SOUL.md After Skill Extraction

SOUL.md shrinks from ~2.9K to ~0.5K, containing only identity and behavioral rules:

```markdown
你是 BoostClaw 营销助手，负责 TikTok 营销任务。

## 行为准则
1. 行动前先 snapshot 了解全局状态
2. 遇到异常不静默，如实报告
3. 不确定时把决定权交给用户
4. 不可逆操作必须用户确认

## Handoff 边界
- 必须交由用户：账号异常、发布失败 2 次、标题可能违规、指令不明确
- 可以自动处理：网络超时重试（1次）、视频处理中等待（最多 30 分钟）、商品列表翻页
- 绝不能做：跳过确认直接发布、静默跳过异常、修改用户指定的标题、忽略 API 错误

## 跨 Skill 编排
完整的"生成视频并发布"流程：先用 video-maker 生成视频，
再用 content-craft 优化标题，最后用 tiktok-publish 发布。
每步结果传递给下一步。

## 默认值
- 批量间隔: 30 分钟 | 每批: 2-3 个账号
- 视频时长: 10s | 宽高比: 9:16
```

## File Layout

```
resources/openclaw-plugins/sparkboost/
├── skills/
│   ├── tiktok-publisher/SKILL.md       ← existing, will be removed
│   ├── product-scout/SKILL.md          ← new
│   ├── video-maker/SKILL.md            ← new
│   ├── content-craft/SKILL.md          ← new
│   ├── tiktok-publish/SKILL.md         ← new (replaces tiktok-publisher)
│   └── auto-publish-pipeline/SKILL.md  ← new (cron automation)
└── openclaw.plugin.json                ← add skill entries
```

## Manifest Update

The `preinstalled-manifest.json` entry for marketing-staff changes:

```json
{
  "requiredSkills": [
    "product-scout",
    "video-maker",
    "content-craft",
    "tiktok-publish",
    "auto-publish-pipeline"
  ]
}
```

The `systemPrompt` field is replaced with the condensed SOUL.md content above.

## Automated Daily Publishing Workflow

A 5th skill `auto-publish-pipeline` orchestrates the full automated flow, triggered by OpenClaw's cron mechanism.

### Flow

```
Cron Trigger
    │
    ▼
1. Get all shops (sparkboost_snapshot)
    │
    ▼
┌─── For each shop (serial) ◀────────────────┐
│   │                                         │
│   ▼                                         │
│ 2. Get product list (sparkboost_list_products)
│   │                                         │
│   ▼                                         │
│ ┌─ For each product (serial) ◀────────┐    │
│ │  │                                  │    │
│ │  ▼                                  │    │
│ │ 3. Generate video prompt (AI)       │    │
│ │    Based on product title/price/desc│    │
│ │  │                                  │    │
│ │  ▼                                  │    │
│ │ 4. Submit video generation          │    │
│ │    sparkboost_grok_submit           │    │
│ │  │                                  │    │
│ │  ▼                                  │    │
│ │ 5. Poll until complete              │    │
│ │    sparkboost_grok_result           │    │
│ │    status=2 → continue              │    │
│ │    status=3 → log, next product ────┘    │
│ │  │                                       │
│ │  ▼                                       │
│ │ 6. Compliance check                      │
│ │    sparkboost_video_compliance (new tool) │
│ │    pass → continue                       │
│ │    fail → log, next product ─────────────┘
│ │  │
│ │  ▼
│ │ 7. Generate title (AI, via content-craft templates)
│ │  │
│ │  ▼
│ │ 8. Publish to shop's video account
│ │    sparkboost_publish
│ │    Continuous, no interval between publishes
│ │  │
│ │  └──── next product ────┘
│   │
│   └──── next shop ────────┘
    │
    ▼
9. Summary report
    Send to user's notification channel
    (Feishu / DingTalk / WeChat)
    - Total products processed
    - Success / fail / skip counts
    - Failure reasons
```

### Rules

| Rule | Detail |
|------|--------|
| Shop order | Serial — one shop completes before the next |
| Product order | Serial — one product fully processed before the next |
| Videos per product | 1 |
| Publish target | Product's own shop video account |
| Publish interval | None — continuous |
| Generation failure | Skip product, log reason, continue |
| Compliance failure | Skip product, log reason, continue |
| Human intervention | None — fully automated, post-hoc report only |

### New Tool Required

**`sparkboost_video_compliance`** — calls the existing SparkBoost compliance API to check if a generated video meets platform standards.

| Field | Value |
|-------|-------|
| Parameters | `videoUrl: string` |
| Returns | `pass: boolean`, `reason?: string` |
| Status | SparkBoost API already exists, needs plugin integration |

### Cron Configuration

Triggered via OpenClaw cron. Example:

```
# Every day at 10:00 AM (user timezone)
openclaw cron add --schedule "0 10 * * *" --agent marketing-staff --prompt "执行每日自动推品流程"
```

The cron session uses the `auto-publish-pipeline` skill to orchestrate all 4 underlying skills.

## Scope Boundaries

### In Scope
- 4 interactive SKILL.md files (product-scout, video-maker, content-craft, tiktok-publish)
- 1 automated pipeline skill (auto-publish-pipeline) for cron workflow
- New plugin tool: `sparkboost_video_compliance` (wrapping existing API)
- Updated preinstalled-manifest.json (requiredSkills + condensed systemPrompt)
- Remove existing `tiktok-publisher/SKILL.md` (replaced by the 5 new skills)

### Out of Scope
- Performance analytics (no API endpoint yet)
- Cross-platform publishing (TikTok only)
- Skill i18n (content follows interface language — tracked separately)
- Multi-agent orchestration

## Success Criteria

1. marketing-staff expert loads only the relevant skill for the current task (not all 5 at once)
2. Agent correctly delegates across skills for end-to-end workflows ("generate video and publish")
3. SOUL.md is under 1K tokens (down from 2.9K)
4. Each skill can be iterated independently without touching SOUL.md or other skills
5. Content safety rules prevent the agent from generating policy-violating titles
6. Cron-triggered auto-publish pipeline processes all products across all shops without human intervention
7. Compliance check blocks non-compliant videos from being published
8. Summary report delivered to user's configured notification channel after pipeline completes

## Dependencies

- SparkBoost plugin tool registration (existing tools + new compliance check tool)
- SparkBoost compliance API (existing, needs endpoint + param details)
- Expert manifest loading (existing)
- OpenClaw skill loading mechanism (existing)
- OpenClaw cron mechanism (existing)
- Plugin `openclaw.plugin.json` skill declarations
