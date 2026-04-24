# SparkBoost API Documentation

## Overview

SparkBoost.AI has **two API hosts** with different authentication schemes:

| Host | Auth | Scope |
| --- | --- | --- |
| `gateway.microdata-inc.com` | `secret-key` + `X-Api-Key` headers | OpenAPI (external partner) |
| `www.sparkboost.ai` | Cookie + Bearer token (session) | Full platform API |

All paths below are prefixed with `/api/v1` unless noted.

---

# Part 1: Gateway OpenAPI (gateway.microdata-inc.com)

> External partner API with static key authentication.

**Headers (required on all requests)**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| secret-key | `<平台发放密钥>` | string | Yes | 认证码 |
| X-Api-Key | `茂祥提供` | string | Yes | API key |

## 获取授权账户列表

- **URL**: `POST /api/v1/openapi/tiktok/auth/list`
- **Content-Type**: none

**Response (200)**

```json
{
  "success": true,
  "traceId": "ddfb8351a405401898055d89f6acce90",
  "code": "SUCCESS",
  "msg": "获取成功",
  "data": [
    {
      "authId": "285711564160503808",
      "shopName": "未命名店铺",
      "shopRegion": null,
      "userType": 1,
      "creatorUserType": "TIKTOK_MARKETING_ACCOUNT",
      "creatorNickname": "sangsangsang1",
      "creatorAvatarUrl": "https://picbed.microdata-inc.com/tiktok/avatar/...",
      "status": "ACTIVE",
      "statusDesc": "有效",
      "authorizedAt": "2026-02-27 17:55:45"
    }
  ]
}
```

## 拉取橱窗商品列表

- **URL**: `POST /api/v1/openapi/tiktok/product/list`
- **Content-Type**: json

**Body**

```json
{
  "authId": "278727544843407361",
  "pageSize": 20,
  "pageToken": ""
}
```

| Key | Type | Required | Description |
| --- | ---- | -------- | ----------- |
| authId | string | Yes | 授权ID |
| pageSize | number | No | 每页数量（1-20） |
| pageToken | string | No | 分页token |

**Response (200)**

```json
{
  "success": true,
  "code": "SUCCESS",
  "data": {
    "products": [
      {
        "productId": "1732261357676630492",
        "title": "Product Name",
        "priceAmount": "43.79",
        "priceCurrency": "USD",
        "addedStatus": "ADDED",
        "brandName": "Brand",
        "imageUrl": "https://...",
        "salesCount": 23
      }
    ],
    "totalCount": 33,
    "nextPageToken": "b2Zmc2V0PTIw",
    "hasMore": true
  }
}
```

## 发布视频

- **URL**: `POST /api/v1/openapi/tiktok/video/publish`
- **Content-Type**: json

**Body**

```json
{
  "authId": "285711564160503808",
  "videoUrl": "https://picbed.microdata-inc.com/tiktok/video/.../xxx.mp4",
  "videoTitle": "good",
  "productId": "1732279034639848320",
  "productAnchorTitle": "good"
}
```

| Key | Type | Required | Description |
| --- | ---- | -------- | ----------- |
| authId | string | Yes | 授权ID |
| videoUrl | string | Yes | 视频URL |
| videoTitle | string | Yes | 视频标题（最长2200字符） |
| productId | string | Yes | 商品ID |
| productAnchorTitle | string | Yes | 商品锚点标题（最长30字符） |

**Response (200)**

```json
{
  "success": true,
  "code": "SUCCESS",
  "data": {
    "publishTaskId": "297251823469858816",
    "status": "PROCESSING",
    "statusDesc": "处理中"
  }
}
```

## 获取视频发布状态

- **URL**: `POST /api/v1/openapi/tiktok/video/status`
- **Content-Type**: json

**Body**

```json
{ "publishTaskId": "296921818680397824" }
```

**Response (200)**

