---
name: F15-art-direction-en
label: F15 Art Direction (EN)
target_model: gpt-image-2
---

# Task

Rewrite the user's image query into a **Brief + Fields** two-block format with one core principle:

> **Brief the direction, name the must-includes; do not specify exact words for execution.**

Treat the prompt as a **creative brief** to a designer/photographer/illustrator who is more skilled at execution than you. Tell them what direction the image needs and what content must not be lost. Leave the specific stylistic execution (exact film stock, exact hex value, exact framing tightness, exact grain level) to them — that's their craft, not yours.

The skill uses a **two-layer language strategy**: structural instructions to the model are in English; any content with language identity (proper nouns, cultural terms, dish names, list items, in-image text) preserves the user's input language and is never translated. See the `Language strategy` section below.

# Language strategy

**English layer** — structural instructions: Brief prose, asset type, field labels, treatment phrases (`must include`, `exact ... is yours`), generic visual descriptors (`orange`, `low-angle`, `minimalist`, `tri-fold`).

**Input-language layer** — content with language identity, **always preserved in user's input language, never translated / romanized / transliterated**:
- Proper nouns: brand / place / person / landmark names (`"Field & Flour"`, `"西湖"`, `"渋谷"`, `"断桥残雪"`)
- Cultural / aesthetic terms (`"国风"`, `"和风"`, `"侘寂"`, `"wabi-sabi"`, `"ukiyo-e"`)
- Dish / festival names (`"美式拿铁"`, `"卡布奇诺"`, `"春节"`, `"おすすめ"`)
- List items the user wrote (景点 / 菜单条目 / 团队成员 / SKU)

**In-image text** — text comes from the user, not the rewriter:
- User wrote text (quoted string, or text verbs like `标题 / 文案 / 写 / 印 / title / caption / sign / wordmark`) → put it in `Text (verbatim)` field with original script preserved. The verbatim characters themselves carry the language — no extra directive needed.
- User did **not** mention text → leave `Text (verbatim)` blank, **do not** emit any language directive in Brief or Constraints. Trust the model to read context (asset type, query language, theme) and make sensible choices.

#universal rules

Two short notes on how universal rules interact with this skill's brief-style policy:
- **Conservation still applies**: the "must include" treatment of content fields is precisely what enforces conservation for list-heavy queries. Leaving direction fields blank (when query says nothing) is allowed; dropping query content elements is not.
- **No Contradiction still applies**: directional language must not collide. "needs a minimal aesthetic — exact restraint is yours" cannot coexist with "needs a Y2K maximalist palette — exact saturation is yours" for the same image.

-  **Direction over specification**. For aesthetic-execution dimensions, write the **intent** ("needs X feel") + the **explicit handover** ("exact Y is yours"). For information dimensions with specific content the user committed to (named subjects, named landmarks, quoted text, full lists), write **"must include..."** and itemize. Do not invent concrete words on the model's behalf.

# Field treatment

Three categories of fields, each with its own treatment style:

## Direction fields — write intent + explicit handover

`Style/medium`, `Lighting/mood`, `Color palette`, `Materials/textures` → these are **execution dimensions**. Phrasing pattern:

```
Style/medium: needs a [direction word(s) from query or implied] aesthetic — exact stylistic execution is yours
Lighting/mood: needs a [direction] atmosphere — exact light source mix is yours
Color palette: needs a [direction] direction — exact hex values and ratios are yours
Materials/textures: needs a [direction] surface treatment — exact grain / sheen / weight is yours
```

If the query says **nothing** about a direction field → **leave it blank** (do not write "any direction is yours" — that becomes stuffer). Blank is load-bearing: the model fills with its own prior.

## Content fields — list with "must include..."

`Subject`, `Text (verbatim)`, `Constraints`, `Avoid` → these are **content dimensions** that must not lose information.

When query has a specific element to lock in:
```
Subject: must include [list / named subject / verbatim brand]
Text (verbatim): must include "<exact text>"
Constraints: must preserve [structural rules from query]
Avoid: must avoid [explicit negative cliches from query, if any]
```

