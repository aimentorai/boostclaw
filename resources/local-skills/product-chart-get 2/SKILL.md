---
name: product-chart-get
description: 抓取数据并生成选品表，选品下载
---

# Product Chart Get（选品下载与复筛）

## 目标

- 通过命令行调用 MCP 的 `tmallGeniePageQuery` 获取原始产品数据
- 通过 AI 语义处理：中文标题翻译、复筛判断、季节性识别
- 生成两份 Excel：完整选品表 + 复筛通过表
- 累积记录已排查的剔除产品，避免重复

---

## 快速开始

### 标准流程（推荐）

```bash
# Step 1: 命令行获取原始数据（通过 mcporter）
python3 scripts/fetch_raw_data.py --date 20260407 --page 1 --size 20

# Step 2: AI 读取 mini_products-第1页.json 进行复筛处理
# （在 Claude 对话中完成，告诉 AI 读取该文件）

# Step 3: 脚本合并生成 Excel
python3 scripts/generate_excel.py --date 20260407
```

### 常用命令示例

```bash
# 获取 20 条数据（推荐，避免上下文过大）
python3 scripts/fetch_raw_data.py --date 20260407 --page 1 --size 20

# 获取 50 条数据（标准量）
python3 scripts/fetch_raw_data.py --date 20260407 --page 1 --size 50

# 快速测试 5 条
python3 scripts/fetch_raw_data.py --date 20260407 --page 1 --size 5
```

---

## 核心分工

| 环节 | 负责方 | 说明 |
|------|-------|------|
| **数据获取** | 脚本 (fetch_raw_data.py) | 通过 mcporter 调用 MCP，解析原始数据 |
| **语义处理** | AI | 读取精简数据文件，输出中文标题、复筛、季节性 |
| **Excel 生成** | 脚本 (generate_excel.py) | 合并原始数据 + AI 结果，生成 Excel |

---

## 执行流程详解

### Step 1：命令行获取原始数据

```bash
python3 scripts/fetch_raw_data.py --date 20260407 --page 1 --size 20
```

此步骤通过 `mcporter` 调用 MCP 的 `tmallGeniePageQuery`，自动完成：

1. 调用 MCP 获取原始数据
2. 保存原始文本（调试用）
3. 解析为完整 JSON（包含所有字段）
4. 生成精简 JSON（仅含参与 AI 复筛判断的字段）
5. 输出文件列表

**生成的文件**：

| 文件 | 大小(20条) | 说明 |
|------|-----------|------|
| `data-get-第1页数据-原始文本.txt` | ~40KB | mcporter 原始输出 |
| `data-get-第1页数据.json` | ~46KB | 完整 JSON（所有字段，永久保留） |
| `mini_products-第1页.json` | ~32KB | **AI 复筛专用** |

**精简 JSON 包含的字段**：
SKU_ID, SPU_ID, 英文标题, 五点描述, 详细描述, 类目路径

**为什么只保留这些字段**：
- 复筛判断基于：标题、描述、类目
- 其他字段（售价、评分、销量等）不参与判断，用于 Excel 输出
- AI 只处理精简文件，避免上下文膨胀

### Step 2：AI 语义处理

在 Claude 对话中，告诉 AI：

```
请读取 mini_products-第1页.json 文件，对每条产品进行复筛处理：
1. 生成中文标题（6-18字，简洁产品本体）
2. 判断是否通过复筛（消耗品、液体、带电设备、受限品类等）
3. 识别季节性（节日产品 + 装饰场景）
4. 将结果保存为 ai_results.json
```

**AI 输出格式**：

```json
[
  {
    "SKU_ID": "B0XXXXXXXX",
    "中文标题": "透明桌垫PVC",
    "复筛结论": "通过",
    "复筛备注": "",
    "季节性产品": "否",
    "季节性关键词": "",
    "节日月份": ""
  }
]
```

### Step 3：生成 Excel

```bash
python3 scripts/generate_excel.py --date 20260407
```

脚本自动合并 `data-get-第1页数据.json`（原始数据）和 `ai_results.json`（AI 结果），生成：

- `20260407选品.xlsx` - 完整选品表
- `20260407选品复筛.xlsx` - 复筛通过表（已按 SPU 去重）

---

## 输入参数

### fetch_raw_data.py 参数

| 参数 | 说明 | 默认值 |
|------|------|-------|
| `--date` / `-d` | 数据日期 (YYYYMMDD) | **必需** |
| `--page` / `-p` | 页码 | 1 |
| `--size` / `-s` | 每页条数 (1-50) | 20 |
| `--output` / `-o` | 输出目录 | `{WORKSPACE}/{date}选品/` |

### MCP 参数映射

| MCP 参数 | 来源 |
|---------|------|
| `ds` | `--date` |
| `current` | `--page` |
| `size` | `--size` |

---

## 输出文件

### 文件位置

```
<WORKSPACE>/
├── YYYYMMDD选品/              # 该日期的产品目录
│   ├── YYYYMMDD选品.xlsx                   # 完整选品表
│   ├── YYYYMMDD选品复筛.xlsx               # 复筛通过表
│   ├── data-get-第N页数据.json            # 原始完整数据
│   ├── mini_products-第N页.json           # 精简数据（AI 用）
│   └── ai_results.json                     # AI 复筛结果
└── 已排查产品.xlsx                          # 累计剔除列表
```

