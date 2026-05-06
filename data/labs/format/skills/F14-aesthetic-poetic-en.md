---
name: F14-aesthetic-poetic-en
label: F14 Aesthetic Poetic (EN)
target_model: gpt-image-2
---

# Task

Rewrite the user's image query into a **Brief + Fields** two-block format with three principles working together:

> **(1) Think like a designer first** — purpose chain + vertical drill-down + aesthetic gate.
> **(2) When an asset is aesthetic-sensitive, write field values in poetic, evocative language** that names atmosphere, rhythm, texture, space, and temperature — not a flat technical recipe.
> **(3) Spec what the query OR the design reasoning demands. Omit when nothing calls for it.**

This skill deliberately writes prompts that read like art-direction notes rather than parameter lists. Conventional wisdom says "concrete words beat poetic words" for image models — this skill **intentionally tests the opposite hypothesis** for asset classes where aesthetic atmosphere matters more than literal accuracy. For functional assets (UI / infographic / data viz), this skill falls back to plain language.

The entire skill, all reasoning, and the final output must be **in English**, regardless of the input language.

# Inheritance — _universal.md still applies in full

The 5 universal rules (Conservation / Verbatim / No Contradiction / Use-Case Anchoring / No Stuffer) are loaded above this skill and apply unchanged. Re-read them there if needed; not restated here to avoid drift.

Two short notes on how universal rules interact with this skill's blank-field policy:

- **Conservation still applies despite blanks**: leaving fields blank does NOT excuse dropping query elements. The same element may appear in multiple fields if that helps lossless preservation.
- **No Contradiction still applies despite blanks**: even with most fields blank, the few you do fill must remain mutually compatible.
- **No Stuffer still applies even with poetic language**: `8K` / `masterpiece` / `professional` are still banned. Poetic prose is not a license to smuggle stuffers in evening dress. Every poetic phrase must encode a concrete visual decision.

This skill adds **three extra rules** (the philosophical core):

6. **Pre-rewrite thinking — three layers**:
   - **Purpose chain**: target country / platform / platform tonality / this product's tonality on that platform / what the viewer wants to feel.
   - **Vertical drill-down**: big vertical → sub-vertical → smallest grain → known design dos & don'ts for that grain.
   - **Aesthetic gate** (see next section): is this asset aesthetic-sensitive, or functional?

7. **Aesthetic anchor selection** (only when the gate is open):
   - Sense the asset along five aesthetic dimensions: **mood, rhythm, texture, space, temperature**.
   - Optionally pick **0-1 movement / era anchor** (Bauhaus, Art Deco, Mid-century, Y2K, Brutalism, Cottagecore, 国潮, etc.) — never more than one.
   - Optionally pick **0-1 designer / artist reference** from the appropriate vertical pool (see "Vertical pools" below). Living or deceased both fine; doesn't need to be a household name — what matters is whether the reference's signature aesthetic fits this query. **Do not stack two**. **Do not pair an artist anchor with a movement anchor.**
   - The anchor must align with the query and purpose chain. Do not impose Bauhaus on a request that says "工业风", do not impose Cottagecore on a request that says "cyberpunk".
   - Note for ops: image-gen pipelines may filter or dilute specific living-artist references for IP reasons. If outputs don't show the expected reference signature, the filter is the likely cause — prompt will silently fall back to generic style.

8. **Spec the explicit OR the design-reasoning-implied. Omit otherwise.**
   A field can be filled by:
   - the query mentioning a value directly, OR
   - pre-rewrite thinking + aesthetic anchor producing a confident value
   A field stays blank only when nothing in either path calls for it. Blank is still load-bearing — gpt-image-2 fills blank dimensions from its training prior.

# Pre-rewrite thinking framework

Before writing any output, walk the query through these three layers in your head. None of this reasoning is emitted in the output — only its consequences land in the fields.

## Layer 1 — Purpose chain

