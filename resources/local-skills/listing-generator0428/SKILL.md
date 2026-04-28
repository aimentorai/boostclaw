---
name: listing-generator0428
description: "Use this skill to generate or optimize an Amazon listing from one source ASIN for precise-follow selling. Keep the source ASIN physical facts unchanged, fetch source and competitor data with lightweight local scripts, expand keywords with SellerSprite, rank and embed keywords, and export a three-sheet workbook."
---

# listing-generator0428

Generate a better Amazon listing from one source ASIN while keeping the product facts strictly aligned to that source ASIN.

## Use this skill for

- one source ASIN listing generation
- one source ASIN listing optimization
- precise-follow selling workflows
- bilingual output: target-language listing plus Chinese draft

## Keep this light

Do not keep large raw MCP responses in chat context.

Always do this instead:

- fetch source and competitor data into local JSON files
- fetch keyword results into local files or workbooks
- only bring back short summaries into context
- never paste long raw review blocks, long bullet arrays, or full keyword tables into the conversation unless the user explicitly asks

## Hard constraints

The source ASIN is the truth for product facts.

Never change these unless the user gives verified replacement data:

- material
- dimensions
- pack size
- color family
- structure and shape
- core function
- target usage form

Do not borrow physical attributes from competitors just because their listing looks better.

## Review priority

Judge output in this order:

1. keyword precision
2. listing completeness

## Inputs

Required:

1. source ASIN
2. target workbook path or template path

Derived during workflow:

- marketplace
- source product detail JSON
- competitor pool
- keyword workbook
- retained keyword list

Default output mode:

- target marketplace language
- Chinese draft sheet

## Data source priority

Use this order for source and competitor product data:

1. `data-get.amz_product_selection`
2. `proboost-mcp.amz_sku_query`
3. `proboost-mcp.amz_sales_query`
4. Amazon frontend page only as manual verification fallback

Field trust order:

1. physical attributes from `data-get`
2. listing text from `data-get`
3. URL, category, and brand from `data-get`, then `proboost-mcp.amz_sku_query`
4. sales context from `proboost-mcp.amz_sales_query`

If sources disagree on physical attributes, stop and verify. Do not guess.

## Bundled scripts

- `scripts/fetch_listing_payload.py`
  - fetch one ASIN
  - merge `data-get` and `proboost`
  - write normalized JSON
- `scripts/relevance_estimate.py`
  - score one competitor against the source ASIN
- `scripts/keyword_relevance_pipeline.py`
  - filter and rank keywords from local JSON

## Minimal workflow

### 1. Resolve source ASIN

Run:

```bash
python scripts/fetch_listing_payload.py <ASIN> --web-site-id <id> --output source.json
```

Collect:

- title
- bullets
- description if available
- brand
- category path
- price
- reviews and rating
- dimensions and weight
- recent sales context

### 2. Build competitor pool

Target size: `10-20` ASINs.

Use:

- Amazon frontend title search: first 10 ASINs
- source leaf category context: first 10 ASINs

Then:

- merge
- deduplicate
- remove source ASIN

### 3. Normalize competitors

For each competitor ASIN, run:

```bash
python scripts/fetch_listing_payload.py <ASIN> --web-site-id <id> --output candidate.json
```

Store locally. Do not paste full payloads into chat.

### 4. Score competitor relevance

Run:

```bash
python scripts/relevance_estimate.py source.json candidate.json
```

Use the score as the main gate for competitor quality.

### 5. Expand keywords

Only this step should use SellerSprite keyword tools.

Use:

- `sellersprite-mcp.traffic_extend` for bulk traffic keyword expansion
- `sellersprite-mcp.traffic_listing` only when competitor structure needs a supplement

Expected scale:

- `100-1000` raw keywords

Save the raw result locally. Keep only summaries in chat.

### 6. Filter and rank keywords

Target remaining count:

- `30-50`

Hard rule:

- keyword relevance estimate `< 60%` means remove

Run:

```bash
python scripts/keyword_relevance_pipeline.py source.json keyword_results.json <asin_total_count>
```

Keyword ranking order:

1. composite relevance
2. monthly search or sales signal
3. purchase conversion rate

## Keyword embedding rules

- Title: top `1-3`, optionally top `1-5`
- Bullet points: top `5-20`
- Search terms: top `20` to the rest

Duplicate control:

- avoid cross-layer reuse when possible
- if keyword inventory is rich, keep near-similar keywords
- the same word should not appear in the title more than twice

## Listing writing rules

Write only after source product facts are verified.

Specificity:

- listing must be concrete
- title uses centimeters only
- bullets use both centimeters and inches

Chinese title:

- reference top competitors
- target `190-200` characters
- order:
  - pack size + precise long-tail keyword
  - brand if appropriate
  - size + material + core attributes
  - usage scenarios, maximum 3

Chinese bullets:

- summarize 5 core selling points from competitors plus source facts
- write Chinese first
- keep the bullet subject explicit so it can be replaced by keywords later

Translation:

- translate into target marketplace language
- replace bullet subject positions with selected keywords
- process marketplaces independently

## Output contract

One workbook per source ASIN.

File name:

- `ASIN + simplified Chinese product name`

Required sheets:

1. `关键词页`
2. `中文listing页`
3. `目标站点语言listing页`

## Sheet minimums

`关键词页`:

- competitor pool
- retained keywords
- title keywords
- bullet keywords
- search term keywords

`中文listing页`:

- Chinese title
- Chinese bullet 1-5

`目标站点语言listing页`:

- target-language title
- target-language bullet 1-5
- description
- search terms

## Tool map

`data-get`:

- `amz_product_selection`

`proboost-mcp`:

- `amz_sku_query`
- `amz_sales_query`
- `amz_review_query` when review samples are needed

`sellersprite-mcp`:

- `traffic_extend`
- `traffic_listing` only when needed

## Fallbacks

- if `data-get` misses an ASIN, use `proboost` summary plus manual verification
- if title search is weak, lean more on leaf category plus SellerSprite competitor structure
- if keyword count stays too high, raise the related-ASIN-count threshold
- if keyword count drops too low, relax only the count threshold, not the `<60%` relevance cutoff
- never relax the source physical fact rule

## Final checklist

- source product facts remain unchanged
- competitor pool is usable
- retained keyword list is `30-50`
- title embeds the highest-priority terms
- bullets embed mid-priority terms
- workbook has exactly three sheets
