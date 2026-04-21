# Global Parameters

**Global Param Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| No parameters |

**Global Param Query**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| No parameters |

**Global Param Body**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| No parameters |

**Global Auth**

> NO Auth

# Response Codes

| Response Codes | Description |
| -------------- | ----------- |
| No parameters |

# TikTok OpenAI

> Creator: Alin

> Updater: Alin

> Created Time: 2026-03-30 14:25:44

> Update Time: 2026-03-30 14:25:44

```text
No description
```

**Folder Param Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| No parameters |

**Folder Param Query**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| No parameters |

**Folder Param Body**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| No parameters |

**Folder Auth**

> Inherit auth from parent

**Query**

## 获取授权账户列表

> Creator: Alin

> Updater: Alin

> Created Time: 2026-03-30 15:09:06

> Update Time: 2026-03-31 19:23:20

```text
No description
```

**API Status**

> In Progress

**URL**

> http://gateway.microdata-inc.com/api/v1/openapi/tiktok/auth/list

**Method**

> POST

**Content-Type**

> none

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| secret-key | <平台发放密钥> | string | Yes | 认证码 |
| X-Api-Key | 茂祥提供 | string | Yes | - |

**Authentication**

> Inherit auth from parent

**Response**

* 成功(200)

```javascript
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
			"creatorAvatarUrl": "https://picbed.microdata-inc.com/tiktok/avatar/20260227/75996914e00c414c8c430545508cc689.jpg",
			"status": "ACTIVE",
			"statusDesc": "有效",
			"authorizedAt": "2026-02-27 17:55:45"
		},
		{
			"authId": "278727544843407361",
			"shopName": "未命名店铺",
			"shopRegion": null,
			"userType": 1,
			"creatorUserType": "TIKTOK_SHOP_OFFICIAL_ACCOUNT",
			"creatorNickname": "aprilake",
			"creatorAvatarUrl": "https://picbed.microdata-inc.com/tiktok/avatar/20260208/4d4c7c541d844e5a97155316d50760ba.jpg",
			"status": "ACTIVE",
			"statusDesc": "有效",
			"authorizedAt": "2026-02-08 11:23:45"
		},
		{
			"authId": "277345333950943232",
			"shopName": "未命名店铺",
			"shopRegion": null,
			"userType": 1,
			"creatorUserType": "TIKTOK_SHOP_CREATOR",
			"creatorNickname": "daina1234563",
			"creatorAvatarUrl": "https://picbed.microdata-inc.com/tiktok/avatar/20260204/aec9f3bab8394649824d93b7b5f7f372.jpg",
			"status": "ACTIVE",
			"statusDesc": "有效",
			"authorizedAt": "2026-02-04 15:51:20"
		},
		{
			"authId": "275204410257313792",
			"shopName": "未命名店铺",
			"shopRegion": null,
			"userType": 1,
			"creatorUserType": "TIKTOK_SHOP_OFFICIAL_ACCOUNT",
			"creatorNickname": "user110271817346",
			"creatorAvatarUrl": "https://picbed.microdata-inc.com/tiktok/avatar/20260129/9d18eb280c2f4c85ac8448010178d20b.jpg",
			"status": "ACTIVE",
			"statusDesc": "有效",
			"authorizedAt": "2026-01-29 18:04:04"
		},
		{
			"authId": "272980551948963840",
			"shopName": "ProBoost-toy",
			"shopRegion": "CN",
			"userType": 0,
			"creatorUserType": null,
			"creatorNickname": null,
			"creatorAvatarUrl": null,
			"status": "ACTIVE",
			"statusDesc": "有效",
			"authorizedAt": "2026-01-23 14:47:15"
		},
		{
			"authId": "269720721930981376",
			"shopName": "未命名店铺",
			"shopRegion": null,
			"userType": 1,
			"creatorUserType": "TIKTOK_SHOP_OFFICIAL_ACCOUNT",
			"creatorNickname": "user6684782160218",
			"creatorAvatarUrl": "https://picbed.microdata-inc.com/tiktok/avatar/20260204/20f4b9cf944d49529e5f6c1357d5e216.jpg",
			"status": "ACTIVE",
			"statusDesc": "有效",
			"authorizedAt": "2026-01-14 14:53:51"
		},
		{
			"authId": "269383013907959808",
			"shopName": "SANDBOX7592367395043264274",
			"shopRegion": "CN",
			"userType": 0,
			"creatorUserType": null,
			"creatorNickname": null,
			"creatorAvatarUrl": null,
			"status": "ACTIVE",
			"statusDesc": "有效",
			"authorizedAt": "2026-01-13 16:31:55"
		}
	]
}
```

