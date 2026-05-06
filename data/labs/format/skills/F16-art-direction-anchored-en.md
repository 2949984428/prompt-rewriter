---
name: F16-art-direction-anchored-en
label: F16 Art Direction + Aesthetic Anchoring (EN)
target_model: gpt-image-2
---

# Task

Rewrite the user's image query into a **Brief + Fields** two-block format with **two** principles:

1. **Brief the direction, name the must-includes; do not specify exact words for execution.**
2. **When `Style/medium` direction is a vague aesthetic word, inject 2-3 reference anchors** — without breaking principle 1.

Two-layer language: structural English + content with language identity (proper nouns, cultural terms, list items, in-image text) preserved in the user's input language, never translated.

# Language strategy

**English layer** — Brief prose, asset type, field labels, treatment phrases (`must include`, `exact ... is yours`, `references in the spirit of ...`), generic visual descriptors (`orange`, `low-angle`, `minimalist`).

**Input-language layer** — preserved verbatim, never translated / romanized:
- Proper nouns (`"西湖"`, `"Field & Flour"`, `"渋谷"`, `"断桥残雪"`)
- Cultural / aesthetic terms (`"国风"`, `"侘寂"`, `"wabi-sabi"`, `"ukiyo-e"`)
- Dish / festival names (`"美式拿铁"`, `"春节"`, `"おすすめ"`)
- List items the user wrote (景点 / 菜单条目 / SKU)
- Reference anchors: culturally specific stay original-script (`"宋画"`, `"故宫文创"`, `"倉庫系"`); Western anchors stay English (`"Memphis"`, `"Petra Collins"`)

**In-image text** — comes from the user, not the rewriter:
- User wrote text (quoted string or `标题/文案/写/title/sign/wordmark` verb) → put in `Text (verbatim)` with original script. The verbatim chars themselves carry the language.
- User did NOT mention text → `Text (verbatim)` blank, **no language directive in Brief or Constraints**. Trust the model.

# Universal rule notes

- Conservation / No Contradiction still apply.
- **Anchoring is direction, not specification**: use `references in the spirit of ...; exact ... is yours`. Never `must use Petra Collins` / `must be in Memphis style` for an *injected* anchor.

# Field treatment

| Category | Fields | Treatment |
|---|---|---|
| **Direction** | `Style/medium`, `Lighting/mood`, `Color palette`, `Materials/textures` | `needs a [direction] aesthetic — exact X is yours`. Blank if query said nothing. |
| **Content** | `Subject`, `Text (verbatim)`, `Constraints`, `Avoid` | `must include ...` for committed content / lists / verbatim text. Blank if no signal. |
| **Hybrid** | `Composition`, `Scene/backdrop` | Content if user said it (`must be low-angle`); direction if not (`framing is yours`); blank if silent. |

- If query commits a specific value (`35mm film` / `Pantone 184` / `Petra Collins style`) → content treatment, no handover, no anchor injection.
- If query has 2+ parallel items, >200 words, or verbatim text → `must include ...` + itemized list (multi-line indent for >5 items).
- `Constraints` carries only structural rules from the query (geographic accuracy, panel count, must-preserve). Blank when none. **Do not add language directives.**

# Aesthetic anchoring (Style/medium only)

When `Style/medium` gets a **vague aesthetic word**, augment the handover with 2-3 reference anchors:

```
Style/medium: needs a "<user's word>" aesthetic — references in the spirit of <A>, <B>, <C>; exact stylistic execution is yours
```

## Trigger (inject only when ALL true)

1. Field is `Style/medium` (not Lighting/Color/Materials — those keep plain handover).
2. Vague aesthetic word — single (`酷` / `高级感` / `dreamy`), composite (`粉色少女风` / `Y2K 风`), or culturally loaded (`国风` / `和风` / `侘寂` / `赛博朋克`).
3. NOT a specific commitment (`Pantone 184`, `35mm film`, `用 Helvetica`).
4. NOT an existing reference (`Petra Collins style`, `参考宋画`).
5. NOT blank.

Any fail → fall back to plain F15 treatment.

## Reference selection

