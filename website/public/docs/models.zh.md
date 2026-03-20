# 模型

在与 boostclaw 对话前，需要先配置模型。在 **控制台 → 设置 → 模型** 中可以快捷配置。

![控制台模型](https://img.alicdn.com/imgextra/i4/O1CN01XnOPPQ1c99vox3I88_!!6000000003557-2-tps-3786-1980.png)

boostclaw 支持多种 LLM 提供商：**云提供商**（需 API Key，包括 Google Gemini），且支持添加自定义 **提供商**。本文介绍这几类提供商的配置方式。

---

## 配置云提供商

云提供商（包括 ModelScope、DashScope、Aliyun Coding Plan、OpenAI、Azure OpenAI、Google Gemini 和 MiniMax）通过 API 调用远程模型，需要配置 **API Key**。

**在控制台中配置：**

1. 打开控制台，进入 **设置 → 模型**。
2. 找到目标云提供商卡片（以 DashScope 为例），点击 **设置**。输入你的 **API key**，点击 **保存**。

   ![save](https://img.alicdn.com/imgextra/i3/O1CN01kra0SI1dnIFofzrfY_!!6000000003780-2-tps-3786-1980.png)

3. 保存后可以看到目标云提供商卡片右上角状态变成 **可用**，此时在上方的 **LLM 配置** 中，**提供商** 对应的下拉菜单中可以选择目标云提供商，**模型** 对应的下拉菜单中出现一系列可选模型。

   ![choose](https://img.alicdn.com/imgextra/i1/O1CN01M88I8s1udzgF9xwy7_!!6000000006061-2-tps-3786-1980.png)

4. 选择目标模型（以 qwen3.5-plus 为例），点击 **保存**。

   ![save](https://img.alicdn.com/imgextra/i3/O1CN019ekcQ629WrkeeEeEI_!!6000000008076-2-tps-3786-1980.png)

5. 可以看到 LLM 配置栏右上角显示当前正在使用的模型提供商及模型。

   ![model](https://img.alicdn.com/imgextra/i4/O1CN01HtvNIK1pcYM6E0A9a_!!6000000005381-2-tps-3786-1980.png)

> 注：如果想撤销某个云提供商授权，点击目标云提供商卡片的 **设置**，点击撤销授权，二次确认撤销授权后，可将目标提供商的状态调整为 **不可用**。
>
> ![cancel](https://img.alicdn.com/imgextra/i2/O1CN01LM3rBG1MejNjEeXs1_!!6000000001460-2-tps-3412-1952.png)

## Google Gemini 提供商

Google Gemini 提供商通过 Google 原生 Gemini API（使用 `google-genai` SDK）访问 Gemini 模型。内置模型包括 Gemini 3.1 Pro Preview、Gemini 3 Flash Preview、Gemini 3.1 Flash Lite Preview、Gemini 2.5 Pro、Gemini 2.5 Flash、Gemini 2.5 Flash Lite 和 Gemini 2.0 Flash。还可通过 API 自动发现更多模型。

**前置条件：**

- 从 [Google AI Studio](https://aistudio.google.com/apikey) 获取 Gemini API Key。

**在控制台中配置：**

1. 打开控制台，进入 **设置 → 模型**。
2. 找到 **Google Gemini** 提供商卡片，点击 **设置**。输入你的 **API Key**，点击 **保存**。
3. 保存后卡片状态变为 **可用**。该提供商支持 **模型发现** — 点击 **模型** 可自动从 API 发现可用的 Gemini 模型。
4. 在上方的 **LLM 配置** 中，**提供商** 下拉菜单选择 **Google Gemini**，**模型** 下拉菜单选择目标模型（如 `gemini-2.5-flash`），点击 **保存**。

**使用 CLI 配置：**

```bash
# 配置 API Key
boostclaw models config-key gemini

# 将 Gemini 设为活跃 LLM
boostclaw models set-llm
```

> **提示：** 具有思考能力的 Gemini 模型（如 Gemini 3.1 Pro、Gemini 2.5 Pro、Gemini 2.5 Flash）支持扩展推理。boostclaw 会自动处理这些模型返回的思考块和思考签名。

## 添加自定义提供商

1. 在控制台的模型页面点击 **添加提供商**。

   ![add](https://img.alicdn.com/imgextra/i4/O1CN01uZY4Im1pPjGXjNNb3_!!6000000005353-2-tps-3786-1980.png)

2. 填写 **提供商 ID** 和 **显示名称**，点击 **创建**。

   ![create](https://img.alicdn.com/imgextra/i1/O1CN01iTunEK1PtnFqTgzq5_!!6000000001899-2-tps-3786-1980.png)

3. 可以看见新添加的提供商卡片。

   ![card](https://img.alicdn.com/imgextra/i3/O1CN01s7fhvC1o4NBKCbAs1_!!6000000005171-2-tps-3786-1980.png)

4. 点击设置，填写 **Base URL** 和 **API Key**，点击 **保存**。

   ![save](https://img.alicdn.com/imgextra/i4/O1CN01VgJ2R01mLCVDDCVzR_!!6000000004937-2-tps-3786-1980.png)

5. 可以看到自定义提供商卡片中已经显示刚刚配置的 Base_URL 和 API Key，但此时右上角仍显示 **不可用**， 还需要配置模型。

   ![model](https://img.alicdn.com/imgextra/i2/O1CN01x47yH21X7GD8F5LzJ_!!6000000002876-2-tps-3786-1980.png)

6. 点击 **模型**，填写 **模型 ID**，点击 **添加模型**。

   ![add](https://img.alicdn.com/imgextra/i2/O1CN01binEay24FqxhNg8uP_!!6000000007362-2-tps-3786-1980.png)

7. 此时可见自定义提供商为 **可用**。在上方的 **LLM 配置** 中，**提供商** 对应的下拉菜单中可以选择自定义提供商，**模型** 对应的下拉菜单中可选择刚刚添加的模型。点击 **保存**。

   ![model](https://img.alicdn.com/imgextra/i4/O1CN01UHVBLo1UpjpIOkG9D_!!6000000002567-2-tps-3786-1980.png)

8. 可以看到 LLM 配置右上角显示自定义提供商的 ID 和选择的模型名称。

   ![save](https://img.alicdn.com/imgextra/i1/O1CN01Ltbgni23LydqhxVUX_!!6000000007240-2-tps-3786-1980.png)

> 注：如果无法成功配置，请重点检查 **Base URL，API Key 和 模型 ID** 是否填写正确，尤其是模型的大小写。如果想删除自定义提供商，在对应卡片右下角点击 **删除提供商**，二次确认后可成功删除。
>
> ![delete](https://img.alicdn.com/imgextra/i4/O1CN01r43eMv28On9egxjRz_!!6000000007923-2-tps-3412-1952.png)