* 失败(404)

```javascript
No data
```

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| secret-key | <平台发放密钥> | string | Yes | 认证码 |
| X-Api-Key | 茂祥提供 | string | Yes | - |

**Query**

## 拉取橱窗商品列表

> Creator: Alin

> Updater: Alin

> Created Time: 2026-03-30 15:09:19

> Update Time: 2026-03-31 19:23:16

```text
No description
```

**API Status**

> In Progress

**URL**

> http://gateway.microdata-inc.com/api/v1/openapi/tiktok/product/list

**Method**

> POST

**Content-Type**

> json

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| secret-key | <平台发放密钥> | string | Yes | 认证码 |
| X-Api-Key | 茂祥提供 | string | Yes | - |

**Body**

```javascript
{
    "authId": "278727544843407361",
    "pageSize": 20,
    "pageToken":""
}
```

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| authId | 278727544843407361 | string | Yes | 授权ID |
| pageSize | 20 | number | No | 每页数量（1-20） |
| pageToken | - | string | No | 分页token（首次查询不传，翻页时传上次返回的nextPageToken） |

**Authentication**

> Inherit auth from parent

**Response**

* 成功(200)

```javascript
{
	"success": true,
	"traceId": "9e0b8ad328f84fdc9e301e4060ccc5aa",
	"code": "SUCCESS",
	"msg": "获取成功",
	"data": {
		"products": [
			{
				"productId": "1732261357676630492",
				"title": "Aprilake Women's Sexy V Neck Bodycon Ruched Frill Ruffle Hem Sheer Mesh Long Maxi Cocktail Evening Dress",
				"priceAmount": "43.79",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast8.ttcdn-us.com/tos-useast8-i-rt0ujvrtvp-tx2/941fb57378144e2c8cc67544efeff0cf~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 23
			},
			{
				"productId": "1732237470380298716",
				"title": "Aprilake Women's  Lace Floral Sweetheart V Neck Micro Frill Trim Straps Sleeveless Bodycon Stretchy Long Maxi Cocktail Party Dress",
				"priceAmount": "42.59",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/8ed23286625c4024bf9aee1df240ef42~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 53
			},
			{
				"productId": "1732220752536310236",
				"title": "Aprilake Women's Summer Beach Long Dress Solid Asymmetrical Hem Halter Neck Sleeveless Loose Maxi Dress",
				"priceAmount": "35.50",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/b8e5d9ab6a3b4de88cc0b42a04caacf7~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 0
			},
			{
				"productId": "1732199185774645724",
				"title": "Aprilake Women's Sexy Halter V Neck Mini Dress Contrast Trim Ruched Fit and Flare Asymmetric Ruffled Hem Backless Club Party Short Dress",
				"priceAmount": "41.99",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/44cc8326848143ee9461a5847971994c~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 1
			},
			{
				"productId": "1732136229614752220",
				"title": "Aprilake Women's 4 Piece Halter V Neck Triangle Bikini Sets Color Block Polka Dot Swim Shorts Bathing Suit with Mesh Cover Up",
				"priceAmount": "42.49",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/8bf529f8fb614b1480b3ffbc824152fb~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 0
			},
			{
				"productId": "1732125062783865308",
				"title": "Aprilake Women's Cute One Piece Swimsuit Wide Straps Milkmaid Neck Corset Adjustable Drawstring High Cut Ruffle Trim Bathing Suit",
				"priceAmount": "32.19",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/59ac9c0af42f465885d9224083da6a8c~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 71
			},
			{
				"productId": "1732124849455731164",
				"title": "Aprilake Women's 3 Piece Bikini with Cover Ups Triangle Halter String Thong Backless Sets Floral Printed Summer Beachwear Bathing Suit",
				"priceAmount": "41.99",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/bdf88a69f74143e9a4f2b8c2dd8ac2dc~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 0
			},
			{
				"productId": "1732117774929072604",
				"title": "Aprilake Women's One Piece Swimsuit Floral Printing V Neck Color Block Adjustable Spaghetti Straps Hig Waist Bathing Suit",
				"priceAmount": "30.35",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/dcd35c4d010a46f1a53263f27bc44bfb~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 0
			},
			{
				"productId": "1732117627852591580",
				"title": "Aprilake Women's One Piece Swimsuit Cut Out Adjustable Strap Criss Cross Monokini Sexy Bathing Suit",
				"priceAmount": "30.81",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/1406c334c7044b41a263f7d03d81630c~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 0
			},
			{
				"productId": "1732117484886594012",
				"title": "Aprilake Women's Triangle Bikini Sets Sporty Adjustable strap High Waist Color Block Stripes Two Piece Bathing Suit",
				"priceAmount": "30.81",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/c12123ccbe5445808ce4e97cd37a2806~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 0
			},
			{
				"productId": "1732086679711420892",
				"title": "Aprilake Women's Ribbed Triangle Bikini Sets Sporty Tank Zipper Crop High Waist Color Block Two Piece Bathing Suit",
				"priceAmount": "32.19",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/74bd39bcf81a4d70bad5f3f0882b5c18~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 15
			},
			{
				"productId": "1732055787056697820",
				"title": "Aprilake Women's Sexy Halter Deep V Neck Cut Out Mesh Adjustable Waist One Piece Swimsuit Bathing suit",
				"priceAmount": "31.27",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/77c09540e49b43969eac0e161de08424~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 73
			},
			{
				"productId": "1732055710840099292",
				"title": "Aprilake Women's Sexy One Shoulder Swimsuit Ruched Backless Slimming Bathing Suit",
				"priceAmount": "32.19",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/1d3e07d455ac4914a174d1c63b171663~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 8
			},
			{
				"productId": "1732055597280498140",
				"title": "Aprilake Women's One Piece Swimsuit Slimming Tummy Control Sweetheart Neck Color Block Bathing Suit",
				"priceAmount": "30.81",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/0e6fa9a8afd544ecbde2c050cf3e01d4~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 5
			},
			{
				"productId": "1732048274493903324",
				"title": "Aprilake Women's One Piece V Neck Adjustable Shoulder Strap Color Block Slimming Swimsuits",
				"priceAmount": "31.27",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/a505cfde728045ea840598507767c45c~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 0
			},
			{
				"productId": "1731796891997999580",
				"title": "Aprilake Women's Sexy Mesh Long Sleeve Sheer Panel Bodycon Ruched Twist Wrap Stretchy Maxi Dress",
				"priceAmount": "30.00",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/07668736ec4346398ccc0a9505dd2528~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 61
			},
			{
				"productId": "1731565199355056604",
				"title": "Aprilake Women's Elegant Mesh Long Sleeve Bodycon Ruched High Split Flowy Long Maxi Dress",
				"priceAmount": "39.59",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/cafab78aa91b4cefabca62f341cbce94~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 2865
			},
			{
				"productId": "1731367884800627164",
				"title": "Aprilake Women's Elegant Formal One Shoulder Sleeveless Ruched Bodycon Evening Vacation Mesh Long Dress",
				"priceAmount": "49.79",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/5993fc5b384a4003b484c3a24c02bdf7~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 7045
			},
			{
				"productId": "1731147137340248540",
				"title": "Aprilake Women's One Piece Halter Neck Adjustable Straps Ruffled Skirt Hem Sexy Swimsuit",
				"priceAmount": "21.50",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/22bc7b0d47b74000a8b9cb046ff1c6bc~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 8
			},
			{
				"productId": "1731122416096285148",
				"title": "Aprilake Women's Two Piece Adjustable Shoulder Strap V Neck Butterfly Print Sexy Bikini Swimsuit",
				"priceAmount": "23.00",
				"priceCurrency": "USD",
				"addedStatus": "ADDED",
				"brandName": "Aprilake",
				"imageUrl": "https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/369cea5b65d849929362645328022ac4~tplv-fhlh96nyum-resize-image:200:200.image?dr=12187&t=555f072d&ps=933b5bde&shp=78ae5c14&shcp=3c3d9ffb&idc=useast5&from=2024692756",
				"salesCount": 25
			}
		],
		"totalCount": 33,
		"nextPageToken": "b2Zmc2V0PTIw",
		"hasMore": true
	}
}
```

