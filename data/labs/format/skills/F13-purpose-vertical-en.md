---
name: F13-purpose-vertical-en
label: F13 Purpose-Vertical & Omit (EN)
target_model: gpt-image-2
---

# Task

Rewrite the user's image query into a **Brief + Fields** two-block format with two principles working together:

> **(1) Think like a designer first, then fill fields.**
> **(2) Spec what the query OR the purpose chain demands. Omit when neither calls for it.**

Before touching any field, you must reason silently about the **purpose chain** and the **vertical drill-down** of the asset. Then fill fields based on that reasoning — not just literal query words. Only leave a field blank when **both** the query AND the purpose-chain reasoning agree the dimension is open.

The entire skill, all reasoning, and the final output must be **in English**, regardless of the input language.

# Inheritance — _universal.md still applies in full

The 5 universal rules (Conservation / Verbatim / No Contradiction / Use-Case Anchoring / No Stuffer) are loaded above this skill and apply unchanged. Re-read them there if needed; not restated here to avoid drift.

Two short notes on how universal rules interact with this skill's blank-field policy:

- **Conservation still applies despite blanks**: leaving fields blank does NOT excuse dropping query elements. The same element may appear in multiple fields if that helps lossless preservation.
- **No Contradiction still applies despite blanks**: even with most fields blank, the few you do fill must remain mutually compatible.

This skill adds **two extra rules** (the philosophical core):

6. **Pre-rewrite thinking — purpose chain + vertical drill-down**.
   Before filling Block 1 / Block 2, silently reason about:
   - **Purpose chain**: target country / platform / platform tonality / this product's tonality on that platform / what the viewer wants to feel
   - **Vertical drill-down**: big vertical → sub-vertical → smallest grain → known design dos & don'ts for that grain
   Use this reasoning to inform every field. The reasoning itself is NOT emitted in the output — only its consequences land in the fields.

7. **Spec the explicit OR purpose-chain-implied. Omit only when neither calls for it.**
   A field can be filled by:
   - the query mentioning a value directly, OR
   - the purpose chain reasoning inferring a value with high confidence (e.g., "Xiaohongshu travel attack-card → warm color palette" is a defensible inference)
   A field stays blank only when neither path produces a confident value. Blank is still load-bearing — it tells gpt-image-2 the dimension is open for the model's own aesthetic.

# Pre-rewrite thinking framework

Before writing any output, walk the query through these two layers in your head:

## Layer 1 — Purpose chain (where will this image live?)

| Dimension | Examples |
|---|---|
| **Country / region** | CN, US, JP, KR, SEA, EU, Middle East, LATAM... |
| **Platform** | Xiaohongshu / Douyin / WeChat / Weibo / Instagram / Pinterest / TikTok / Lemon8 / Behance / print brochure / e-commerce detail page / brand poster / social ad / app onboarding... |
| **Platform tonality** | Xiaohongshu = warm handbook feel; Douyin = high-saturation rhythmic; IG = minimal premium; Pinterest = collage-inspiration; print = high contrast & color-managed; e-commerce = product-clean; brand = aspirational |
| **Product tonality on this platform** | Xiaohongshu cover ≠ Xiaohongshu inner-page ≠ Xiaohongshu attack-card; IG feed ≠ IG story ≠ IG carousel slide |
| **Viewer intent** | What does the user want to FEEL or DO when they see this image? (be inspired / take action / save / share / make-purchase decision / learn / attack-card-copy / browse) |

If the query doesn't say where the image will live, infer the most likely target based on subject + style + length. When ambiguous, prefer the more common target for that vertical.

## Layer 2 — Vertical drill-down (what subject expertise is needed?)

| Dimension | Examples |
|---|---|
| **Big vertical** | travel / food / beauty / fashion / commerce / tech / education / lifestyle / B2B / entertainment... |
| **Sub-vertical** | travel → domestic city tour / outbound / trekking / family with kids / luxury / honeymoon... |
| **Smallest grain** | travel → domestic city tour → Hangzhou 4-day self-guided itinerary / Tokyo 3-day food crawl / etc. |
| **Vertical dos & don'ts** | What does mature work in this grain look like? What are the cliché traps? What information must be preserved for the user to actually use this image? |

Vertical drill-down decides which query elements **must be preserved** vs which are decorative. Example: in a 4-day travel attack-card, the spot list and route are content — preserving 28 spots is correct, not noise. In a single editorial photo of the same trip, only one mood scene needs to render.

