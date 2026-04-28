#!/usr/bin/env python3
"""
Estimate listing relevance between a source ASIN and a candidate ASIN.

Input:
  python relevance_estimate.py source.json candidate.json

Each JSON file should contain as many of these fields as possible:
{
  "asin": "B08S6WL5DS",
  "title": "...",
  "bullets": ["...", "..."],
  "description": "...",
  "color": "silver",
  "material": "18/8 stainless steel",
  "dimensions": "38.7 x 28.3 x 1.5 cm",
  "pack_size": "2 pack",
  "shape": "rectangular",
  "functions": ["cooling", "baking", "roasting"],
  "target_users": ["home bakers"]
}

Output:
  JSON with total percentage score and component scores.
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path
from typing import Any


COLOR_WORDS = {
    "black",
    "white",
    "silver",
    "gold",
    "grey",
    "gray",
    "red",
    "blue",
    "green",
    "pink",
    "clear",
    "transparent",
    "brown",
}

MATERIAL_GROUPS = {
    "stainless steel": {"stainless steel", "18/8 stainless steel", "18/0 stainless steel", "steel"},
    "carbon steel": {"carbon steel"},
    "silicone": {"silicone"},
    "aluminum": {"aluminium", "aluminum"},
    "plastic": {"plastic"},
    "wood": {"wood", "bamboo"},
    "iron": {"iron", "cast iron"},
}

SHAPE_WORDS = {
    "rectangular": {"rectangle", "rectangular", "oblong"},
    "round": {"round", "circle", "circular"},
    "square": {"square"},
    "oval": {"oval"},
    "folding": {"folding", "collapsible"},
    "grid": {"grid", "wire", "mesh"},
}

FUNCTION_WORDS = {
    "cooling": {"cooling", "cool"},
    "baking": {"baking", "bake"},
    "roasting": {"roasting", "roast"},
    "grilling": {"grilling", "grill", "bbq", "barbecue"},
    "drying": {"drying", "dry"},
    "draining": {"drain", "draining"},
    "serving": {"serving", "serve"},
}

USER_WORDS = {
    "home bakers": {"home baker", "home bakers"},
    "professional chefs": {"professional chef", "professional chefs", "chef", "chefs"},
    "beginners": {"beginner", "beginners"},
    "families": {"family", "families"},
}

STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "your",
    "most",
    "will",
    "are",
    "can",
    "use",
    "set",
    "pack",
    "piece",
    "pieces",
    "inch",
    "inches",
    "cm",
}

WEIGHTS = {
    "material": 24,
    "dimensions": 22,
    "shape": 14,
    "function": 14,
    "color": 8,
    "target_user": 8,
    "pack_size": 6,
    "text_support": 4,
}


def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text())


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        value = " ".join(str(item) for item in value)
    text = str(value).lower()
    text = text.replace("&amp;", "&")
    text = re.sub(r"[^a-z0-9.\s/+x-]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def combined_text(data: dict[str, Any]) -> str:
    parts = [
        data.get("title", ""),
        " ".join(data.get("bullets", []) or []),
        data.get("description", ""),
        data.get("color", ""),
        data.get("material", ""),
        data.get("dimensions", ""),
        data.get("pack_size", ""),
        data.get("shape", ""),
        " ".join(data.get("functions", []) or []),
        " ".join(data.get("target_users", []) or []),
    ]
    return normalize_text(" ".join(str(p) for p in parts if p))


def extract_color(text: str) -> str:
    for word in COLOR_WORDS:
        if re.search(rf"\b{re.escape(word)}\b", text):
            return word
    return ""


def normalize_material(text: str) -> str:
    for canonical, variants in MATERIAL_GROUPS.items():
        for variant in variants:
            if variant in text:
                return canonical
    return ""


def extract_shape(text: str) -> set[str]:
    found = set()
    for canonical, variants in SHAPE_WORDS.items():
        for variant in variants:
            if re.search(rf"\b{re.escape(variant)}\b", text):
                found.add(canonical)
    return found


def extract_functions(text: str) -> set[str]:
    found = set()
    for canonical, variants in FUNCTION_WORDS.items():
        for variant in variants:
            if re.search(rf"\b{re.escape(variant)}\b", text):
                found.add(canonical)
    return found


def extract_target_users(text: str) -> set[str]:
    found = set()
    for canonical, variants in USER_WORDS.items():
        for variant in variants:
            if variant in text:
                found.add(canonical)
    return found


def extract_pack_size(text: str) -> int | None:
    patterns = [
        r"\b(\d+)\s*(?:pack|packs)\b",
        r"\bset of\s*(\d+)\b",
        r"\b(\d+)\s*(?:piece|pieces|pcs)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return int(match.group(1))
    return None


def extract_dimensions_cm(text: str) -> list[float]:
    match = re.search(
        r"(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:[x×]\s*(\d+(?:\.\d+)?))?\s*(cm|inch|in|inches)?",
        text,
    )
    if not match:
        return []
    values = [float(group) for group in match.groups()[:3] if group is not None]
    unit = match.group(4) or "cm"
    factor = 2.54 if unit in {"inch", "in", "inches"} else 1.0
    return sorted(round(value * factor, 2) for value in values)


def tokenize(text: str) -> set[str]:
    tokens = set(re.findall(r"[a-z0-9]+", text))
    return {token for token in tokens if token not in STOPWORDS and len(token) > 1}


def jaccard(left: set[str], right: set[str]) -> float:
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def dimension_score(source_dims: list[float], candidate_dims: list[float]) -> float:
    if not source_dims and not candidate_dims:
        return 1.0
    if not source_dims or not candidate_dims:
        return 0.0
    pairs = min(len(source_dims), len(candidate_dims))
    if pairs == 0:
        return 0.0
    total = 0.0
    for src, cand in zip(source_dims[:pairs], candidate_dims[:pairs]):
        if max(src, cand) == 0:
            pair_score = 1.0
        else:
            ratio = min(src, cand) / max(src, cand)
            pair_score = max(0.0, min(1.0, ratio))
        total += pair_score
    length_penalty = pairs / max(len(source_dims), len(candidate_dims))
    return (total / pairs) * length_penalty


def material_score(source_material: str, candidate_material: str) -> float:
    if not source_material and not candidate_material:
        return 1.0
    if not source_material or not candidate_material:
        return 0.0
    return 1.0 if source_material == candidate_material else 0.15


def pack_size_score(source_pack: int | None, candidate_pack: int | None) -> float:
    if source_pack is None and candidate_pack is None:
        return 1.0
    if source_pack is None or candidate_pack is None:
        return 0.0
    return 1.0 if source_pack == candidate_pack else 0.2


def color_score(source_color: str, candidate_color: str) -> float:
    if not source_color and not candidate_color:
        return 1.0
    if not source_color or not candidate_color:
        return 0.0
    if source_color == candidate_color:
        return 1.0
    if {source_color, candidate_color} <= {"grey", "gray"}:
        return 0.9
    return 0.1


def text_support_score(source_text: str, candidate_text: str) -> float:
    return jaccard(tokenize(source_text), tokenize(candidate_text))


def build_features(data: dict[str, Any]) -> dict[str, Any]:
    text = combined_text(data)
    return {
        "text": text,
        "color": normalize_text(data.get("color", "")) or extract_color(text),
        "material": normalize_material(normalize_text(data.get("material", "")) or text),
        "shape": set(data.get("shape", [])) if isinstance(data.get("shape"), list) else extract_shape(text),
        "functions": set(data.get("functions", [])) if isinstance(data.get("functions"), list) else extract_functions(text),
        "target_users": set(data.get("target_users", []))
        if isinstance(data.get("target_users"), list)
        else extract_target_users(text),
        "pack_size": extract_pack_size(normalize_text(data.get("pack_size", "")) or text),
        "dimensions_cm": extract_dimensions_cm(normalize_text(data.get("dimensions", "")) or text),
    }


def calculate_relevance(source: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    source_features = build_features(source)
    candidate_features = build_features(candidate)

    components = {
        "material": material_score(source_features["material"], candidate_features["material"]),
        "dimensions": dimension_score(source_features["dimensions_cm"], candidate_features["dimensions_cm"]),
        "shape": jaccard(source_features["shape"], candidate_features["shape"]),
        "function": jaccard(source_features["functions"], candidate_features["functions"]),
        "color": color_score(source_features["color"], candidate_features["color"]),
        "target_user": jaccard(source_features["target_users"], candidate_features["target_users"]),
        "pack_size": pack_size_score(source_features["pack_size"], candidate_features["pack_size"]),
        "text_support": text_support_score(source_features["text"], candidate_features["text"]),
    }

    weighted = sum(components[key] * WEIGHTS[key] for key in WEIGHTS)
    total = weighted

    penalties = []
    if components["material"] < 0.4:
        total *= 0.65
        penalties.append("material_mismatch_penalty")
    if components["dimensions"] < 0.35:
        total *= 0.75
        penalties.append("dimension_mismatch_penalty")
    if components["shape"] < 0.3:
        total *= 0.8
        penalties.append("shape_mismatch_penalty")
    if components["pack_size"] < 0.3:
        total *= 0.85
        penalties.append("pack_size_penalty")

    score_percent = round(max(0.0, min(100.0, total)), 2)
    component_percent = {key: round(value * 100, 2) for key, value in components.items()}

    return {
        "source_asin": source.get("asin"),
        "candidate_asin": candidate.get("asin"),
        "score_percent": score_percent,
        "component_scores": component_percent,
        "penalties": penalties,
        "source_features": source_features,
        "candidate_features": candidate_features,
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: python relevance_estimate.py source.json candidate.json", file=sys.stderr)
        return 1
    source = load_json(sys.argv[1])
    candidate = load_json(sys.argv[2])
    result = calculate_relevance(source, candidate)
    print(json.dumps(result, ensure_ascii=False, indent=2, default=list))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
