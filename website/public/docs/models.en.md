# Models

You need to configure a model before chatting with boostclaw. You can do this under **Console → Settings → Models**.

![Console models](https://img.alicdn.com/imgextra/i1/O1CN01zHAE1Z26w6jXl2xbr_!!6000000007725-2-tps-3802-1968.png)

boostclaw supports multiple LLM providers: **cloud providers** (require API Key, including Google Gemini), and you can add **custom providers**. This page explains how to configure each type.

---

## Configure cloud providers

Cloud providers (including ModelScope, DashScope, Aliyun Coding Plan, OpenAI, Azure OpenAI, Google Gemini, and MiniMax) call remote models via API and require an **API Key**.

**In the console:**

1. Open the console and go to **Settings → Models**.
2. Find the target cloud provider card (e.g. DashScope) and click **Settings**. Enter your **API key** and click **Save**.

   ![save](https://img.alicdn.com/imgextra/i1/O1CN01zHAE1Z26w6jXl2xbr_!!6000000007725-2-tps-3802-1968.png)

3. After saving, the card status in the top-right becomes **Available**. In the **LLM Configuration** section at the top, you can select this provider in the **Provider** dropdown and see the list of models in the **Model** dropdown.

   ![choose](https://img.alicdn.com/imgextra/i2/O1CN01aYwWJ31gsjoGdycs5_!!6000000004198-2-tps-3802-1968.png)

4. Choose the target model (e.g. qwen3.5-plus) and click **Save**.

   ![save](https://img.alicdn.com/imgextra/i3/O1CN01oQTx2a1Qey37oM3Tw_!!6000000002002-2-tps-3802-1968.png)

5. The LLM Configuration bar will show the current provider and model in the top-right.

   ![model](https://img.alicdn.com/imgextra/i1/O1CN018wZ0C81MWweGbYL33_!!6000000001443-2-tps-3802-1968.png)

> To revoke a cloud provider, click **Settings** on its card, then **Revoke Authorization** and confirm. The provider status will change to **Unavailable**.
>
> ![cancel](https://img.alicdn.com/imgextra/i2/O1CN01A8j1IR1n8fHGnio0q_!!6000000005045-2-tps-3802-1968.png)

## Google Gemini provider

The Google Gemini provider uses Google's native Gemini API (via the `google-genai` SDK) to access Gemini models. Pre-configured models include Gemini 3.1 Pro Preview, Gemini 3 Flash Preview, Gemini 3.1 Flash Lite Preview, Gemini 2.5 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash Lite, and Gemini 2.0 Flash. Additional models can be auto-discovered from the API.

**Prerequisites:**

- Obtain a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

**In the console:**

1. Open the console and go to **Settings → Models**.
2. Find the **Google Gemini** provider card and click **Settings**. Enter your **API key** and click **Save**.
3. After saving, the card status becomes **Available**. The provider supports **model discovery** — click **Models** to auto-discover available Gemini models from the API.
4. In the **LLM Configuration** section at the top, select **Google Gemini** in the **Provider** dropdown and choose a model (e.g. `gemini-2.5-flash`), then click **Save**.

**Using the CLI:**

```bash
# Configure the API key
boostclaw models config-key gemini

# Set Gemini as the active LLM
boostclaw models set-llm
```

> **Tip:** Gemini models with thinking capabilities (e.g. Gemini 3.1 Pro, Gemini 2.5 Pro, Gemini 2.5 Flash) support extended reasoning. boostclaw automatically handles thinking blocks and thought signatures from these models.

## Add custom provider

1. On the Models page click **Add provider**.

   ![add](https://img.alicdn.com/imgextra/i2/O1CN018PFJmz1kUhUBwf4OL_!!6000000004687-2-tps-3802-1968.png)

2. Enter **Provider ID** and **Display name**, then click **Create**.

   ![create](https://img.alicdn.com/imgextra/i3/O1CN01XuLvkT1wRHvNLHUaf_!!6000000006304-2-tps-3802-1968.png)

3. The new provider card will appear.

   ![card](https://img.alicdn.com/imgextra/i3/O1CN01BFghrw1ZFcfpyzIL7_!!6000000003165-2-tps-3802-1968.png)

4. Click **Settings**, enter **Base URL** and **API Key**, then click **Save**.

   ![save](https://img.alicdn.com/imgextra/i4/O1CN01R5ZTQ321ymyQ8psEY_!!6000000007054-2-tps-3802-1968.png)

5. The card will show the configured Base URL and API Key, but the status will still be **Unavailable** until you add a model.

   ![model](https://img.alicdn.com/imgextra/i4/O1CN01qDDA1I1xd1gu7D8w2_!!6000000006465-2-tps-3802-1968.png)

6. Click **Models**, enter the **Model ID**, then click **Add model**.

   ![add](https://img.alicdn.com/imgextra/i2/O1CN01nG1FoA1KyJ4vcUYwo_!!6000000001232-2-tps-3802-1968.png)

7. The custom provider will then show as **Available**. In **LLM Configuration** at the top, select it in the **Provider** dropdown and the new model in the **Model** dropdown, then click **Save**.

   ![model](https://img.alicdn.com/imgextra/i2/O1CN01EtQCWr1YpW63ox5QY_!!6000000003108-2-tps-3802-1968.png)

8. The LLM Configuration area will show the custom provider ID and the selected model name.

   ![save](https://img.alicdn.com/imgextra/i2/O1CN01WPMjKq1bCzdC8RJvP_!!6000000003430-2-tps-3802-1968.png)

> If configuration fails, double-check **Base URL**, **API Key**, and **Model ID** (including case). To remove a custom provider, click **Delete provider** on its card and confirm.
>
> ![delete](https://img.alicdn.com/imgextra/i3/O1CN0124kc9J1dv4zHYDWQg_!!6000000003797-2-tps-3802-1968.png)
