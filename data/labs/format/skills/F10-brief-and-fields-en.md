---
name: F10-brief-and-fields-en
label: Brief + Fields (English)
target_model: gpt-image-2
---

# Task
Rewrite the user's image query into a **Brief + Fields** two-block format. This format is the consensus of the OpenAI Cookbook (the official Field & Flour logo example) and the fal.ai five-slot framework — gpt-image-2 responds more reliably to "explicit use case + structured fields" than to a long block of free-form prose.

The entire skill, all reasoning, and the final output must be **in English**, regardless of the input language.

# Format

## Block 1 · Brief sentence (one line, 12-25 words)

Fixed sentence pattern:
```
[Create / Design / Generate] [an original, non-infringing] [asset type] for [subject/brand] [, optional clause: industry / use].
```

- **Asset type must be explicit**: `logo` / `editorial photo` / `UI mockup` / `product shot` / `packaging` / `infographic` / `book cover` / `marketing poster` / `cinematic still`, etc.
- **Brand name / quoted text / numbers must be verbatim** — copy them character-for-character from the original query, including non-English scripts (Chinese, Japanese, Korean stay as-is).
- Block 1 carries no fluffy adjectives — no "stunning", "cinematic", "beautiful". Save adjectives for Block 2 fields.

## Block 2 · Field list (one field per line, skip empty fields entirely)

Output in this order:

```
Style/medium: <medium + style anchor, may include photographer/designer reference>
Composition: <framing + viewpoint + focal length>
Subject: <main subject + key visual traits>
Scene/backdrop: <environment / time / background>
Lighting/mood: <light source + direction + color temperature + mood>
Color palette: <functional relations between colors, not a list>
Materials/textures: <surface qualities>
Text (verbatim): "<exact text from query, preserved character-by-character>"
Constraints: <must-keep rules>
Avoid: <negative cliché list>
```

# Asset class switch (decides which fields are mandatory)

| Class | Use cases | Block 2 lines | Mandatory fields |
|---|---|---|---|
| **additive** | photorealistic / product / editorial / illustration / cinematic | 6-10 | Composition + Scene + Lighting required, Avoid ≥ 2 |
| **reductive** | logo / UI / icon / infographic / wordmark | 4-7 | Constraints required (scalability / monochrome / minimum size), Avoid ≥ 3, Scene/Materials usually empty |

# Five writing rules

1. **Conservation** — every concrete element in the query (subject, modifier, number, proper noun, quoted text, viewpoint, aspect ratio) must surface somewhere in Block 1 or Block 2. Synonyms allowed; dropping is not.
2. **Verbatim** — quoted strings, brand names, numbers, and CJK text drop **character-for-character** into Block 1 or the `Text (verbatim)` field. No translation, no paraphrasing.
3. **No contradiction** — filled fields must not collide. Common contradictory pairs: daylight vs. neon/moonlight, soft vs. harsh light, minimal vs. ornate, vector flat vs. photoreal texture, top-down vs. low-angle, monochrome vs. vivid palette.
4. **Use-case anchoring** — Block 1 must name the asset type explicitly. This is the strongest signal that switches gpt-image-2 into the correct rendering mode.
5. **No stuffer words, no padding** — banned: `8K`, `4K`, `ultra-detailed`, `masterpiece`, `professional`, `high quality`, `best quality`, `cinematic` as a stuffer. The single allowed loaded word is `photorealistic` in `Style/medium` (it is a documented mode trigger). Field count is a ceiling, not a quota — when the query is sparse, leave fields out, do not fabricate.

# Few-shot

Original query: 「一只在便利店霓虹灯下的橘猫,仰拍」

Rewrite (additive class / editorial photo):
```
Create an editorial photo of an orange tabby cat in a 24-hour convenience store at midnight.

Style/medium: 35mm film photography, cinematic editorial in the spirit of Wong Kar-wai late-night street scenes
Composition: low-angle close-up at cat eye level, 35mm prime lens, shallow depth of field
Subject: orange tabby cat with bright alert eyes, glossy short fur, curious upward gaze, paws tucked
Scene/backdrop: 24-hour Asian convenience store interior, blurred snack shelves in background
Lighting/mood: harsh fluorescent ceiling light mixed with pink and blue neon glow from outside, moody and intimate
Color palette: cool fluorescent white as base, warm orange fur as anchor, pink/blue neon as accent
Materials/textures: visible individual hair strands with natural sheen, glossy tile floor reflection
Avoid: plastic fur, deformed paws, over-sharpening, watermark, cinematic 8K stuffer aesthetic
```

Reductive reference (same framework, different mandatory fields):
```
Create an original, non-infringing logo for a company called Field & Flour, a local bakery.

Style/medium: clean flat vector logo, single color or two-tone, Pentagram-style restraint
Subject: wordmark "Field & Flour" with a minimal pictorial mark suggesting wheat or bread, balanced negative space
Composition: centered mark with generous padding on a plain background
Color palette: one warm brand color (terracotta or wheat) plus black or white
Text (verbatim): "Field & Flour"
Constraints: must read clearly at 16x16 favicon size; monochrome version must work without color
Avoid: gradients unless essential; circuit board textures; lightning bolts; complex illustrations; Behance generic flat style
```

# Output JSON

```json
{
  "prompt": "<Block 1 + blank line + Block 2 as one continuous text>",
  "size": "1024x1024" | "2048x2048" | "1536x1024" | "1024x1536" | "1792x1008" | "1008x1792" | "1536x1152" | "1152x1536" | "auto",
  "quality": "medium",
  "n": 1,
  "output_format": "png"
}
```

The `prompt` value is the full two-block text (one line for Block 1, one blank line, then the Block 2 fields each on their own line). **Forbidden**: hoisting Block 2 fields into top-level JSON keys, wrapping in markdown fences, nesting JSON inside `prompt`.

# JSON escaping
`prompt` is a JSON string, so **every newline must be escaped as `\n`** — never emit raw newlines inside the string. Any literal `"` inside `Text (verbatim)` must be escaped as `\"`. Tabs use `\t`.
