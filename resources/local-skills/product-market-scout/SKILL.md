---
name: product-market-scout
description: >
  Analyze product/category sales on Amazon and TikTok Shop.
  Trigger: 卖得怎么样, 有没有机会, 蓝海/红海, 哪个平台适合,
  涨还是掉, 能不能做, Amazon/TK sales/trend/BSR/GMV,
  工厂是否适合切入, 选品分析, 市场机会, 最近30天, 利润空间,
  值不值得做, 竞争激不激烈.
---

# Product Market Scout

## Goal

Turn a boss-style question into a data-backed Chinese business conclusion:

`自然语言查询 -> 标准化商品识别 -> proboost-mcp 多平台数据查询 -> 规则判断 -> 老板能看懂的中文结论 + 简表卡片`

Use this skill for quick executive product checks, not long market reports unless the user asks for depth.

## Hard Rules

- Use `proboost-mcp` for every place that needs current product, category, Amazon, TikTok Shop, sales, GMV, BSR, price, review, seller, creator, video, or trend data.
- If `proboost-mcp` tools are not visible, discover them first with tool discovery/search for `proboost-mcp`. If they still cannot be called, stop and say the data source is unavailable; do not replace it with guesses.
- Never invent numeric market data. If a metric is missing, say `proboost 暂未返回` or `数据不足`, then lower confidence.
- Answer in Chinese by default. Keep the final answer executive-friendly: conclusion first, table second, caveats last.
- Default marketplace assumptions: Amazon = US, TikTok Shop/TK = US, trend window = last 30 days. State these assumptions only when they affect the answer.

## Workflow

1. Identify the product signal from the user's query.
2. Normalize it into platform-ready product expressions.
3. Query proboost-mcp for Amazon/TikTok/category data.
4. Judge trend, competition, margin health, and factory-entry fit.
5. Output a short Chinese conclusion plus a compact comparison card.

For detailed thresholds and table wording, load [references/rubric.md](references/rubric.md) before final judgment.

## 1. Identify Product Signal

Classify the input into one or more signal types:

- `keyword`: e.g. `蓝牙耳机`, `猫抓板`.
- `marketplace link`: Amazon/TikTok Shop/TK URL, ASIN, product ID, shop link.
- `source link`: 1688, Taobao, Alibaba, factory catalog, supplier page.
- `image`: product photo or screenshot.
- `title`: marketplace title, listing title, factory title.
- `factory SKU`: internal item number or style code.
- `category`: broad category or subcategory, e.g. `宠物用品里的猫抓板`.

If the signal is ambiguous, infer the most likely product and continue with a clearly labeled assumption. Ask a concise clarifying question only when a wrong product mapping would make the answer misleading.

## 2. Normalize Product

Create a compact `Product Map` before querying:

- `工厂款式名`: Chinese product name or internal style name.
- `Amazon关键词`: 2-5 English search terms and likely category.
- `TikTok表达`: 2-5 creator/shop-friendly phrases, including use-case wording.
- `类目归属`: Amazon category and TikTok Shop category if inferable.
- `核心属性`: material, size, function, target user, price tier, differentiators.
- `输入来源`: keyword/link/image/title/SKU/category and any extracted IDs.

For links, query the exact listing first, then broaden to category/keyword peers. For 1688/factory items, map source-title attributes to Amazon/TikTok buyer-facing terms before searching.

Remember the Product Map within the session. When user follows up with "换个类目" or "TK那边呢", reuse the map and only re-query the changed dimension.

## 3. Query Data

Query proboost-mcp with a priority order:

1. **Exact match first**: product ID, ASIN, shop link, URL → direct lookup
2. **Category/keyword second**: broaden when exact match returns nothing

Collect per-platform signals (query all that apply):

- **Amazon**: sales trend (7/30/90d), BSR, price band, reviews, seller count, variations, category rank
- **TikTok Shop**: GMV trend, top shops/products, creator intensity, video heat, content patterns
- **Category**: keyword trend, rising/declining products, price movement, competition movement

If user asks "哪个平台更适合做", query both Amazon and TikTok Shop unless one platform is clearly outside scope.

**Degradation rule**: If a platform returns partial data, proceed with available signals and label gaps explicitly (`proboost暂未返回`). Only stop when ALL platforms return zero data.

## 4. Judge

Use the rubric reference to label:

- `盘子阶段`: 上升盘 / 稳定盘 / 下滑盘 / 早期起量 / 数据不足.
- `竞争强度`: 低 / 中 / 高.
- `利润空间`: 健康 / 一般 / 偏薄 / 需要成本确认.
- `工厂切入`: 适合小单测试 / 适合做供应链切入 / 不建议直接切 / 只适合差异化切入.
- `建议平台`: Amazon / TikTok Shop / 两边都可 / 先TK测款再Amazon / 暂不建议.

Prefer balanced judgment over hype. A product with high demand and high competition is not automatically a good opportunity.

## 5. Output Format

**Quick answer** (default — single product, simple question):

1. `一句话结论`: 1-2 sentences, direct enough for a boss.
2. `简表卡片`: compact Markdown table comparing Amazon and TikTok Shop/TK.
3. `下一步`: one practical action, e.g. `先测 TK 20-50 单`, `找 3 个差异化卖点`.

**Deep answer** (user asks for depth, multi-product, or comparison):

Add after the quick answer:

4. `为什么`: 3-5 short bullets with the strongest data-backed reasons.
5. `缺口/风险`: only when data is missing or confidence is limited.

Example tone:

`这个产品在 Amazon 属于成熟稳定盘，近30天需求平稳但卖家拥挤；TikTok Shop 还在起量早期，内容热度有信号，更适合先用小单测款。`

Keep the table short enough to paste into chat.
