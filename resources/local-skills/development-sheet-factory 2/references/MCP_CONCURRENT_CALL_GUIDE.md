# MCP 并发调用指南

## 核心原则

- **必须**：单个产品逐个调用 `traffic_listing`
- **禁止**：一次性批量传多个产品 (如 `asinList=["B0X", "B0Y", "B0Z"]`)
- **推荐**：用并发加速单个调用，而不是增大批量大小

## Python 实现示例

### 方式 1: ThreadPoolExecutor（推荐）

```python
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

def fetch_competitor_data(sku):
    """
    调用 MCP 获取单个产品的竞品数据

    Args:
        sku: 单个产品 ASIN (如 "B0XXXX")

    Returns:
        dict: {"asin": sku, "data": {...}}
    """
    try:
        # 调用 MCP: 注意 asinList 只包含单个产品
        result = call_mcp('traffic_listing', {
            'asinList': [sku],  # ⚠️ 只传单个产品
            'marketplace': 'DE',
            'relations': ['similar', 'accessory', 'complement']
        })
        return {
            'sku': sku,
            'data': result.get('traffic_listing', {'items': [], 'data': {}}),
            'error': None
        }
    except Exception as e:
        return {
            'sku': sku,
            'data': {'items': [], 'data': {}},
            'error': str(e)
        }

def fetch_all_competitors_concurrent(sku_list, max_workers=8):
    """
    并发调用获取所有产品的竞品数据

    Args:
        sku_list: SKU 列表 (如 ["B0XXX", "B0YYY", ...])
        max_workers: 并发数 (推荐 5-10)

    Returns:
        dict: {sku: competitor_data}
    """
    results = {}
    total = len(sku_list)
    completed = 0

    print(f"🔄 开始并发获取 {total} 个产品的竞品数据...")
    print(f"   并发数: {max_workers}")

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # 提交所有任务
        future_to_sku = {executor.submit(fetch_competitor_data, sku): sku
                         for sku in sku_list}

        # 处理完成的任务
        for future in as_completed(future_to_sku):
            result = future.result()
            sku = result['sku']
            completed += 1

            # 记录结果
            results[sku] = result['data']

            # 输出进度
            status = "✅" if not result['error'] else "❌"
            items_count = len(result['data'].get('items', []))
            print(f"  [{completed:02d}/{total}] {status} {sku} (items: {items_count})")

            if result['error']:
                print(f"       错误: {result['error']}")

    # 统计
    success_count = sum(1 for r in results.values() if r.get('items'))
    print(f"\n📊 完成: {completed}/{total}, 有竞品数据: {success_count}")

    return results

# 使用示例
sku_list = ["B0XXXX", "B0YYYY", "B0ZZZZ", ...]
mcp_results = fetch_all_competitors_concurrent(sku_list, max_workers=8)
```

### 方式 2: 带重试的健壮版本

```python
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

def fetch_with_retry(sku, max_retries=3, retry_delay=2):
    """单个产品调用，带重试机制"""
    for attempt in range(max_retries):
        try:
            result = call_mcp('traffic_listing', {
                'asinList': [sku],
                'marketplace': 'DE',
                'relations': ['similar', 'accessory', 'complement']
            })
            return result.get('traffic_listing', {'items': [], 'data': {}})
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"  ⚠️ {sku} 第 {attempt + 1} 次调用失败，{retry_delay}s 后重试...")
                time.sleep(retry_delay)
            else:
                print(f"  ❌ {sku} 重试 {max_retries} 次后仍失败: {e}")
                return {'items': [], 'data': {}}

def fetch_all_with_retry(sku_list, max_workers=8, max_retries=3):
    """并发调用 + 重试"""
    results = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_with_retry, sku, max_retries): sku
                   for sku in sku_list}

        for future in as_completed(futures):
            sku = futures[future]
            results[sku] = future.result()

    return results
```

### 方式 3: asyncio（如果支持异步 MCP 调用）

```python
import asyncio

async def fetch_competitor_async(sku):
    """异步调用单个产品"""
    try:
        result = await mcp_call_async('traffic_listing', {
            'asinList': [sku],
            'marketplace': 'DE'
        })
        return sku, result.get('traffic_listing', {'items': [], 'data': {}})
    except Exception as e:
        return sku, {'items': [], 'data': {}}

async def fetch_all_competitors_async(sku_list):
    """异步并发调用所有产品"""
    tasks = [fetch_competitor_async(sku) for sku in sku_list]
    results = {}

    for sku, data in await asyncio.gather(*tasks):
        results[sku] = data

    return results

# 使用
mcp_results = asyncio.run(fetch_all_competitors_async(sku_list))
```

## 性能建议

| 场景 | 并发数 | 重试次数 | 备注 |
|------|-------|---------|------|
| **网络稳定，API 正常** | 8-10 | 1-2 | 最快速度 |
| **API 偶尔限流** | 5-8 | 2-3 | 平衡速度和稳定性 |
| **网络不稳定或 API 严格限速** | 3-5 | 3-5 | 优先稳定性 |
| **测试少量产品（<10个）** | 2-3 | 1 | 快速验证 |

## 错误处理

```python
def build_safe_results(results, sku_list):
    """确保所有 SKU 都有结果（无数据的用空数组）"""
    safe_results = {}
    for sku in sku_list:
        safe_results[sku] = results.get(sku, {'items': [], 'data': {}})
    return safe_results
```

## 监控和日志

```python
def log_competitor_stats(results):
    """输出竞品数据统计"""
    total = len(results)
    with_data = sum(1 for r in results.values() if r.get('items'))

    print(f"📊 竞品数据统计:")
    print(f"   总 SKU 数: {total}")
    print(f"   有竞品数据: {with_data}")
    print(f"   无数据: {total - with_data}")
    print(f"   覆盖率: {with_data/total*100:.1f}%")
```

## 关键要点总结

✅ **正确做法**：
```python
# 单个调用，用并发加速
for sku in sku_list:
    result = mcp_call(traffic_listing, asinList=[sku])  # 只传单个
```

❌ **错误做法**：
```python
# 一次性批量（禁止）
result = mcp_call(traffic_listing, asinList=sku_list)  # 多个产品
```

⚡ **提速方式**：
```python
# ThreadPoolExecutor + 单个调用（推荐）
with ThreadPoolExecutor(max_workers=8) as executor:
    futures = [executor.submit(fetch_single, sku) for sku in sku_list]
```

---

**最后记住**：单个调用 + 并发 > 批量调用。稳定性和性能兼得！