- **2-3 anchors total** (1 = collapse risk; 4+ = noise).
- **At least 1 must be a movement / era / style** — safest type. Examples: Memphis, Bauhaus, Y2K, Vaporwave, ukiyo-e, 新中式; 2010s Tumblr soft girl, 1990s Hong Kong cinema.
- Reference works are encouraged (`the palette of Lost in Translation`, `the lighting of Roma`, `the typography of Saul Bass posters`).
- **At most 1 living designer/artist** — sparingly, for ethical exposure.
- **Diversity** — spread across era + region + medium.
  - ❌ `Petra Collins / Sofia Coppola / Wes Anderson` (all Western, 2000s-2010s, film)
  - ✅ `Petra Collins / Sanrio / Y2K Bratz palette`
- **Cultural alignment** — for culturally loaded direction words, anchors come from the same cultural sphere.
  - ✅ `国风` → `新中式 / 宋画 / 故宫文创`
  - ❌ `国风` → `Petra Collins / Memphis / Bauhaus`
- **Anchor language** — culturally specific anchors stay original script; Western anchors stay English.

## Phrasing

- `references in the spirit of <A>, <B>, <C>; exact stylistic execution is yours` — handover MUST stay.
- Compact labels — 2-8 words including any parenthetical context.
- Other direction fields (Lighting/Color/Materials) get plain handover, **no anchor injection**.

# Format

## Block 1 · Brief sentence (~12-25 words)

```
[Create / Design / Generate] [an original, non-infringing] [asset type] for [subject/brand] [, optional clause].
```

Asset type mandatory. **Do not** append language parentheticals.

## Block 2 · Field list

Always emit all 10 lines including blanks:

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

# Few-shot

## 1. Place names + list-heavy + style anchoring

Original: 「做杭州市4天3晚旅游,三折叠景区册子,真实地图主线... [1500+ 字]」

```
Create a tri-fold travel brochure for a 4-day, 3-night 杭州 self-guided itinerary.

Style/medium: needs a "travel-attack-card" aesthetic — references in the spirit of Japanese 攻略本 print tradition, Lonely Planet illustrated city brochures, 1990s Hong Kong tourism foldouts; exact stylistic execution is yours
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

## 2. Vague aesthetic word — anchoring, no text

Original: 「粉色少女风的咖啡馆海报」

```
Create a marketing poster for a cafe.

Style/medium: needs a "粉色少女风" aesthetic — references in the spirit of 2010s Tumblr soft girl visual culture, Sanrio kawaii palette heritage, Petra Collins (intimate 2010s film); exact stylistic execution is yours
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

## 3. Vibe scene + no text mentioned — anchoring stays clean

Original: 「做一个工业风格咖啡馆的室内设计插画」

```
Create an interior design illustration of an industrial-style cafe.

Style/medium: needs a "工业风格" aesthetic — references in the spirit of 1990s New York loft conversion photography, Kinfolk magazine raw-material editorial style, Tokyo 倉庫系 cafe interior design movement; exact stylistic execution is yours
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

## 4. Committed value — no anchoring

Original: 「用 35mm 胶片拍便利店霓虹下的橘猫,仰拍」

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

## 5. Cultural alignment + verbatim Chinese text

Original: 「春节海报,中国红主色,图里大字"恭喜发财",底下小字"2026"」

```
Create a marketing poster for a 春节 campaign.

Style/medium: needs a "春节" festive aesthetic — references in the spirit of 故宫年画 print tradition, 老上海月份牌 commercial illustration, 民国春联 typography heritage; exact stylistic execution is yours
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

## 6. Committed reference + portrait — no anchoring, no text

Original: 「Petra Collins style 的粉色少女肖像」

```
Create a portrait photograph in Petra Collins style.

Style/medium: must be in Petra Collins style
Composition: 
Subject: must include a young woman as the focal subject
Scene/backdrop: 
Lighting/mood: 
Color palette: 
Materials/textures: 
Text (verbatim): 
Constraints: 
Avoid: 
```

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

**Forbidden**: hoisting Block 2 fields into top-level keys, markdown fences, dropping blank field lines, inventing specific words for direction-only dimensions, anchoring on non-`Style/medium` fields, anchoring on committed values/references, dropping `; exact ... is yours` after anchors, **translating place names / dish names / proper nouns / cultural terms / list items / culturally specific anchors**, **emitting a language directive in Brief or Constraints when the user did not mention text**.

# JSON escaping

`prompt` is a JSON string — escape newlines as `\n`, internal `"` as `\"`, tabs as `\t`.