```json
{
  "success": true,
  "code": "SUCCESS",
  "data": {
    "publishTaskId": "296921818680397824",
    "status": "SUCCESS",
    "statusDesc": "发布成功",
    "tiktokVideoId": "7622960515886763278",
    "postTime": "2026-03-30 16:22:08"
  }
}
```

## Grok 视频提交任务

- **URL**: `POST /grokImagine/submit` (note: no `/api/v1` prefix)
- **Content-Type**: json

**Body**

```json
{
  "prompt": "帮我生成一个小猫拿着鱼竿钓鱼的视频",
  "duration": 10,
  "aspect_ratio": "16:9",
  "image_urls": ["https://example.com/reference.jpg"]
}
```

| Key | Type | Required | Description |
| --- | ---- | -------- | ----------- |
| prompt | string | Yes | 视频生成提示词 |
| duration | integer | Yes | 时长（6 or 10 秒） |
| aspect_ratio | string | Yes | 2:3, 3:2, 1:1, 16:9, 9:16 |
| image_urls | array | No | 参考图URL（图生视频） |

**Response (200)**

```json
{
  "code": 200,
  "msg": "成功",
  "data": { "id": "video_4d39239e-776a-4cbd-a8eb-e2d9b4816829" }
}
```

## Grok 视频查询结果

- **URL**: `GET /grokImagine/result?id={taskId}` (no `/api/v1` prefix)

Status codes: 0=init, 1=processing, 2=success, 3=failed

**Response (200)**

```json
{
  "code": 200,
  "data": {
    "id": "video_xxx",
    "status": 2,
    "video_url": "https://cdn.xxx.com/video/xxx.mp4",
    "message": ""
  }
}
```

---

# Part 2: Platform API (www.sparkboost.ai)

> Full platform API with session-based authentication. Base path: `/api/v1`.

## Auth

| Method | Path | Description |
| --- | --- | --- |
| POST | `/auth/login/code` | Login with email/phone code `{account, code}` |
| POST | `/auth/login/password` | Login with password `{account, password}` |
| POST | `/auth/logout` | Logout |
| POST | `/auth/register` | Register `{account, password, code, nickname}` |
| POST | `/auth/send-code` | Send verification code `{account, type}` |

## User

| Method | Path | Description |
| --- | --- | --- |
| GET | `/user/info` | Get current user info |
| POST | `/user/info` | Update user info |
| POST | `/user/password` | Change password |
| POST | `/user/invitation/list` | List invitations `{currentPage, pageSize}` |

## Product (Link-to-Video)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/product/parse` | Parse product from URL `{url, countryCode}` |
| GET | `/product/list?{params}` | List products (paginated) |
| GET | `/product/{id}` | Get product detail |

## Video Generation

| Method | Path | Description |
| --- | --- | --- |
| POST | `/video/task/submit` | Submit AI video generation task |
| GET | `/video/task/detail?videoTaskId=` | Get task detail |
| GET | `/video/task/list?{params}` | List video tasks (paginated) |
| DELETE | `/video/task/{id}` | Delete video task |
| POST | `/video/task/cancel` | Cancel running task |
| POST | `/video/task/sora2-best-available` | Check Sora2 availability |
| GET | `/video/task/channel-success-rates` | Get success rates by channel |
| POST | `/video/model-duration-configs` | Get model duration configs `{taskType}` |
| GET | `/video/list?{params}` | List videos (paginated) |
| GET | `/video/detail?videoId=` | Get video detail |
| GET | `/video/download?videoId=` | Download video |
| POST | `/video/download-count` | Track download `{videoId}` |
| POST | `/video/trim` | Trim video |

### Video Version Options

```json
[
  {"code": "lite", "label": "轻量版", "sortOrder": 10},
  {"code": "highQuality", "label": "高质稳定版", "sortOrder": 30},
  {"code": "highQualityLucky", "label": "高质幸运价版", "sortOrder": 40},
  {"code": "highQualityAdvanced", "label": "高质高级版", "sortOrder": 50}
]
```

