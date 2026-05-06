---
name: F12-spec-and-omit-en
label: F12 Spec & Omit (EN)
target_model: gpt-image-2
---

# Task

Rewrite the user's image query into a **Brief + Fields** two-block format with one core philosophical principle:

> **Spec what the user said. Omit what they didn't.**

Only fill fields that are **directly grounded in the query**; leave the rest **blank**. Do not invent details — gpt-image-2 has its own strong aesthetic priors, and blank fields signal to the model that the dimension is open for it to fill freely.

The entire skill, all reasoning, and the final output must be **in English**, regardless of the input language.

# Inheritance — _universal.md still applies in full

The 5 universal rules (Conservation / Verbatim / No Contradiction / Use-Case Anchoring / No Stuffer) are loaded above this skill and apply unchanged. Re-read them there if needed; not restated here to avoid drift.

Two short notes on how universal rules interact with this skill's blank-field policy:

- **Conservation still applies despite blanks**: leaving fields blank does NOT excuse dropping query elements. The same element may appear in multiple fields if that helps lossless preservation.
- **No Contradiction still applies despite blanks**: even with most fields blank, the few you do fill must remain mutually compatible.

This skill adds **one extra rule** (the philosophical core):

6. **Spec the explicit, omit the implicit.** Only ground a field's value in concrete query content. "convenience store at midnight" does NOT imply "fluorescent ceiling lights" unless the user said so. If the field's value can't be traced back to a query word or a strong direct implication, **leave the value blank** — the blank is load-bearing, signaling that the dimension is open for the model's own aesthetic to fill.

# Format

## Block 1 · Brief sentence (one line, 12-25 words)

Fixed sentence pattern:
```
[Create / Design / Generate] [an original, non-infringing] [asset type] for [subject/brand] [, optional clause].
```

- Asset type is mandatory (universal rule 4): `logo` / `editorial photo` / `UI mockup` / `product shot` / `packaging` / `infographic` / `book cover` / `marketing poster` / `cinematic still`, etc.
- **Use only words that come from the query** or that are needed to name the asset type. **Do not insert adjectives you invented** — no "stunning", "cinematic", "minimalist" unless the query literally said so.

## Block 2 · Field list (every field on its own line, blank value when not in query)

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
- If the user's query explicitly mentions or directly implies a value → fill it (verbatim where possible, synonyms allowed).
- If not → **leave the value blank after the colon**. Do not write "natural", "as appropriate", "any", "n/a", or guess.

The blank lines are **load-bearing** — they signal the dimension is intentionally open.

# Element-routing tips

A single query word can land in multiple fields if it informs both. Example: "便利店霓虹灯" → `Scene/backdrop: convenience store with neon` AND `Lighting/mood: neon`. The priority is **lossless preservation** (universal rule 1); never drop a query element to avoid duplication.

Common routing:
- Subjects (cat, woman, product name) → `Subject` (and `Brief` mention)
- Locations (cafe, mountain, studio) → `Scene/backdrop`
- Time / atmosphere words (midnight, sunset, foggy) → `Scene/backdrop` AND/OR `Lighting/mood`
- Light sources (neon, candlelight, harsh sun) → `Lighting/mood` AND optionally `Scene/backdrop`
- Viewpoint / angle words (low-angle, top-down, close-up) → `Composition`
- Style names from query (cyberpunk, oil painting, 35mm film, minimalist) → `Style/medium`
- Color words from query (warm, cool, monochrome, "粉蓝") → `Color palette`
- Quoted text / brand names → `Text (verbatim)` (and `Brief` if it's the subject)

If a category isn't represented in the query, **leave that field blank** — do not infer.

# Why blanks help

gpt-image-2 carries strong learned priors for things like "convenience store at night" or "logo for a bakery" — it can compose lighting, color palette, framing more diversely than any rewriter can guess. Pre-specifying these axes by inventing details collapses output diversity to whatever the rewriter happened to pick. Blank fields preserve the model's full distribution and trust its training to fill the gaps.

# Few-shot

## Sparse query (most fields blank)

Original query: 「一只在便利店霓虹灯下的橘猫,仰拍」

Rewrite (note: 7 of 10 fields stay blank — that is the point):
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

Note: "霓虹灯" appears in both `Scene/backdrop` and `Lighting/mood` — that's element routing for lossless preservation (universal rule 1), not duplication for its own sake.

## Stylistically-loaded query (more fields fill)

Original query: 「极简 logo,文字 'Field & Flour',暖色」

Rewrite (4 of 10 filled — query directly mentioned style, subject, color, text):
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
Constraints: 
Avoid: 
```

## Counter-example (what NOT to do)

For the cat query above, **wrong** output (each line shows the kind of fabrication this skill bans):
```
Style/medium: 35mm film photography, Wong Kar-wai cinematic        ← invented (query said neither)
Composition: low-angle close-up at cat eye level                    ← partly invented (eye level not in query)
Subject: orange tabby cat with bright alert eyes, glossy short fur  ← partly invented (eye / fur traits)
Lighting/mood: harsh fluorescent ceiling light + pink/blue neon     ← "harsh fluorescent" invented
Avoid: plastic fur, deformed paws, watermark                        ← invented (query didn't ask for negatives)
```

If the query doesn't say it, don't write it. **Blank means trust the model.**

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

The `prompt` value is the full two-block text. **Forbidden**: hoisting Block 2 fields into top-level JSON keys, wrapping in markdown fences, dropping the blank field lines (they must appear).

# JSON escaping

`prompt` is a JSON string, so **every newline must be escaped as `\n`** — never emit raw newlines inside the string. Any literal `"` inside `Text (verbatim)` must be escaped as `\"`. Tabs use `\t`. Trailing space after `:` on blank-value lines is allowed (and encouraged so the field is visually present).