* 失败(404)

```javascript
No data
```

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| secret-key | <平台发放密钥> | string | Yes | 认证码 |
| X-Api-Key | 茂祥提供 | string | Yes | - |

**Query**

## 发布视频

> Creator: Alin

> Updater: Alin

> Created Time: 2026-03-30 16:01:35

> Update Time: 2026-03-31 19:23:11

```text
No description
```

**API Status**

> In Progress

**URL**

> http://gateway.microdata-inc.com/api/v1/openapi/tiktok/video/publish

**Method**

> POST

**Content-Type**

> json

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| secret-key | <平台发放密钥> | string | Yes | 认证码 |
| X-Api-Key | 茂祥提供 | string | Yes | - |

**Body**

```javascript
{
    "authId": "285711564160503808",
    "videoUrl": "https://picbed.microdata-inc.com/tiktok/video/20260327/0809cdb34e1b4184826f775e81907e06.mp4",
    "videoTitle": "good",
    "productId": "1732279034639848320",
    "productAnchorTitle": "good"
}
```

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| authId | 285711564160503808 | string | Yes | 授权ID |
| videoUrl | https://picbed.microdata-inc.com/tiktok/video/20260327/0809cdb34e1b4184826f775e81907e06.mp4 | string | Yes | 视频URL（可下载的视频文件链接） |
| videoTitle | good | string | Yes | 视频标题（最长2200字符） |
| productId | 1732279034639848320 | string | Yes | 商品ID |
| productAnchorTitle | good | string | Yes | 商品锚点标题（最长30字符） |

