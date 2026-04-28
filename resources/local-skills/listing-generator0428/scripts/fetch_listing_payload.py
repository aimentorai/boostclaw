#!/usr/bin/env python3
"""
Fetch normalized Amazon listing and detail data for one ASIN.

Priority:
1. data-get.amz_product_selection for listing text and detail facts
2. proboost-mcp.amz_sku_query for structured summary backfill
3. proboost-mcp.amz_sales_query for sales context

Usage:
  python scripts/fetch_listing_payload.py B0CRV4CSNW --web-site-id 2 --output source.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import requests


SERVER_ENV = {
    "data-get": ("LISTING_DATA_GET_URL", "LISTING_DATA_GET_SECRET"),
    "proboost-mcp": ("LISTING_PROBOOST_URL", "LISTING_PROBOOST_SECRET"),
}

CONFIG_FALLBACKS = [
    Path.home() / ".codex" / "config.toml",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("asin", help="Amazon ASIN")
    parser.add_argument("--web-site-id", dest="web_site_id", help="Amazon marketplace id, e.g. 2 for UK")
    parser.add_argument("--output", help="Write normalized JSON to this path")
    return parser.parse_args()


def load_server_config(server_name: str) -> dict[str, str]:
    url_env, secret_env = SERVER_ENV[server_name]
    url = os.getenv(url_env, "").strip()
    secret = os.getenv(secret_env, "").strip()
    if url and secret:
        return {"url": url, "secret": secret}

    for config_path in CONFIG_FALLBACKS:
        config = load_codex_server_config(config_path, server_name)
        if config.get("url") and config.get("secret"):
            return config

    raise RuntimeError(f"Missing MCP config for {server_name}")


def load_codex_server_config(path: Path, server_name: str) -> dict[str, str]:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    section_pattern = rf"^\[mcp_servers\.{re.escape(server_name)}\]\s*$"
    header_pattern = rf"^\[mcp_servers\.{re.escape(server_name)}\.headers\]\s*$"
    current = None
    data: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if re.match(section_pattern, line):
            current = "server"
            continue
        if re.match(header_pattern, line):
            current = "headers"
            continue
        if line.startswith("[") and line.endswith("]"):
            current = None
            continue
        if "=" not in line or current is None:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"')
        if current == "server" and key == "url":
            data["url"] = value
        elif current == "headers" and key == "secret-key":
            data["secret"] = value
    return data


def mcp_endpoint(url: str) -> str:
    clean = url.rstrip("/")
    if clean.endswith("/sse"):
        return clean[:-4] + "/mcp"
    if clean.endswith("/mcp"):
        return clean
    return clean + "/mcp"


def call_tool(server_name: str, tool_name: str, arguments: dict[str, Any]) -> str:
    config = load_server_config(server_name)
    response = requests.post(
        mcp_endpoint(config["url"]),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "secret-key": config["secret"],
        },
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        },
        timeout=90,
    )
    response.raise_for_status()
    payload = response.json()
    if payload.get("error"):
        raise RuntimeError(f"{server_name}.{tool_name} failed: {payload['error']}")
    content = payload.get("result", {}).get("content", [])
    if not content:
        return ""
    return content[0].get("text", "")


def extract_value(text: str, label: str) -> str:
    match = re.search(rf"{re.escape(label)}：([^\n]*)", text)
    if not match:
        return ""
    return match.group(1).strip()


def parse_brand(raw: str) -> str:
    raw = raw.strip()
    if not raw or raw == "null":
        return ""
    if raw.startswith("{") and raw.endswith("}"):
        store = re.search(r'"store"\s*:\s*"([^"]+)"', raw)
        if store:
            return store.group(1)
    return raw


def parse_number(raw: str) -> int | float | None:
    raw = raw.strip()
    if not raw or raw == "null" or raw == "-":
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", raw.replace(",", ""))
    if not match:
        return None
    value = float(match.group(0))
    if value.is_integer():
        return int(value)
    return value


def parse_list(raw: str) -> list[str]:
    raw = raw.strip()
    if not raw or raw == "null":
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(item).strip() for item in data if str(item).strip()]
    except json.JSONDecodeError:
        pass
    return [raw]


def parse_data_get(text: str) -> dict[str, Any]:
    if "无符合条件的数据" in text or "总条数：0" in text:
        return {}
    description = ""
    if "商品描述：" in text:
        description = text.split("商品描述：", 1)[1].strip()
    bullets = parse_list(extract_value(text, "商品特征"))
    return {
        "title": extract_value(text, "商品标题"),
        "asin": extract_value(text, "SKU ID"),
        "spu_id": extract_value(text, "SPU ID"),
        "marketplace": extract_value(text, "站点"),
        "price_display": extract_value(text, "售价"),
        "price": parse_number(extract_value(text, "售价数值")),
        "currency": extract_value(text, "货币单位"),
        "rating": parse_number(extract_value(text, "评分星级")),
        "review_count": parse_number(extract_value(text, "评价次数")),
        "monthly_sales_30d": parse_number(extract_value(text, "近30天SKU销量")),
        "monthly_spu_sales_30d": parse_number(extract_value(text, "近30天SPU销量")),
        "variant_count": parse_number(extract_value(text, "变体数")),
        "seller_name": extract_value(text, "卖家名称"),
        "category": extract_value(text, "类目名称"),
        "cat_id": extract_value(text, "类目ID"),
        "category_path": extract_value(text, "类目路径"),
        "brand": parse_brand(extract_value(text, "品牌")),
        "dimensions": extract_value(text, "尺寸"),
        "weight": extract_value(text, "重量"),
        "availability": extract_value(text, "库存状态"),
        "date_first_available": extract_value(text, "上架日期"),
        "product_url": extract_value(text, "商品链接"),
        "image_url": extract_value(text, "主图链接"),
        "bullets": bullets,
        "description": description,
    }


def parse_proboost_sku(text: str) -> dict[str, Any]:
    if "无数据" in text:
        return {}
    def capture(pattern: str) -> str:
        match = re.search(pattern, text)
        return match.group(1).strip() if match else ""

    category_line = capture(r"- \*\*类目\*\*: (.+)")
    category = ""
    cat_id = ""
    if category_line:
        cat_match = re.match(r"(.+?)（catId:\s*([^)]+)）", category_line)
        if cat_match:
            category = cat_match.group(1).strip()
            cat_id = cat_match.group(2).strip()
        else:
            category = category_line

    rating = None
    review_count = None
    rating_line = capture(r"- \*\*评分/评论数\*\*: (.+)")
    if rating_line:
        parts = [part.strip() for part in rating_line.split("/")]
        if parts:
            rating = parse_number(parts[0])
        if len(parts) > 1:
            review_count = parse_number(parts[1])

    return {
        "title": capture(r"- \*\*标题\*\*: (.+)"),
        "product_url": capture(r"- \*\*链接\*\*: (.+)"),
        "brand": parse_brand(capture(r"- \*\*品牌\*\*: (.+)")),
        "image_url": capture(r"- \*\*主图\*\*: (.+)"),
        "rating": rating,
        "review_count": review_count,
        "category": category,
        "cat_id": cat_id,
        "category_path": capture(r"- \*\*类目路径\*\*: (.+)"),
        "recent_sales_text": capture(r"- \*\*销量信息\*\*: (.+)"),
        "seller_name": capture(r"- \*\*卖家\*\*: (.+)"),
        "availability": capture(r"- \*\*发货地\*\*: (.+)"),
    }


def parse_proboost_sales(text: str) -> dict[str, Any]:
    if "无数据" in text:
        return {}
    monthly_sales = None
    prev_monthly_sales = None
    line = re.search(r"- \*\*近30天销量\*\*: ([^\n]+)", text)
    if line:
        monthly_text = line.group(1)
        sales_match = re.search(r"(\d+)", monthly_text)
        if sales_match:
            monthly_sales = int(sales_match.group(1))
        prev_match = re.search(r"上期30天\*\*: (\d+)", monthly_text)
        if prev_match:
            prev_monthly_sales = int(prev_match.group(1))

    sales_history: list[dict[str, Any]] = []
    history = re.search(r"- \*\*销量说明\*\*: (.+)", text)
    if history:
        raw = history.group(1).strip()
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                sales_history = parsed
        except json.JSONDecodeError:
            pass
    return {
        "monthly_sales_30d": monthly_sales,
        "previous_monthly_sales_30d": prev_monthly_sales,
        "sales_history": sales_history,
    }


def pick(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and (not value.strip() or value.strip() in {"null", "-"}):
            continue
        if isinstance(value, list) and not value:
            continue
        return value
    return None


def pick_text(*values: Any) -> str:
    value = pick(*values)
    if value is None:
        return ""
    return str(value)


def merge_payload(asin: str, web_site_id: str | None, data_get: dict[str, Any], proboost_sku: dict[str, Any], proboost_sales: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "asin": asin,
        "web_site_id": web_site_id or "",
        "marketplace": pick_text(data_get.get("marketplace")),
        "title": pick_text(data_get.get("title"), proboost_sku.get("title")),
        "bullets": pick(data_get.get("bullets"), []) or [],
        "description": pick_text(data_get.get("description")),
        "brand": pick_text(data_get.get("brand"), proboost_sku.get("brand")),
        "product_url": pick_text(data_get.get("product_url"), proboost_sku.get("product_url")),
        "image_url": pick_text(data_get.get("image_url"), proboost_sku.get("image_url")),
        "category": pick_text(data_get.get("category"), proboost_sku.get("category")),
        "category_path": pick_text(data_get.get("category_path"), proboost_sku.get("category_path")),
        "cat_id": pick_text(data_get.get("cat_id"), proboost_sku.get("cat_id")),
        "price": pick(data_get.get("price"), None),
        "price_display": pick_text(data_get.get("price_display")),
        "currency": pick_text(data_get.get("currency")),
        "rating": pick(data_get.get("rating"), proboost_sku.get("rating"), None),
        "review_count": pick(data_get.get("review_count"), proboost_sku.get("review_count"), None),
        "monthly_sales_30d": pick(data_get.get("monthly_sales_30d"), proboost_sales.get("monthly_sales_30d"), None),
        "recent_sales_text": pick_text(proboost_sku.get("recent_sales_text")),
        "dimensions": pick_text(data_get.get("dimensions")),
        "weight": pick_text(data_get.get("weight")),
        "availability": pick_text(data_get.get("availability"), proboost_sku.get("availability")),
        "date_first_available": pick_text(data_get.get("date_first_available")),
        "sales_history": pick(proboost_sales.get("sales_history"), []),
        "source_priority": {
            "listing_text": "data-get.amz_product_selection",
            "detail_facts": "data-get.amz_product_selection",
            "summary_backfill": "proboost-mcp.amz_sku_query",
            "sales_context": "proboost-mcp.amz_sales_query",
        },
        "raw_sources": {
            "data_get": data_get,
            "proboost_sku": proboost_sku,
            "proboost_sales": proboost_sales,
        },
    }

    missing_fields = []
    for key in [
        "title",
        "bullets",
        "description",
        "brand",
        "product_url",
        "category_path",
        "dimensions",
    ]:
        value = normalized.get(key)
        if value in ("", None, []) or (isinstance(value, list) and not value):
            missing_fields.append(key)
    normalized["missing_fields"] = missing_fields
    return normalized


def main() -> int:
    args = parse_args()
    data_get_args: dict[str, Any] = {"skuId": args.asin, "pages": 1, "pagesSize": 5}
    proboost_args: dict[str, Any] = {"skuId": args.asin}
    if args.web_site_id:
        data_get_args["webSiteId"] = args.web_site_id
        proboost_args["webSiteId"] = args.web_site_id

    data_get_text = call_tool("data-get", "amz_product_selection", data_get_args)
    proboost_sku_text = call_tool("proboost-mcp", "amz_sku_query", proboost_args)
    proboost_sales_text = call_tool("proboost-mcp", "amz_sales_query", proboost_args)

    data_get = parse_data_get(data_get_text)
    proboost_sku = parse_proboost_sku(proboost_sku_text)
    proboost_sales = parse_proboost_sales(proboost_sales_text)
    payload = merge_payload(args.asin, args.web_site_id, data_get, proboost_sku, proboost_sales)

    if not payload["title"] and not payload["product_url"]:
        raise RuntimeError(f"No listing payload could be resolved for {args.asin}")

    output = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