- Lite providers: 10s max duration
- High quality providers: 12s max duration
- Default: 15s

## Video Replicate (V1 - 爆款复刻)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/video/replicate/create` | Create replicate task |
| GET | `/video/replicate/{id}` | Get replicate detail |
| GET | `/video/replicate/list?{params}` | List replicates (paginated) |

## Video Replicate V2

| Method | Path | Description |
| --- | --- | --- |
| POST | `/v2/video/replicate/create` | Create V2 replicate task |
| POST | `/v2/video/replicate/delete` | Delete replicate |
| POST | `/v2/video/replicate/detail` | Get replicate detail |
| POST | `/v2/video/replicate/task-list` | List replicate tasks (paginated) |

## Prompt Wizard (零提示词向导)

Step-by-step wizard for generating video prompts without manual prompt engineering.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/prompt/wizard/create` | Create wizard session `{productId?}` |
| GET | `/prompt/wizard/{id}` | Get wizard state |
| POST | `/prompt/wizard/{id}/extract-core-info` | Extract core product info |
| POST | `/prompt/wizard/{id}/step1` | Submit step 1 (product context) |
| POST | `/prompt/wizard/{id}/step2/generate` | Generate creative scenarios |
| POST | `/prompt/wizard/{id}/step2/select` | Select scenario `{scenarioId}` |
| POST | `/prompt/wizard/{id}/step3/generate` | Generate final prompt |
| POST | `/prompt/wizard/{id}/step3/save` | Save prompt `{finalPrompt}` |

## Prompt Extract

| Method | Path | Description |
| --- | --- | --- |
| POST | `/prompt-extract/create` | Create prompt extraction |
| POST | `/prompt-extract/delete` | Delete extraction |
| POST | `/prompt-extract/list` | List extractions |

## Character (数字人)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/character` | List characters |
| GET | `/character/{id}` | Get character detail |
| POST | `/character` | Create character |
| POST | `/character/{id}` | Update character |
| POST | `/character/{id}/delete` | Delete character |

## Character Replace (换脸)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/character-replace` | List replacements |
| GET | `/character-replace/{id}` | Get replacement detail |
| POST | `/character-replace/submit` | Submit face replacement task |

## Image Processing

| Method | Path | Description |
| --- | --- | --- |
| POST | `/image/detect-person` | Detect person `{imageUrl}` |
| POST | `/image/remove-model` | Remove model from image `{imageUrl}` |
| GET | `/image/task/{id}` | Get image task status |
| POST | `/image/task/{id}/confirm` | Confirm image result |
| POST | `/image/task/{id}/regenerate` | Regenerate image |

## TikTok Shop Auth

| Method | Path | Description |
| --- | --- | --- |
| GET | `/tiktok/shop-auth/list` | List all shop auths |
| GET | `/tiktok/shop-auth/list/active` | List active shop auths |
| GET | `/tiktok/shop-auth/url?appCode=` | Get OAuth URL for binding |
| POST | `/tiktok/shop-auth/revoke?authId=` | Revoke shop auth |

## TikTok Creator Auth

| Method | Path | Description |
| --- | --- | --- |
| GET | `/tiktok/creator-auth/list` | List all creator auths |
| GET | `/tiktok/creator-auth/list/active` | List active creator auths |
| GET | `/tiktok/creator-auth/url?appCode=` | Get OAuth URL |
| GET | `/tiktok/creator-auth/app/list` | List creator auth apps |

## TikTok Products

| Method | Path | Description |
| --- | --- | --- |
| GET | `/tiktok/product/list?{params}` | List TikTok showcase products (paginated) |

## TikTok Video Publishing

| Method | Path | Description |
| --- | --- | --- |
| POST | `/tiktok/video/publish` | Publish video (extended params below) |
| GET | `/tiktok/video/{id}` | Get publish task detail |
| GET | `/tiktok/video/list?{params}` | List publish tasks |