**Authentication**

> Inherit auth from parent

**Response**

* 成功(200)

```javascript
{
	"success": true,
	"traceId": "583c99f8ae8e4c5f8399671c042d9ceb",
	"code": "SUCCESS",
	"msg": "提交成功",
	"data": {
		"publishTaskId": "297251823469858816",
		"status": "PROCESSING",
		"statusDesc": "处理中"
	}
}
```

* 失败(404)

```javascript
No data
```

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| secret-key | <平台发放密钥> | string | Yes | 认证码 |
| X-Api-Key | 茂祥提供 | string | Yes | - |

**Query**

## 获取视频发布状态

> Creator: Alin

> Updater: Alin

> Created Time: 2026-03-30 16:15:35

> Update Time: 2026-03-31 19:23:08

```text
No description
```

**API Status**

> In Progress

**URL**

> http://gateway.microdata-inc.com/api/v1/openapi/tiktok/video/status

**Method**

> POST

**Content-Type**

> json

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| secret-key | <平台发放密钥> | string | Yes | 认证码 |
| X-Api-Key | 茂祥提供 | string | Yes | - |

**Body**

```javascript
{
		"publishTaskId": "296921818680397824"
}
```

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| publishTaskId | 296921818680397824 | string | Yes | 发布任务ID |

**Authentication**

> Inherit auth from parent

**Response**

* 成功(200)

```javascript
{
	"success": true,
	"traceId": "c5b4202a00804c30b0ef351b1008b537",
	"code": "SUCCESS",
	"msg": "获取成功",
	"data": {
		"publishTaskId": "296921818680397824",
		"status": "SUCCESS",
		"statusDesc": "发布成功",
		"tiktokVideoId": "7622960515886763278",
		"errorCode": null,
		"errorMessage": null,
		"postTime": "2026-03-30 16:22:08",
		"gmtCreate": "2026-03-30 16:21:18"
	}
}
```

* 失败(404)

```javascript
No data
```

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| secret-key | <平台发放密钥> | string | Yes | 认证码 |
| X-Api-Key | 茂祥提供 | string | Yes | - |

**Query**

## Grok 视频提交任务

> Creator: Alin

> Updater: Alin

> Created Time: 2026-03-31 19:18:01

> Update Time: 2026-04-03 10:45:53

```text
No description
```

**API Status**

> In Progress

**URL**

> http://gateway.microdata-inc.com/grokImagine/submit

**Method**

> POST

**Content-Type**