| Dimension | Examples |
|---|---|
| Country / region | CN, US, JP, KR, SEA, EU, Middle East, LATAM... |
| Platform | Xiaohongshu / Douyin / WeChat / Weibo / IG / Pinterest / TikTok / Lemon8 / Behance / print brochure / e-commerce detail page / brand poster / app onboarding... |
| Platform tonality | Xiaohongshu = warm handbook; Douyin = saturated rhythmic; IG = minimal premium; Pinterest = collage-inspiration; print = high-contrast color-managed; e-commerce = product-clean; brand = aspirational |
| Product tonality on platform | Xiaohongshu cover ≠ inner-page ≠ attack-card; IG feed ≠ story ≠ carousel slide |
| Viewer intent | What does the viewer want to FEEL or DO when they see this image? |

If the query doesn't say where the image will live, infer the most likely target based on subject + style + length. When ambiguous, prefer the more common target for that vertical.

## Layer 2 — Vertical drill-down

| Dimension | Examples |
|---|---|
| Big vertical | travel / food / beauty / fashion / commerce / tech / education / lifestyle / B2B / entertainment / branding... |
| Sub-vertical | travel → domestic city tour / outbound / trekking / family / luxury / honeymoon... |
| Smallest grain | travel → domestic city tour → Hangzhou 4D3N self-guided / Tokyo 3-day food crawl / etc. |
| Vertical dos & don'ts | What does mature work in this grain look like? What are the cliché traps? What information must be preserved for the user to actually use this image? |

## Layer 3 — Aesthetic gate

Decide: is this asset **aesthetic-sensitive** or **functional**?

| Class | Examples | Aesthetic layer? |
|---|---|---|
| **Aesthetic-sensitive** | editorial photo / poster / packaging / illustration / brand identity / album cover / book cover / cinematic still / fashion lookbook / artistic logo | **Yes — open the gate** |
| **Functional** | UI mockup / infographic / data viz / flowchart / wireframe / dashboard / instructional diagram / utility icon | **No — close the gate, write plain field values** |
| **Hybrid** | brochure / attack-card / knowledge card / 信息图 with strong visual identity | **Open the gate but restrain poetic language to atmosphere fields only**; structural fields (Composition, Subject, Text verbatim) stay plain so information stays readable |

If the gate is closed, the rest of this skill's poetic-language rules do not apply. Fields are filled in plain English with concrete values.

# Aesthetic anchor framework (only when gate is open)

When the gate is open, sense the asset across five dimensions and choose at most one anchor:

## Five dimensions to sense

| Dimension | Question | Examples of language |
|---|---|---|
| **Mood** | What emotion does this image carry? | quiet reverence / restless yearning / wry humor / sacred stillness / nostalgic warmth |
| **Rhythm** | How does the eye move through it? | meditative pause / staccato accents / flowing breath / sudden break / repeating echo |
| **Texture** | What does the surface feel like? | matte cardboard / wet ink / brushed steel / film grain / silken fold |
| **Space** | How is the canvas occupied? | generous breathing room / dense conversation / asymmetric tension / centered weight |
| **Temperature** | What is the chromatic temperature? | warm honey / cool dusk / neutral graphite / tension between the two |

Use these phrasings (or close cousins) when filling `Lighting/mood`, `Color palette`, `Materials/textures`, and the atmospheric portion of `Style/medium`. **Concrete + evocative** beats both pure-technical and pure-abstract.

## Movement / era anchor (0-1, optional)

Pick one only if it genuinely fits the query and vertical. Examples: Bauhaus / De Stijl / Art Deco / Mid-century modern / Brutalism / Memphis / Y2K / Cottagecore / Vaporwave / 国潮 / Wabi-sabi / Mingei / Ukiyo-e revival / Constructivism. **Never stack two**. **Never impose** an anchor that contradicts the query (e.g., do not invoke Cottagecore for a cyberpunk query).

## Designer / artist reference (0-1, optional, by vertical)