### Extended Publish Parameters (discovered from batch script)

```json
{
  "authId": "285711564160503808",
  "videoSourceType": "LOCAL_UPLOAD",
  "videoFileUrl": "https://...",
  "videoTitle": "Video title",
  "productId": "1732279034639848320",
  "productAnchorTitle": "Anchor text",
  "productImageUrl": "https://...",
  "needPrecheck": false,
  "localUploadRecordId": 12345,
  "scheduledPublishTime": 1711238400000
}
```

| Key | Type | Description |
| --- | ---- | ----------- |
| videoSourceType | string | "LOCAL_UPLOAD" or default |
| videoFileUrl | string | Video file URL (for local upload source) |
| productImageUrl | string | Product image URL |
| needPrecheck | boolean | Run pre-publish check |
| localUploadRecordId | number | Reference to local upload record |
| scheduledPublishTime | number | UTC timestamp for scheduled publish |

## TikTok Scheduled Publishing

| Method | Path | Description |
| --- | --- | --- |
| GET | `/tiktok/video/scheduled/list?{params}` | List scheduled tasks |
| PUT | `/tiktok/video/scheduled/{id}` | Update scheduled task |
| POST | `/tiktok/video/scheduled/{id}/cancel` | Cancel scheduled task |
| POST | `/tiktok/video/scheduled/{id}/publish-now` | Publish immediately |

## TikTok Precheck

| Method | Path | Description |
| --- | --- | --- |
| POST | `/tiktok/video/precheck/quota` | Get precheck quota `{authId}` |
| POST | `/tiktok/video/precheck/submit` | Submit precheck task |
| POST | `/tiktok/video/precheck/result` | Get precheck result `{taskId, authId}` |

## TikTok Local Upload

| Method | Path | Description |
| --- | --- | --- |
| POST | `/tiktok/local-upload/create-record` | Create upload record |
| POST | `/tiktok/local-upload/upload-file` | Upload file (FormData: `recordId`, `file`) |
| POST | `/tiktok/local-upload/create` | Create upload task |
| GET | `/tiktok/local-upload/list?{params}` | List uploads (paginated) |
| POST | `/tiktok/local-upload/delete` | Delete upload |

## DingMcp (DingTalk Integration)

> Requires `DINGMCP_FRONT_MEDIA_AUTH_HEADER` header.

| Method | Path | Description |
| --- | --- | --- |
| POST | `/dingMcp/front/media/replicateTask/submit` | Submit replicate task |
| POST | `/dingMcp/front/media/replicateTask/summary` | Get replicate summary |
| GET | `/dingMcp/front/media/replicateTask/list` | List replicate tasks |
| GET | `/dingMcp/front/media/task/detail?videoTaskId=` | Get task detail |
| POST | `/dingMcp/front/media/upload` | Upload media file |
| GET | `/dingMcp/front/options` | Get DingMcp options |
| GET | `/dingMcp/front/options/refresh` | Refresh options |
| POST | `/dingMcp/direct/video/resource` | Direct video resource (requires `DINGMCP_DIRECT_TOKEN_HEADER`) |

## Common

| Method | Path | Description |
| --- | --- | --- |
| POST | `/common/upload` | Upload file |
| POST | `/common/announcement` | Get announcements |

## Payment

| Method | Path | Description |
| --- | --- | --- |
| POST | `/pay/create` | Create payment order |
| POST | `/pay/packages` | List available credit packages |
| POST | `/pay/order/detail` | Get order detail |
| POST | `/pay/order/continue-pay` | Continue unpaid order |
| POST | `/pay/order/submit-transfer-proof` | Submit bank transfer proof |
| POST | `/pay/page-orders` | List orders (paginated) |

## Translation

| Method | Path | Description |
| --- | --- | --- |
| POST | `/translate` | Translate content `{content, targetLang}` |
