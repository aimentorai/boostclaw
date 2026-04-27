---
name: rising-seller-leads
description: >
  Find same-category rising sellers on Amazon and TikTok Shop for factory B2B outreach.
  Trigger: 上升期卖家, 同类目卖家, 建联池, 潜在客户, 增长中的店铺,
  卖家线索, 适合工厂供货的卖家, 找客户, Amazon/TK seller leads,
  outreach targets, 哪些卖家在扩品, 卖家建联, 开发客户.
---

# Rising Seller Leads

## Goal

Build a practical B2B outreach pool for factories:

`类目发现 -> 同类目定义 -> proboost-mcp 增长卖家识别 -> 去重采样 -> 质量过滤 -> 建联线索输出`

Use this skill when the user wants names and prioritization of sellers worth contacting, not just a generic seller list.

## Hard Rules

- Use `proboost-mcp` for Amazon/TikTok Shop/TK platform data: category, SKU, seller/shop, sales, GMV, price, review, new products, creator/video heat, shop growth, and trend signals.
- If `proboost-mcp` tools are not visible, discover/search for `proboost-mcp` first. If still unavailable, stop and say the data source is unavailable; do not replace it with invented lead data.
- Do not invent contact information. Only include email, website, LinkedIn, Instagram, TikTok account, or official store links when returned by proboost-mcp or found from a clearly public business source.
- Exclude or down-rank platform self-operated accounts, dominant mega-brands, pure low-price white-label copycats, and sellers with no visible supplier-fit reason.
- Answer in Chinese by default. Output should be directly usable by a factory BD or boss.

## Workflow

1. Normalize the factory's product/category into a `同类目定义`.
2. Use proboost-mcp to discover candidate Amazon sellers and/or TikTok Shop shops in that category.
3. Deduplicate and sample.
4. Score growth with 30/60/90 day signals and expansion signals.
5. Filter candidates for supplier fit and contactability.
6. Output a ranked `建联池` with touch order, fit reason, and missing-data flags.

Load [references/rubric.md](references/rubric.md) before scoring and final output.

## 1. Define Same Category

Create a short `同类目定义` before querying:

- `产品语义`: what the product is and the buyer problem/use case.
- `平台关键词`: 2-5 Amazon English keywords and 2-5 TikTok creator/shop phrases.
- `类目路径`: Amazon category node and TikTok Shop category if known.
- `价格带`: factory target price and marketplace price band.
- `客群`: target buyer/user, e.g. pet owners, curly-hair users, new moms.
- `属性`: material, size, function, power/specs, bundle/accessories.
- `供应链相似度`: what kinds of sellers can realistically buy from this factory.

If the user only gives a product image/title/link, infer the category but state the assumption.

## 2. Query Data

Query proboost-mcp for candidate discovery per platform.

**Amazon**: category/keyword → SKU candidates → seller extraction → sales trend → review signals → market context.

**TikTok Shop**: category mapping → product candidates → shop-level growth → SKU expansion → creator/video/live signals.

When the user asks for both Amazon and TK, query both. When they ask for one platform, stay focused.

**Degradation rule**: If a platform returns partial data, proceed with available signals. Only stop when both platforms return zero data.

## 3. Deduplicate & Sample

- **Cross-platform dedup**: Same brand/seller on Amazon AND TikTok Shop → merge into one row, show both platforms, pick the stronger growth signal for scoring.
- **Sampling**: When a category returns >30 candidates, rough-score by growth signal first, then full-score only the top 15. Tell the user: `共发现 X 个候选卖家，以下为综合评分最高的 15 个`

## 4. Identify Rising Sellers

Prefer seller/shop-level growth signals. If seller-level trend is unavailable, infer cautiously from the seller's product-level signals and label it `商品侧推断`.

Look for:

- Recent 30/60/90 day sales or GMV growth.
- New SKU/product expansion in the same category.
- Review count or review velocity growth.
- TikTok content burst: new videos, creator count, live volume, views, GMV slope.
- Shop SKU count or active-product count growth.
- Ads, affiliate, creator, or live selling signs.
- Mid-sized seller behavior: enough traction to buy, not so large that supplier switching is impossible.

## 5. Score & Filter

Score each candidate 0-100 using the rubric. Base weights:

- `Category Fit` 0-25 | `Growth` 0-25 | `Supplier Fit` 0-20 | `Contactability` 0-15 | `Strategic Accessibility` 0-15

Adjust per context (if user doesn't specify, use base weights):

- **New factory, first outreach**: Contactability +10, Growth -10
- **Established factory, expanding**: Supplier Fit +10, Accessibility -10
- **Category with few sellers**: Category Fit → 15, Growth → 35

Rank candidates higher when they show:

- Public business contact channel: official website, seller storefront, LinkedIn, Instagram, TikTok business account, email, or shop link.
- Product line fit with factory capabilities.
- Recent expansion into adjacent SKUs.
- Gaps that a factory can solve: cost, MOQ, variant speed, material quality, packaging, compliance, bundle design, or private label supply.
- Not fully locked to a giant brand or Amazon retail.

Filter out or clearly mark:

- Amazon.com/platform self-operated seller when supplier outreach is unlikely.
- Mega-brands with strong in-house supply chain unless the user explicitly wants brand leads.
- Extreme low-price sellers with weak quality or no margin.
- Sellers with no identifiable public contact route.
- Sellers whose products are not actually supply-chain similar despite keyword overlap.

## 6. Output

Default final answer:

1. `一句话结论`: what kind of sellers are worth targeting.
2. `同类目定义`: the normalized category and price band used.
3. `建联池`: ranked table with 5-15 candidates.
4. `优先触达顺序`: A/B/C priority and why.
5. `建联话术切入点`: 1-3 short angles based on the seller's growth signal and supplier gap.
6. `数据缺口`: missing proboost metrics or contact fields.

Keep the table actionable. Avoid long market-report prose unless the user asks for analysis.

Required table columns:

| 优先级 | 卖家/店铺 | 平台 | 主打产品 | 增长信号 | 联系方式来源 | 适配理由 | 下一步 |
|---|---|---|---|---|---|---|---|

If a field is missing, write `proboost暂未返回` or `公开渠道待补`, not a guess.

## 7. Follow-up

After the 建联池, append a session-scoped tracker:

```
📋 本轮建联追踪
- 建联池: X 位卖家 (A×Y, B×Z)
- 待补数据: [missing fields]
- 建议下一步: [specific action]
```

When user returns saying "联系了A类那几个" or "B类有没有更新数据", re-query growth signals for those sellers and update the tracker.