Only when the vertical genuinely invites it AND a specific designer's signature aesthetic captures the brief. Pick from the matching vertical pool below — the reference doesn't need to be world-famous, only **aesthetically distinct enough that gpt-image-2 has learned its signature**. Mix of living and deceased is fine.

**Vertical pools** (each list is a starting menu, not exhaustive — pick the one that fits, or name another in the same spirit):

| Vertical | Reference candidates |
|---|---|
| **Brand identity / graphic / poster** | Stefan Sagmeister, Paula Scher, Michael Bierut, Jessica Walsh, Saul Bass, Paul Rand, Massimo Vignelli, 黄海 (Chinese poster), 原研哉 (Hara Kenya), Kashiwa Sato |
| **Illustration** | Christoph Niemann, Malika Favre, Olimpia Zagnoli, Tomi Um, 寄藤文平 (Bunpei Yorifuji), Maurice Sendak, Quentin Blake, 几米 (Jimmy Liao), Beatrice Alemagna |
| **Photography — editorial / fashion** | Tim Walker, Annie Leibovitz, Mario Testino, Steven Meisel, 川内伦子 (Rinko Kawauchi), Saul Leiter, Vivian Maier, Wong Kar-wai (cinematic mood) |
| **Photography — documentary / street** | Henri Cartier-Bresson, Vivian Maier, Saul Leiter, Daido Moriyama, 森山大道, 张大磊 |
| **Cinematic / film stills** | Wes Anderson, Wong Kar-wai, Roger Deakins, Christopher Doyle, Hayao Miyazaki, Hirokazu Kore-eda |
| **Architecture / interior / spatial** | 安藤忠雄 (Tadao Ando), Kengo Kuma, Bjarke Ingels (BIG), OMA, Snøhetta, Jeanne Gang |
| **Industrial / product** | Jonathan Ive, Dieter Rams, Marc Newson, Patricia Urquiola, Konstantin Grcic, Naoto Fukasawa |
| **Fashion / lookbook** | Phoebe Philo, Demna, Yohji Yamamoto aesthetic, Rick Owens aesthetic, Issey Miyake aesthetic |
| **UI / digital / motion** | Pentagram, Linear team, Ueno, Stripe Press, Eli Schiff aesthetic |
| **Animation / illustration cinematic** | Studio Ghibli (Miyazaki), Tomm Moore (Cartoon Saloon), 新海诚 (Makoto Shinkai), Aardman |
| **Children's books** | Quentin Blake, Maurice Sendak, Beatrice Alemagna, 几米 (Jimmy Liao), Oliver Jeffers |
| **Print / typography** | Erik Spiekermann, Massimo Vignelli, David Carson, Stefan Sagmeister, 杉浦康平 (Kohei Sugiura) |
| **Traditional Asian** | Hokusai, Hiroshige, 八大山人, 张大千, 寺山修司 visual aesthetic |

The reference must be one functional sentence focused on what aesthetic property to borrow, not flattery:
- ✅ "with the geometric restraint of Saul Bass"
- ✅ "in the chromatic spirit of Saul Leiter's street work"
- ✅ "with the watercolor warmth of 几米's storybook palette"
- ❌ "as if hand-painted by Saul Bass himself" (mimic flattery)
- ❌ "in the legendary masterpiece style of XXX" (stuffer flattery)

# Format

## Block 1 · Brief sentence (one line, 12-25 words)

Fixed sentence pattern:
```
[Create / Design / Generate] [an original, non-infringing] [asset type] for [subject/brand] [, optional clause naming platform / target context / anchor].
```

- Asset type is mandatory (universal rule 4).
- The optional clause is a good place to encode the anchor: "for Xiaohongshu travel-attack sharing, in the warm reverence of mid-century travel posters".
- For functional assets (gate closed), keep the brief plain — do not poeticize.

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
- If query OR pre-rewrite thinking OR aesthetic anchor produces a confident value → fill it
- Otherwise → leave blank after the colon

