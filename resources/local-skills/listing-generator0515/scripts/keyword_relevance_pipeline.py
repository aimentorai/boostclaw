#!/usr/bin/env python3
"""
Calculate keyword relevance from top-5 ASIN candidates and filter/sort keywords.

Input:
  python keyword_relevance_pipeline.py source.json keyword_results.json 20

Arguments:
  1. source.json
  2. keyword_results.json
  3. total competitor ASIN count

keyword_results.json shape:
{
  "keywords": [
    {
      "keyword": "cooling rack",
      "monthly_searches": 11951,
      "monthly_purchases": 948,
      "purchase_rate": 0.0794,
      "related_asin_count": 14,
      "top_asins": [
        {"asin": "...", "title": "...", "bullets": [...], "description": "...", "material": "...", "dimensions": "..."}
      ]
    }
  ]
}
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from relevance_estimate import calculate_relevance


def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text())


def keyword_relevance(source: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    top_asins = item.get("top_asins", [])[:5]
    scores = [calculate_relevance(source, candidate)["score_percent"] for candidate in top_asins]
    avg_score = round(sum(scores) / len(scores), 2) if scores else 0.0
    return {
      "keyword": item.get("keyword"),
      "monthly_searches": item.get("monthly_searches", 0) or 0,
      "monthly_purchases": item.get("monthly_purchases", 0) or 0,
      "purchase_rate": item.get("purchase_rate", 0) or 0,
      "related_asin_count": item.get("related_asin_count", 0) or 0,
      "top5_relevance_scores": scores,
      "keyword_relevance_percent": avg_score,
    }


def adaptive_related_ratio(items: list[dict[str, Any]], asin_total_count: int) -> float:
    ratio = 0.2
    filtered = items
    while len(filtered) > 50 and ratio < 0.8:
        ratio += 0.05
        filtered = [
            item
            for item in items
            if item["related_asin_count"] >= asin_total_count * ratio and item["keyword_relevance_percent"] >= 60
        ]
    return round(ratio, 2)


def composite_score(item: dict[str, Any], asin_total_count: int) -> float:
    asin_ratio = (item["related_asin_count"] / asin_total_count) if asin_total_count else 0.0
    return round(item["keyword_relevance_percent"] * 0.75 + asin_ratio * 100 * 0.25, 2)


def main() -> int:
    if len(sys.argv) != 4:
        print("Usage: python keyword_relevance_pipeline.py source.json keyword_results.json asin_total_count", file=sys.stderr)
        return 1

    source = load_json(sys.argv[1])
    keyword_payload = load_json(sys.argv[2])
    asin_total_count = int(sys.argv[3])

    evaluated = [keyword_relevance(source, item) for item in keyword_payload.get("keywords", [])]
    ratio_threshold = adaptive_related_ratio(evaluated, asin_total_count)

    retained = []
    removed = []
    for item in evaluated:
        remove_reason = None
        if item["keyword_relevance_percent"] < 60:
            remove_reason = "keyword_relevance_below_60"
        elif item["related_asin_count"] < asin_total_count * ratio_threshold:
            remove_reason = "related_asin_count_below_threshold"

        item["related_ratio_threshold"] = ratio_threshold
        item["related_ratio_percent"] = round((item["related_asin_count"] / asin_total_count) * 100, 2) if asin_total_count else 0.0
        item["composite_relevance"] = composite_score(item, asin_total_count)

        if remove_reason:
            item["remove_reason"] = remove_reason
            removed.append(item)
        else:
            retained.append(item)

    retained.sort(
        key=lambda item: (
            -item["composite_relevance"],
            -(item["monthly_searches"] or 0),
            -(item["purchase_rate"] or 0),
        )
    )

    result = {
        "asin_total_count": asin_total_count,
        "related_ratio_threshold": ratio_threshold,
        "retained_count": len(retained),
        "removed_count": len(removed),
        "retained_keywords": retained,
        "removed_keywords": removed,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