> json

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| Content-Type | application/json | string | Yes | - |
| secret-key | <平台发放密钥> | string | Yes | - |

**Body**

```javascript
{
    "prompt": "帮我生成一个小猫拿着鱼竿钓鱼钓鱼的视频",
    "duration": 10,
    "aspect_ratio": "16:9",
    "image_urls": ["https://c-ssl.duitang.com/uploads/blog/202209/28/20220928114230_8a77c.jpg"]
}
```

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| prompt | - | string | Yes | 视频生成提示词 |
| duration | - | integer | Yes | 视频时长（秒），可选值：6、10 |
| aspect_ratio | - | string | Yes | 宽高比，如 2:3、3:2、1:1、16:9、9:16 |
| image_urls | - | array | Yes | 参考图 URL 列表（图生视频场景） |

**Authentication**

> Inherit auth from parent

**Response**

* 成功(200)

```javascript
{
  "code": 200,
  "msg": "成功",
  "data": {
    "id": "video_4d39239e-776a-4cbd-a8eb-e2d9b4816829"
  },
  "exec_time": 1.219,
  "ip": "175.152.149.53"
}
```

| Key | Example Value | Type | Description |
| --- | ------------- | ---- | ----------- |
| code | 200 | number | 接口状态码（200 表示请求成功） |
| msg | 成功 | string | 状态信息 |
| data | - | object | 业务数据 |
| data.id | video_4d39239e-776a-4cbd-a8eb-e2d9b4816829 | string | - |
| exec_time | 1.219 | number | 处理耗时 |
| ip | 175.152.149.53 | string | 客户端 IP（如有） |

* 失败(404)

```javascript
No data
```

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| Content-Type | application/json | string | Yes | - |
| secret-key | <平台发放密钥> | string | Yes | - |

**Query**

## Grok 视频查询结果

> Creator: Alin

> Updater: Alin

> Created Time: 2026-03-31 19:25:58

> Update Time: 2026-04-03 10:45:51

**调用流程（全链路）
调用提交任务接口，获取任务 ID：data.id
使用 data.id 轮询查询结果接口
当 data.status = 2 时，读取视频结果字段：data.video_url
当 data.status = 3 时，读取失败原因：data.message
状态枚举：0 初始化，1 进行中，2 成功，3 失败**

**API Status**

> In Progress

**URL**

> http://gateway.microdata-inc.com/grokImagine/result?id=video_c92711b6-d8e6-41f0-8add-58d1ed10dcdd

**Method**

> GET

**Content-Type**

> none

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| secret-key | <平台发放密钥> | string | Yes | - |

**Query Params**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| id | video_c92711b6-d8e6-41f0-8add-58d1ed10dcdd | string | Yes | - |

**Path Param**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| taskId | - | string | Yes | 提交任务返回的 data.id |

**Authentication**

> Inherit auth from parent

**Response**

* 成功(200)

```javascript
{
  "code": 200,
  "msg": "成功",
  "data": {
    "id": "video_4d39239e-776a-4cbd-a8eb-e2d9b4816829",
    "status": 2,
    "video_url": "https://cdn.xxx.com/video/xxx.mp4",
    "message": ""
  },
  "exec_time": 0.079
}


```

| Key | Example Value | Type | Description |
| --- | ------------- | ---- | ----------- |
| code | 200 | number | 接口状态码（200 表示请求成功） |
| msg | 成功 | string | 状态信息 |
| data | - | object | - |
| data.id | video_4d39239e-776a-4cbd-a8eb-e2d9b4816829 | string | - |
| data.status | 2 | number | - |
| data.video_url | https://cdn.xxx.com/video/xxx.mp4 | string | - |
| data.message | - | string | - |
| exec_time | 0.079 | number | 处理耗时 |

* 失败(404)

```javascript
{
  "code": 200,
  "msg": "成功",
  "data": {
    "id": "video_4d39239e-776a-4cbd-a8eb-e2d9b4816829",
    "status": 3,
    "message": "prompt 不合规或资源生成失败"
  },
  "exec_time": 0.074
}
```

**Headers**

| Key | Example Value | Type | Required | Description |
| --- | ------------- | ---- | -------- | ----------- |
| secret-key | <平台发放密钥> | string | Yes | - |

**Query**