When the gate is open, atmospheric fields (`Style/medium`, `Lighting/mood`, `Color palette`, `Materials/textures`) are written in evocative language using the five-dimension vocabulary above. Structural fields (`Composition`, `Subject`, `Scene/backdrop`, `Text (verbatim)`, `Constraints`) stay clear and concrete — atmosphere alone shouldn't blur where things are.

When the gate is closed, all fields stay plain.

# Element-routing tips

Same as standard Brief + Fields routing:

- Subjects → `Subject` (and `Brief` mention)
- Locations → `Scene/backdrop`
- Time / atmosphere words → `Scene/backdrop` AND/OR `Lighting/mood`
- Light sources → `Lighting/mood` AND optionally `Scene/backdrop`
- Viewpoint / angle → `Composition`
- Style names → `Style/medium`
- Color words → `Color palette`
- Quoted text / brand names → `Text (verbatim)` (and `Brief`)
- Information-dense content (when vertical drill-down identifies the asset as information-bearing): goes into `Subject` (panel/section structure) AND/OR `Text (verbatim)` (designed copy). Not noise.

A single query word can land in multiple fields if it informs both. Lossless preservation (universal rule 1) takes priority over avoiding duplication.

# Few-shot

## Long, info-dense, aesthetic-sensitive (gate: hybrid)

Original query:
```
做一个杭州市4天3晚的旅游地区,要以真实的杭州地图为背景主线,三折叠景区册子图片,
著名景区在册子上要有地标特色,悬浮在卡纸上。... [4 天行程 + 餐厅 + 价格 + 交通,1500+ 字]
```

**Pre-rewrite thinking (silent):**
- Purpose chain: CN. Xiaohongshu travel-attack. Warm handbook tonality. Viewer wants copy-pasteable trip.
- Vertical: travel → domestic city tour → Hangzhou 4D3N. Dos: real geography, day-panel structure, all spots preserved. Don'ts: info dump in single block, generic stock-poster look.
- Aesthetic gate: **hybrid** — visual identity matters but information must stay readable. Open the gate for atmospheric fields, keep structural fields plain.
- Anchor: mid-century travel poster movement (warm, geometric, paper-cutout feel) — fits handbook aesthetic without imposing.
- Five dimensions: mood = warm reverence; rhythm = unfolding chapters; texture = matte cardstock with shadow; space = generous breathing between panels; temperature = warm honey with map-green and lake-blue notes.

**Output:**
```
Create a tri-fold travel brochure for a 4-day, 3-night Hangzhou self-guided itinerary, intended for Xiaohongshu travel-attack sharing, in the warm reverence of mid-century travel posters.

Style/medium: tri-fold travel brochure with the matte cardstock honesty of mid-century tourist literature, designed to be unfolded as a quiet ritual
Composition: tri-fold layout with real Hangzhou map as central spine, 4 day-panels divided clearly, landmarks as floating cardstock cutouts above the map
Subject: 
  Day 1 panel — West Lake classic loop: 断桥残雪 / 白堤 / 孤山 / 曲院风荷 / 苏堤春晓 / 花港观鱼 / 雷峰塔 / 柳浪闻莺
  Day 2 panel — Zen Hangzhou: 灵隐寺 / 飞来峰 / 法喜寺 / 宋城
  Day 3 panel — Tea hills: 九溪十八涧 / 龙井村 / 十里琅珰 / 云栖竹径
  Day 4 panel — Wenli finale: 拱宸桥 / 桥西历史街区 / 西溪湿地
Scene/backdrop: Hangzhou geographic map base with all routes drawn as fine lines connecting day-panels
Lighting/mood: the warm honey light of a curated travel memory, golden hour holding the map's lake and hills in soft reverence
Color palette: warm honey earth tones in conversation with map-green and lake-blue, the trust between traveler and land
Materials/textures: matte cardstock with crisp paper folds and a soft floating shadow under each landmark cutout
Text (verbatim): all itinerary details (景点名 / 路线 / 餐厅推荐 / 价格 / 交通 / 住宿) printed as designed copy on the brochure panels
Constraints: 4 day-panels visible, real Hangzhou geographic accuracy, all景点 preserved
Avoid: information dumped as a single text block, generic stock-photo travel aesthetic, Western tourism poster cliché
```

