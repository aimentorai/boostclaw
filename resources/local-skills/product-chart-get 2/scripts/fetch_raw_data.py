#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Step 1: 命令行调用 MCP 获取原始数据（通过 mcporter）
Step 2: 解析文本输出，转为 JSON 写入 raw_data.json

用法：
    python3 fetch_raw_data.py --date 20260407 --page 1 --size 20
    python3 fetch_raw_data.py --date 20260407 --page 1 --size 20 --output ~/Desktop/20260407选品
"""

import re
import json
import os
import sys
import subprocess
from pathlib import Path
from datetime import datetime


def get_default_workspace():
    workspace = os.getenv('WORKSPACE')
    if workspace:
        return os.path.expanduser(workspace)
    return os.path.expanduser('~/Desktop')


def parse_args():
    import argparse
    parser = argparse.ArgumentParser(description='通过 mcporter 调用 MCP 获取原始数据')
    parser.add_argument('--date', '-d', required=True, help='分区日期 YYYYMMDD')
    parser.add_argument('--page', '-p', type=int, default=1, help='页码')
    parser.add_argument('--size', '-s', type=int, default=20, help='每页条数 (1-50)')
    parser.add_argument('--output', '-o', help='输出目录 (默认: {WORKSPACE}/{date}选品/)')
    args = parser.parse_args()

    output_dir = args.output or str(Path(get_default_workspace()) / f"{args.date}选品")
    os.makedirs(output_dir, exist_ok=True)
    return args.date, args.page, args.size, output_dir


def call_mcp(ds, page, size):
    """通过 mcporter 调用 tmallGeniePageQuery"""
    cmd = [
        'mcporter', 'call', 'data-get.tmallGeniePageQuery',
        f'ds:{ds}',
        f'current:{page}',
        f'size:{size}'
    ]
    print(f"执行: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"错误: {result.stderr}")
        sys.exit(1)
    return result.stdout


def parse_mcp_text(text, page=1, size=50):
    """解析 mcporter 返回的文本格式，转为结构化 JSON"""
    products = []
    blocks = re.split(r'————————————————————————————————', text)

    for block in blocks:
        block = block.strip()
        if not block or 'SKU ID' not in block:
            continue

        p = {}

        def ext(pattern, default=''):
            m = re.search(pattern, block)
            return m.group(1).strip() if m else default

        # 基础信息
        p['分区日期'] = ext(r'分区日期：(\d+)')
        p['SKU_ID'] = ext(r'SKU ID：(.+)')
        p['SPU_ID'] = ext(r'SPU ID：(.+)')
        p['英文标题'] = ext(r'商品标题：(.+)')
        p['商品链接'] = ext(r'商品链接：(https?://\S+)')
        p['主图链接'] = ext(r'主图链接：(https?://\S+)')

        # 类目信息
        p['一级类目ID'] = ext(r'一级类目ID：(.+)')
        p['一级类目'] = ext(r'一级类目名称：(.+)')
        p['类目ID路径'] = ext(r'类目ID路径：(.+)')
        p['类目路径'] = ext(r'类目名称路径：(.+)')

        # 价格信息
        price_str = ext(r'售价：(.+)')
        p['售价'] = price_str.replace('€', '').strip() if price_str else ''
        p['货币'] = ext(r'货币单位：(.+)', '€')

        # 评价信息
        p['评分次数'] = ext(r'评分次数：(.+)')
        p['评分星级'] = ext(r'评分星级：(.+)')

        # 销量信息
        p['SPU月销量'] = ext(r'近30天SPU销量：(.+)')
        p['SKU月销量'] = ext(r'近30天SKU销量：(.+)')
        p['变体数量'] = ext(r'变体数量：(.+)')

        # 卖家信息
        p['卖家名称'] = ext(r'卖家名称：(.+)')

        # 规格参数
        p['体积'] = ext(r'体积：(.+)')
        p['重量'] = ext(r'重量：(.+)')

        # 五点描述（长文本，单独提取但不写入 mini_data）
        bullets_match = re.search(r'五点描述：(\[.*?\])', block, re.DOTALL)
        if bullets_match:
            try:
                p['五点描述'] = json.loads(bullets_match.group(1))
            except:
                p['五点描述'] = []

        # 详细描述（长文本）
        desc_match = re.search(r'详细描述：(.+?)(?=\n\n|$)', block, re.DOTALL)
        p['详细描述'] = desc_match.group(1).strip() if desc_match else ''

        # 采集时间
        p['采集时间'] = ext(r'采集时间：(.+)')

        if p['SKU_ID']:
            products.append(p)

    # 提取分页信息
    total_match = re.search(r'总条数：(\d+)', text)
    total_pages_match = re.search(r'总页数：(\d+)', text)
    pagination = {
        '当前页': int(re.search(r'当前页：(\d+)', text).group(1)) if re.search(r'当前页：(\d+)', text) else page,
        '每页条数': size,
        '总条数': int(total_match.group(1)) if total_match else 0,
        '总页数': int(total_pages_match.group(1)) if total_pages_match else 0
    }

    return products, pagination


def main():
    ds, page, size, output_dir = parse_args()
    print(f"=== Step 1: 获取原始数据 | {ds} | 第{page}页 | {size}条 ===\n")

    # Step 1: 调用 MCP
    print("调用 MCP (mcporter)...")
    raw_text = call_mcp(ds, page, size)

    # 保存原始文本（用于调试）
    raw_file = os.path.join(output_dir, f'data-get-第{page}页数据-原始文本.txt')
    with open(raw_file, 'w', encoding='utf-8') as f:
        f.write(raw_text)
    print(f"✅ 原始文本已保存: {raw_file}\n")

    # Step 2: 解析并转为 JSON
    print("解析数据...")
    products, pagination = parse_mcp_text(raw_text, page, size)
    print(f"  解析到 {len(products)} 条产品")
    print(f"  总数据: {pagination['总条数']} 条, {pagination['总页数']} 页\n")

    if not products:
        print("⚠️ 未解析到任何产品，请检查数据")
        return

    # 保存完整 JSON（包含所有字段）
    full_json_file = os.path.join(output_dir, f'data-get-第{page}页数据.json')
    with open(full_json_file, 'w', encoding='utf-8') as f:
        json.dump(products, f, ensure_ascii=False, indent=2)
    print(f"✅ 完整数据已保存: {full_json_file} ({len(json.dumps(products)) // 1024}KB)")

    # 保存精简 JSON（只保留参与 AI 复筛判断的字段）
    # 参与判断：SKU_ID, SPU_ID, 英文标题, 五点描述, 详细描述, 类目路径
    # 不参与判断：售价, 评分, 销量, 卖家等（用于 Excel，不进精简 JSON）
    mini_fields = [
        'SKU_ID', 'SPU_ID', '英文标题',
        '五点描述', '详细描述', '类目路径'
    ]
    mini_products = []
    for p in products:
        mini_p = {k: p.get(k, '') for k in mini_fields}
        mini_products.append(mini_p)

    mini_json_file = os.path.join(output_dir, f'mini_products-第{page}页.json')
    with open(mini_json_file, 'w', encoding='utf-8') as f:
        json.dump(mini_products, f, ensure_ascii=False, indent=2)
    print(f"✅ 精简数据已保存: {mini_json_file} ({len(json.dumps(mini_products)) // 1024}KB)")

    # 保存分页信息
    meta_file = os.path.join(output_dir, f'meta-第{page}页.json')
    with open(meta_file, 'w', encoding='utf-8') as f:
        json.dump({'ds': ds, 'page': page, 'size': size, 'count': len(products)}, f, ensure_ascii=False, indent=2)

    print(f"\n=== 完成 ===")
    print(f"输出目录: {output_dir}")
    print(f"文件列表:")
    print(f"  - {os.path.basename(raw_file)} (原始文本)")
    print(f"  - {os.path.basename(full_json_file)} (完整 JSON)")
    print(f"  - {os.path.basename(mini_json_file)} (精简 JSON，用于 AI 处理)")
    print(f"\n下一步: AI 读取 mini_products-第{page}页.json 进行复筛")


if __name__ == '__main__':
    main()