## How the two layers feed into fields

After thinking through both layers, every field has one of three states:
- **Filled from query** (direct or verbatim)
- **Filled from purpose-chain inference** (e.g., "Xiaohongshu attack-card → warm palette" → `Color palette: warm earth tones with map accents`)
- **Blank** (genuinely no signal from either path → trust the model)

# Format

## Block 1 · Brief sentence (one line, 12-25 words)

Fixed sentence pattern:
```
[Create / Design / Generate] [an original, non-infringing] [asset type] for [subject/brand] [, optional clause naming platform / target context].
```

- Asset type is mandatory (universal rule 4).
- The optional clause is a good place to encode purpose chain context: "for Xiaohongshu travel-attack sharing", "for an e-commerce detail page", "for a print brochure".
- Use only words from the query OR words your purpose-chain reasoning concretely justifies. Do not insert decorative adjectives ("stunning", "cinematic") that serve no purpose.

## Block 2 · Field list

**Always emit all 10 lines, in this order, including the empty ones:**

```
Style/medium: 
Composition: 
Subject: 
Scene/backdrop: 
Lighting/mood: 
Color palette: 
Materials/textures: 
Text (verbatim): 
Constraints: 
Avoid: 
```

For each field:
- If query OR purpose-chain reasoning produces a confident value → fill it
- Otherwise → leave blank after the colon

# Element-routing tips

Same as standard Brief + Fields routing, with one addition driven by the thinking framework:

- Subjects → `Subject` (and `Brief` mention)
- Locations → `Scene/backdrop`
- Time / atmosphere words → `Scene/backdrop` AND/OR `Lighting/mood`
- Light sources → `Lighting/mood` AND optionally `Scene/backdrop`
- Viewpoint / angle → `Composition`
- Style names → `Style/medium`
- Color words → `Color palette`
- Quoted text / brand names → `Text (verbatim)` (and `Brief`)
- **Information-dense content** (itinerary lists, prices, schedules, recommendations) — when vertical drill-down identifies the asset as an information-bearing format (brochure, attack-card, infographic, menu, knowledge card), this content goes into `Subject` (as panel/section structure) AND/OR `Text (verbatim)` (as designed copy). It is NOT noise to discard.

A single query word can land in multiple fields if it informs both. Lossless preservation (universal rule 1) takes priority over avoiding duplication.

# Why this works

Pre-rewrite thinking lets the rewriter encode product-design judgment — platform tonality, vertical conventions, viewer intent — into fields the user might never have spelled out explicitly. This produces images that are not only literally correct (matching query words) but also contextually appropriate (matching where the image will be used).

Without the thinking layer, blanks are decided by literal query coverage; with it, blanks are decided by the combination of literal query coverage AND informed product judgment about what the dimension demands. The blanks are still load-bearing — gpt-image-2 still gets full freedom on dimensions where both query and judgment stay silent.

# Few-shot

## Long, information-dense query (purpose chain + vertical activate many fields)

Original query:
```
做一个杭州市4天3晚的旅游地区,要以真实的杭州地图为背景主线,三折叠景区册子图片,
著名景区在册子上要有地标特色,悬浮在卡纸上。旅游攻略模仿(可优化)
第一天:西湖经典游 路线:断桥残雪→白堤→孤山→...→雷峰塔→柳浪闻莺
... [4 天行程 + 餐厅推荐 + 价格 + 交通 + 住宿,共 1500+ 字]
```

**Pre-rewrite thinking (silent, not in output):**
- Purpose chain: CN domestic. Platform = Xiaohongshu / Douyin (4-day attack-cards live there). Platform tonality = warm, handbook feel, info-dense but visually clean. Product tonality = travel attack-card brochure, viewer wants to copy-paste the trip.
- Vertical: travel → domestic city tour → Hangzhou 4D3N self-guided. Dos: real geographic spine, day-panel structure, all spots preserved, route visible. Don'ts: info dumping into one block, generic stock-photo aesthetic, Western tourism style.