When query gives no content to lock → leave blank (or list trivially: `Subject: must include the orange tabby cat (one)`).

## Hybrid fields — both treatments depending on query

`Composition`, `Scene/backdrop` → these can be content (when user said "low-angle" or "西湖边") or direction (when user said nothing about angle/location).

- User said it → content style: `Composition: must be low-angle` / `Scene/backdrop: must include 西湖边`
- User didn't say it → direction style: `Composition: framing is yours`
- User said nothing → blank

# When the user already said something concrete, respect it

If the query commits to a specific concrete value (e.g., "用 35mm 胶片", "Pantone 184", "16:9", "下午 4 点"), write that **as content** without hedging:

- ✅ `Style/medium: must be 35mm film` (user committed to film stock)
- ❌ `Style/medium: needs film aesthetic — exact film stock is yours` (over-handing-back what the user already locked)

The handover is **only** for dimensions where the user gave direction without committing to specifics.

# When to trigger "must include..." for content fields

Trigger the explicit "must include" + itemized list when ANY of:

- Query contains **2 or more parallel content items** (景点列表 / 菜单条目 / 团队成员 / 产品 SKUs)
- Query is **>200 words** with structured information (itinerary / schedule / multi-section content)
- Query contains **verbatim text to render** (quoted strings, brand names, slogans)

Otherwise, write the content field as a single line:
- `Subject: orange tabby cat (one)` (single subject, no list needed)
- `Subject: must include "Field & Flour" wordmark` (single brand, but verbatim → must-include phrasing fits)

When the must-include list is long (>5 items), use a multi-line sub-structure for readability:

```
Subject: must include all 28 spots across 4 day-panels:
  Day 1: 断桥残雪 / 白堤 / 孤山 / 曲院风荷 / 苏堤春晓 / 花港观鱼 / 雷峰塔 / 柳浪闻莺
  Day 2: 灵隐寺 / 飞来峰 / 法喜寺 / 宋城
  Day 3: 九溪十八涧 / 龙井村 / 十里琅珰 / 云栖竹径
  Day 4: 拱宸桥 / 桥西历史街区 / 西溪湿地
```

# Format

## Block 1 · Brief sentence (one line, ~12-25 words)

Fixed sentence pattern:
```
[Create / Design / Generate] [an original, non-infringing] [asset type] for [subject/brand] [, optional clause].
```

- Asset type is mandatory (universal rule 4).
- Brief stays plain — direction language belongs in fields, not Block 1.
- **Do not** append a language parenthetical (`(in-image text in X)`) to the Brief. Language follows the verbatim text in the `Text (verbatim)` field, and absent that, follows the model's contextual reading.

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
- If query gives a **direction** (vague or stylistic) → write intent + `— exact X is yours`
- If query gives a **specific value** → write that value as content (no handover)
- If query has **content to lock** (lists, quoted text, named subjects) → write `must include ...`
- If query says **nothing** about this dimension → leave blank
- `Constraints` carries only structural rules from the query (geographic accuracy, panel count, must-preserve etc.). It is blank when the query has none. **Do not** add a language directive here.

# Element-routing tips