### 文件说明

| 文件 | 用途 | 生命周期 |
|------|------|---------|
| `YYYYMMDD选品.xlsx` | 完整产品列表 | 保留 |
| `YYYYMMDD选品复筛.xlsx` | 供应商查询表 | 保留 |
| `data-get-第N页数据.json` | 原始完整数据 | 永久保留，可追溯 |
| `mini_products-第N页.json` | AI 输入数据 | 处理后可删除 |
| `ai_results.json` | AI 复筛结果 | 合并后可删除 |
| `已排查产品.xlsx` | 负面清单 | 永久累积追加 |

---

## AI 处理规则

### 中文标题规则

- **长度**：6-18 字，本体优先，含关键属性（尺寸 > 材质）
- **清理**：删除营销词、平台词、冗余连接词
- **语言**：必须含中文字符，人工 3 秒可识别产品本体
- **特殊情况**：找不到合适翻译时用「中文本体 + 核心英文术语」

**示例**：
- ❌ "Transparent Table Protective Pad PVC Desk Pad Waterproof Anti-scratch Non-slip"
- ✅ "透明桌垫PVC"

### 复筛规则

**判断原则**：判断产品本体，不做简单关键词匹配

**剔除条件**（满足任一即剔除）：

| 条件 | 剔除范围 | 不剔除示例 |
|------|---------|----------|
| **消耗品** | 一次性塑料（杯、叉、吸管等） | PVC 桌垫、塑料收纳箱 |
| **液体/粉末** | 洗发水、精华液、洗碗液等 | 容器、防液功能描述 |
| **带电设备** | LED灯、充电宝、电动玩具等 | 电子支架、非功能性装饰 |
| **受限品类** | 食品、婴儿、医疗、玩具 | toy storage（收纳用途） |

### 季节性规则

**判断条件**（两个都满足才算季节性）：
1. 命中节日词（Christmas/Halloween/Easter/Valentine等）
2. 有装饰/礼品/节庆场景词（decoration/ornament/costume/party supplies 等）

**不判"是"的情况**：
- 仅含 gift/holiday 等泛词，无明确节日词
- 通用品类顺带提到节日（如 "perfect for Christmas gift"）

**节日 ↔ 旺季月份对照**：

| 节日 | 旺季月份 |
|------|---------|
| Christmas/Advent | 12 |
| Halloween | 10 |
| Easter | 3-4 |
| Valentine's Day | 2 |
| New Year | 12-1 |
| Thanksgiving | 11 |
| Mother's Day | 5 |
| Father's Day | 6 |

---

## ai_results.json 格式

AI 输出的 JSON 数组格式：

```json
[
  {
    "SKU_ID": "B0XXXXXXXX",              // 必填，用于匹配原始数据
    "中文标题": "透明桌垫PVC",             // 6-18字中文产品名
    "复筛结论": "通过",                    // "通过" 或 "剔除"
    "复筛备注": "",                        // 剔除时说明原因
    "季节性产品": "否",                    // "是" 或 "否"
    "季节性关键词": "",                     // 节日名称
    "节日月份": ""                         // 如 "12", "3-4"
  }
]
```

---

## 目录命名规则

**原则**：`{date}选品/` 目录名必须与数据源日期一致

| 用户指令 | 目录名 | 数据日期(ds) | 说明 |
|---------|-------|----------|------|
| "生成选品表" | `20260406选品/` | 20260406 | 用昨天 |
| "生成20260328选品表" | `20260328选品/` | 20260328 | 明确指定日期 |
| "生成第2页" | 同上日期 | 同上 | 日期从用户指令推导 |

**目录创建规则**：
- 不存在 → 创建新目录
- 存在且为空 → 直接使用
- 存在且不为空 → 创建 `{date}选品_副本N/`

---

## 常见问题

**Q: 为什么要用命令行获取数据，而不是 AI 调用 MCP？**
A: AI 调用 MCP 会把大量原始数据带进对话上下文，容易导致上下文膨胀。命令行方式让原始数据只存在于文件中，AI 只读取精简后的数据。

**Q: 每次获取多少条数据合适？**
A: 建议 20-50 条。20 条时精简 JSON 约 2KB，50 条约 5KB，都在 AI 上下文可接受范围内。

**Q: 可以多次获取数据吗？**
A: 可以。每次调用会生成新的分页文件（如 `mini_products-第1页.json`, `mini_products-第2页.json`）。需要分别进行 AI 处理，最后合并到 `ai_results.json`。

**Q: 旧的"已排查产品.xlsx"会被覆盖吗？**
A: 不会。脚本每次都**追加**新的剔除项，保留历史数据。

---

## 脚本参数

### fetch_raw_data.py

```bash
# 基本用法
python3 scripts/fetch_raw_data.py --date 20260407 --page 1 --size 20

# 指定输出目录
python3 scripts/fetch_raw_data.py --date 20260407 --page 1 --size 20 --output ~/Desktop/my_products

# 快速测试 5 条
python3 scripts/fetch_raw_data.py --date 20260407 --size 5
```

### generate_excel.py

```bash
# 🌟 推荐方式：环境变量
export WORKSPACE=~/Desktop
python3 scripts/generate_excel.py --date 20260407

# 指定 workspace
python3 scripts/generate_excel.py --workspace ~/Desktop --date 20260407
```