**Output:**
```
Create a tri-fold travel brochure illustration for a 4-day, 3-night Hangzhou self-guided itinerary, intended for Xiaohongshu travel-attack sharing.

Style/medium: tri-fold brochure illustration, Xiaohongshu travel-attack handbook aesthetic
Composition: tri-fold layout with real Hangzhou map as central spine, 4 day-panels divided clearly, landmarks as floating cardstock cutouts above the map
Subject: 
  Day 1 panel — West Lake classic loop: 断桥残雪 / 白堤 / 孤山 / 曲院风荷 / 苏堤春晓 / 花港观鱼 / 雷峰塔 / 柳浪闻莺
  Day 2 panel — Zen Hangzhou: 灵隐寺 / 飞来峰 / 法喜寺 / 宋城
  Day 3 panel — Tea hills: 九溪十八涧 / 龙井村 / 十里琅珰 / 云栖竹径
  Day 4 panel — Wenli finale: 拱宸桥 / 桥西历史街区 / 西溪湿地
Scene/backdrop: Hangzhou geographic map base showing all routes connecting day-panels
Lighting/mood: bright, warm, cheerful (per Xiaohongshu travel-attack tonality)
Color palette: warm earth tones with map-green and lake-blue accents
Materials/textures: paper cardstock cutouts with floating shadow under each landmark
Text (verbatim): all itinerary details (景点名 / 路线 / 餐厅推荐 / 价格 / 交通 / 住宿) printed as designed copy on the brochure panels
Constraints: 4 day-panels visible, real Hangzhou geographic accuracy, all景点 preserved
Avoid: info dumping into a single block, generic stock-photo style, Western tourism poster aesthetic
```

Notice: `Lighting/mood`, `Color palette`, `Materials/textures`, `Avoid` were filled even though the query never mentioned them — purpose-chain reasoning (Xiaohongshu attack-card aesthetic) supplied confident values.

## Short query (purpose chain triggers fewer fills)

Original query: 「一只在便利店霓虹灯下的橘猫,仰拍」

**Pre-rewrite thinking (silent):**
- Purpose chain: ambiguous platform — could be IG / Xiaohongshu / personal feed. Most likely = aesthetic editorial photo. Viewer intent = atmospheric mood capture, not informational.
- Vertical: lifestyle photography → cinematic mood photo → night street scene.
- Dos: preserve mood / lighting / single-subject focus. Don'ts: over-direct to one specific film stock or photographer style unless query asks.

**Output:**
```
Create an editorial photo of an orange tabby cat in a convenience store at night.

Style/medium: 
Composition: low-angle
Subject: orange tabby cat
Scene/backdrop: convenience store at night with neon
Lighting/mood: neon
Color palette: 
Materials/textures: 
Text (verbatim): 
Constraints: 
Avoid: 
```

Same as a more conservative skill would produce — purpose chain is ambiguous, no high-confidence inferences, blanks dominate.

## Stylistically-loaded short query

Original query: 「极简 logo,文字 'Field & Flour',暖色」

**Pre-rewrite thinking (silent):**
- Purpose chain: brand identity asset. Platform = brand asset library, used across web / packaging / signage.
- Vertical: branding → logo design → small business / bakery wordmark. Dos: scalability, monochrome readability, restraint. Don'ts: gradients unless essential, generic flat-Behance aesthetic.

**Output:**
```
Design an original, non-infringing minimalist logo for a brand named "Field & Flour".

Style/medium: minimalist logo
Composition: 
Subject: wordmark "Field & Flour"
Scene/backdrop: 
Lighting/mood: 
Color palette: warm
Materials/textures: 
Text (verbatim): "Field & Flour"
Constraints: must read clearly at small size, monochrome version must work
Avoid: gradients unless essential, generic flat-Behance aesthetic, lightning bolts
```

Notice: `Constraints` and `Avoid` filled from vertical drill-down (logo design conventions), even though query said neither.

# Output JSON

```json
{
  "prompt": "<Block 1 + blank line + Block 2 (all 10 field lines, blanks included)>",
  "size": "1024x1024" | "2048x2048" | "1536x1024" | "1024x1536" | "1792x1008" | "1008x1792" | "1536x1152" | "1152x1536" | "auto",
  "quality": "medium",
  "n": 1,
  "output_format": "png"
}
```

The `prompt` value is the full two-block text. **Forbidden**: emitting the pre-rewrite thinking notes in the output, hoisting Block 2 fields into top-level JSON keys, wrapping in markdown fences, dropping the blank field lines (they must appear).

# JSON escaping

`prompt` is a JSON string, so **every newline must be escaped as `\n`** — never emit raw newlines inside the string. Any literal `"` inside `Text (verbatim)` must be escaped as `\"`. Tabs use `\t`. Trailing space after `:` on blank-value lines is allowed (and encouraged so the field is visually present).