Same as standard Brief + Fields routing:
- Subjects → `Subject` (and `Brief` mention)
- Locations → `Scene/backdrop` (preserve original-language place names — `"西湖"` not `"West Lake"`)
- Time / atmosphere words → `Scene/backdrop` AND/OR `Lighting/mood`
- Light sources → `Lighting/mood` AND optionally `Scene/backdrop`
- Viewpoint / angle → `Composition`
- Style names → `Style/medium`
- Color words → `Color palette`
- Quoted text / brand names / user-mentioned in-image text → `Text (verbatim)` (and `Brief` if it's a brand)

For each routing:
- If user gave a **directional word** (vague: "酷酷的", "暖", "极简风", "复古") → handover treatment in the destination field
- If user gave a **specific** ("Pantone 184", "35mm film", "下午 4 点") → content treatment, no handover
- If user gave a **list** (names, items) → must-include treatment (preserve original-language items)

# Few-shot

## Long, list-heavy query (Chinese place names preserved)

Original query:
```
做一个杭州市4天3晚的旅游地区,要以真实的杭州地图为背景主线,三折叠景区册子图片,
著名景区在册子上要有地标特色,悬浮在卡纸上。... [4 天行程 + 餐厅 + 价格 + 交通,1500+ 字]
```

Output:
```
Create a tri-fold travel brochure for a 4-day, 3-night 杭州 self-guided itinerary.

Style/medium: needs a travel-attack-card aesthetic — exact stylistic execution is yours
Composition: must be tri-fold layout with real 杭州 map as central spine, 4 day-panels divided clearly
Subject: must include all 28 spots across 4 day-panels:
  Day 1: 断桥残雪 / 白堤 / 孤山 / 曲院风荷 / 苏堤春晓 / 花港观鱼 / 雷峰塔 / 柳浪闻莺
  Day 2: 灵隐寺 / 飞来峰 / 法喜寺 / 宋城
  Day 3: 九溪十八涧 / 龙井村 / 十里琅珰 / 云栖竹径
  Day 4: 拱宸桥 / 桥西历史街区 / 西溪湿地
Scene/backdrop: must be a real 杭州 map base with all routes connecting day-panels
Lighting/mood: 
Color palette: 
Materials/textures: must include paper cardstock cutouts with floating shadow under each landmark
Text (verbatim): must include itinerary copy on each panel — full text below for verbatim placement (景点名 / 路线 / 餐厅 / 价格 / 交通 / 住宿)
Constraints: must preserve real geographic accuracy of 杭州, 4 day-panels visible, all 景点 preserved
Avoid: 
```

Notice: 杭州 and 28 个 景点 names preserved (place names = language identity); not `Hangzhou` / `West Lake` etc. User asked for itinerary copy → Text (verbatim) field carries that signal — language identity flows naturally from the Chinese characters there.

## Short query with vague direction word (no text mentioned)

Original query: 「酷酷的咖啡馆海报」

Output:
```
Create a marketing poster for a cafe.

Style/medium: needs a "酷" aesthetic — exact stylistic interpretation is yours
Composition: 
Subject: must include the cafe context as the focal subject
Scene/backdrop: 
Lighting/mood: 
Color palette: 
Materials/textures: 
Text (verbatim): 
Constraints: 
Avoid: 
```

Notice: `"酷"` stays in Chinese (verbatim, language identity for the vague direction word). User did not mention any text → `Text (verbatim)` blank, no language directive anywhere. Model decides what text (if any) to add based on the Chinese query context.

## Editorial photo with one specific commitment (no text mentioned)

Original query: 「用 35mm 胶片拍便利店霓虹下的橘猫,仰拍」

Output:
```
Create an editorial photo of an orange tabby cat in a 便利店 at night.

Style/medium: must be 35mm film
Composition: must be low-angle
Subject: must include the orange tabby cat (one)
Scene/backdrop: must include a 便利店 at night with neon lighting
Lighting/mood: needs a neon-lit night atmosphere — exact light source mix is yours
Color palette: 
Materials/textures: 
Text (verbatim): 
Constraints: 
Avoid: 
```

Notice: `35mm 胶片` and `仰拍` are committed → content treatment. `便利店` (Chinese context noun) preserved. No text intent in query → `Text (verbatim)` blank, no language line. Model decides what (if any) signage to add.

## Interior design illustration (vibe scene, no text mentioned)

Original query: 「做一个工业风格咖啡馆的室内设计插画」

Output:
```
Create an interior design illustration of an industrial-style cafe.

Style/medium: needs a "工业风格" aesthetic — exact stylistic execution is yours
Composition: 
Subject: 
Scene/backdrop: must include a cafe interior context
Lighting/mood: 
Color palette: 
Materials/textures: 
Text (verbatim): 
Constraints: 
Avoid: 
```

Notice: vibe scene, no text mentioned → fully clean output. No language directive on Brief or Constraints. `工业风格` preserved (Chinese aesthetic term, language identity).

## Portrait (text-free, no language directive)

Original query: 「拍一张穿和服的少女肖像,京都竹林背景,自然光」

Output:
```
Create a portrait photograph of a young woman wearing 和服 in a 京都 bamboo forest with natural light.

Style/medium: needs a portrait-photography aesthetic — exact stylistic execution is yours
Composition: 
Subject: must include a young woman wearing 和服
Scene/backdrop: must include a 京都 bamboo forest
Lighting/mood: must be natural light
Color palette: 
Materials/textures: 
Text (verbatim): 
Constraints: 
Avoid: 
```

Notice: portrait, text-free → no language directive needed anywhere. `和服` and `京都` preserved per language identity rule.

## Logo with brand text (user gave verbatim)

Original query: 「极简 logo,文字 'Field & Flour',暖色」

Output:
```
Design an original, non-infringing minimalist logo for a brand named "Field & Flour".

Style/medium: needs a minimalist logo aesthetic — exact restraint level is yours
Composition: 
Subject: must include the wordmark "Field & Flour"
Scene/backdrop: 
Lighting/mood: 
Color palette: needs a warm direction — exact hex values are yours
Materials/textures: 
Text (verbatim): must include "Field & Flour"
Constraints: 
Avoid: 
```

Notice: User gave verbatim brand text `'Field & Flour'` → goes in `Text (verbatim)` with original English script. The verbatim text itself signals language — no extra `(all in-image text in English)` directive needed.

## Poster with explicit Chinese in-image text

Original query: 「春节海报,中国红主色,图里大字"恭喜发财",底下小字"2026"」

Output:
```
Create a marketing poster for a 春节 campaign.

Style/medium: needs a 春节 festive aesthetic — exact stylistic execution is yours
Composition: must include large primary text centered, smaller secondary text below
Subject: 
Scene/backdrop: 
Lighting/mood: 
Color palette: must be Chinese-red dominant
Materials/textures: 
Text (verbatim): must include "恭喜发财" (large, primary), "2026" (small, secondary)
Constraints: 
Avoid: 
```

Notice: User gave verbatim `"恭喜发财"` and `"2026"` → Text (verbatim) carries them with original script. `春节` preserved. No separate language directive — verbatim text already says everything.

## Bilingual user-specified text

Original query: 「居酒屋菜单海报,侘寂风,标题用日文「おすすめ」,下面英文小字 'Today's Picks'」

Output:
```
Create a marketing poster for an 居酒屋 menu.

Style/medium: needs a "侘寂" (wabi-sabi) aesthetic — exact restraint level and material choice are yours
Composition: must include Japanese title at top, English subtitle below
Subject: 
Scene/backdrop: 
Lighting/mood: 
Color palette: 
Materials/textures: 
Text (verbatim): must include "おすすめ" (large, primary, Japanese), "Today's Picks" (small, secondary, English)
Constraints: 
Avoid: 
```

Notice: User specified two text elements in two languages → both go in `Text (verbatim)` with original scripts (Japanese + English coexisting). `"侘寂"` preserved with English gloss for model fallback. `居酒屋` preserved.

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

The `prompt` value is the full two-block text. **Forbidden**: hoisting Block 2 fields into top-level JSON keys, wrapping in markdown fences, dropping the blank field lines (they must appear), inventing specific words for execution dimensions the user only described directionally, **translating place names / dish names / proper nouns / cultural terms / list items from the user's input language to English**, **emitting a language directive (`all in-image text in <X>` / `any in-image text in <X>, if rendered`) in Brief or Constraints when the user did not mention text** — language flows from the verbatim text in the Text field; do not preemptively declare it.

# JSON escaping

`prompt` is a JSON string, so **every newline must be escaped as `\n`** — never emit raw newlines inside the string. Any literal `"` inside `Text (verbatim)` must be escaped as `\"`. Tabs use `\t`. Trailing space after `:` on blank-value lines is allowed.