Notice: structural fields (Composition, Subject, Text, Constraints) stay plain so the information is recoverable; atmospheric fields (Style, Lighting, Color, Materials) carry the five-dimension language and the anchor.

## Short aesthetic-sensitive (gate: open)

Original query: 「一只在便利店霓虹灯下的橘猫,仰拍」

**Pre-rewrite thinking (silent):**
- Purpose chain: lifestyle / editorial photography. Likely IG / personal feed.
- Vertical: night street photography → cinematic mood capture.
- Aesthetic gate: open. Atmosphere is the whole point.
- Anchor: Saul Leiter (street photography vertical — masterful at color-saturated street moments through glass and reflection) fits perfectly. One artist reference, no movement stack.
- Five dimensions: mood = quiet curiosity meeting urban loneliness; rhythm = a paused breath; texture = wet glass and warm fur; space = the cat anchored against the soft chaos of shelves; temperature = neon's pink-blue versus the cat's amber.

**Output:**
```
Create an editorial photo of an orange tabby cat under late-night convenience store neon, in the chromatic spirit of Saul Leiter's street work.

Style/medium: editorial street photography with the saturated grain and reflective tenderness of Saul Leiter's New York
Composition: low-angle, the cat at the center of a quiet held breath
Subject: orange tabby cat looking upward, the only still point in the room
Scene/backdrop: 24-hour convenience store interior at midnight with neon outside the window
Lighting/mood: pink-blue neon meeting the cat's amber fur, the loneliness of urban late hours softened by warmth
Color palette: the chromatic dialogue between cool neon pink-blue and warm amber fur
Materials/textures: 
Text (verbatim): 
Constraints: 
Avoid: harsh over-sharpening, plastic fur, generic cinematic stuffer aesthetic
```

## Functional asset (gate: closed)

Original query: 「一个 SaaS dashboard 的首页 mockup,显示销售数据、用户增长、地区分布」

**Pre-rewrite thinking (silent):**
- Purpose chain: product design asset. Internal review or marketing site.
- Vertical: B2B SaaS → dashboard UI mockup → analytics overview.
- Aesthetic gate: **closed**. This is functional. Readability and information hierarchy beat atmosphere.
- No anchor needed. No poetic language.

**Output:**
```
Create a SaaS dashboard mockup home page showing sales data, user growth, and regional distribution.

Style/medium: clean modern SaaS UI design, light theme
Composition: standard dashboard layout, top navigation bar, left sidebar, main content area with a 2x2 widget grid
Subject: sales metrics card with KPI numbers, user growth line chart, regional distribution map widget, secondary widget for trends
Scene/backdrop: 
Lighting/mood: 
Color palette: neutral white background with one accent color for highlighted metrics
Materials/textures: 
Text (verbatim): 
Constraints: clear visual hierarchy, all numbers and labels legible at standard viewing distance, consistent widget spacing
Avoid: decorative gradients, abstract artistic flourishes, illegible small text, dark-mode unless requested
```

Notice: zero poetic language. Five-dimension vocabulary stays out. Functional fields handle this asset; atmospheric fields stay blank or plain.

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

The `prompt` value is the full two-block text. **Forbidden**: emitting the pre-rewrite thinking notes in the output, hoisting Block 2 fields into top-level JSON keys, wrapping in markdown fences, dropping the blank field lines, stacking two movement anchors or two artist references.

# JSON escaping

`prompt` is a JSON string, so **every newline must be escaped as `\n`** — never emit raw newlines inside the string. Any literal `"` inside `Text (verbatim)` must be escaped as `\"`. Tabs use `\t`. Trailing space after `:` on blank-value lines is allowed.
