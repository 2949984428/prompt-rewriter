// prompt-rewriter/components/labs/fusion/rule-picker.tsx
//
// 双轨规则选择器:Tab 1 实验台下拉(三级下钻),Tab 2 自由 paste。
// 父组件传 onChange,自己产出 FusionRuleSource。
//
// 三级下拉的逻辑:
//   - skill 必选 → 选完后下面出现 section 下拉
//   - section 选了 → 下面出现 principle 下拉
//   - 任何一级不选下钻就用上一级粒度

"use client";

import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import {
  skillRuleIndexAtom,
  skillRuleIndexLoadedAtom,
} from "@/lib/atoms-fusion";
import type { FusionRuleSource } from "@/lib/schema";
import type { SkillRuleNode, SectionNode, PrincipleNode } from "@/lib/skill-rule-index";

type Tab = "lab" | "custom";

export function RulePicker({
  value,
  onChange,
}: {
  value: FusionRuleSource | null;
  onChange: (v: FusionRuleSource | null) => void;
}) {
  const [tab, setTab] = useState<Tab>("lab");
  const [index, setIndex] = useAtom(skillRuleIndexAtom);
  const [loaded, setLoaded] = useAtom(skillRuleIndexLoadedAtom);

  // 启动时拉一次 skill rule index
  useEffect(() => {
    if (loaded) return;
    fetch("/api/labs/fusion/skill-rules", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { index?: SkillRuleNode[] }) => {
        if (Array.isArray(j.index)) setIndex(j.index);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 border-b border-border-cream">
        <TabButton active={tab === "lab"} onClick={() => setTab("lab")}>
          从实验台选
        </TabButton>
        <TabButton active={tab === "custom"} onClick={() => setTab("custom")}>
          自由 paste
        </TabButton>
      </div>
      {tab === "lab" ? (
        <LabRulePicker
          index={index}
          loaded={loaded}
          value={value?.kind === "lab" ? value : null}
          onChange={onChange}
        />
      ) : (
        <CustomRulePicker
          value={value?.kind === "custom" ? value : null}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-2 text-[13px] transition ${
        active
          ? "font-medium text-near-black"
          : "text-olive-gray hover:text-near-black"
      }`}
    >
      {children}
      {active && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 right-0 h-[2px] bg-terracotta"
        />
      )}
    </button>
  );
}

function LabRulePicker({
  index,
  loaded,
  value,
  onChange,
}: {
  index: SkillRuleNode[];
  loaded: boolean;
  value: Extract<FusionRuleSource, { kind: "lab" }> | null;
  onChange: (v: FusionRuleSource | null) => void;
}) {
  const [skillId, setSkillId] = useState<string>(value?.skill_id ?? "");
  const [sectionAnchor, setSectionAnchor] = useState<string>(
    value?.granularity !== "skill" ? value?.section_anchor ?? "" : ""
  );
  const [principleId, setPrincipleId] = useState<string>(
    value?.granularity === "principle" ? value?.section_anchor ?? "" : ""
  );

  const skill = index.find((s) => s.skill_id === skillId);
  const section: SectionNode | undefined =
    skill && sectionAnchor
      ? skill.sections.find((s) => s.anchor === sectionAnchor)
      : undefined;
  const principle: PrincipleNode | undefined =
    section && principleId
      ? section.principles.find((p) => p.id === principleId)
      : undefined;

  // 当三级选择变化时,产出 FusionRuleSource
  useEffect(() => {
    if (!skill) {
      onChange(null);
      return;
    }
    if (principle && section) {
      onChange({
        kind: "lab",
        skill_id: skill.skill_id,
        granularity: "principle",
        section_anchor: principle.id,
        extracted_text: principle.text,
      });
    } else if (section) {
      onChange({
        kind: "lab",
        skill_id: skill.skill_id,
        granularity: "section",
        section_anchor: section.anchor,
        extracted_text: section.text,
      });
    } else {
      onChange({
        kind: "lab",
        skill_id: skill.skill_id,
        granularity: "skill",
        extracted_text: skill.full_text,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillId, sectionAnchor, principleId]);

  // skill 切换时清空 section / principle
  useEffect(() => {
    setSectionAnchor("");
    setPrincipleId("");
  }, [skillId]);
  useEffect(() => {
    setPrincipleId("");
  }, [sectionAnchor]);

  if (!loaded) {
    return (
      <div className="rounded-md border border-border-cream bg-ivory/40 p-4 text-[13px] text-stone-gray">
        加载实验台规则…
      </div>
    );
  }

  const previewText = principle?.text ?? section?.text ?? skill?.full_text ?? "";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <SelectField
          label="Skill"
          value={skillId}
          onChange={setSkillId}
          options={[
            { value: "", label: "— 选择 skill —" },
            ...index.map((s) => ({ value: s.skill_id, label: s.skill_label })),
          ]}
        />
        <SelectField
          label="Section"
          value={sectionAnchor}
          onChange={setSectionAnchor}
          disabled={!skill}
          options={[
            { value: "", label: skill ? "— 整个 skill —" : "—" },
            ...(skill?.sections.map((s) => ({
              value: s.anchor,
              label: s.anchor,
            })) ?? []),
          ]}
        />
        <SelectField
          label="原则"
          value={principleId}
          onChange={setPrincipleId}
          disabled={!section}
          options={[
            { value: "", label: section ? "— 整个 section —" : "—" },
            ...(section?.principles.map((p) => ({
              value: p.id,
              label: p.id,
            })) ?? []),
          ]}
        />
      </div>
      {previewText && (
        <div className="rounded-md border border-border-cream bg-warm-sand/20 p-3">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-stone-gray">
            将作为规则发给 LLM 的内容预览(前 600 字)
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-near-black">
            {previewText.slice(0, 600)}
            {previewText.length > 600 && "…"}
          </pre>
        </div>
      )}
    </div>
  );
}

function CustomRulePicker({
  value,
  onChange,
}: {
  value: Extract<FusionRuleSource, { kind: "custom" }> | null;
  onChange: (v: FusionRuleSource | null) => void;
}) {
  const [text, setText] = useState<string>(value?.text ?? "");
  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.trim() ? { kind: "custom", text: e.target.value } : null);
        }}
        placeholder="把要融合的规则文本粘到这里…"
        className="h-40 w-full resize-none rounded-md border border-border-cream bg-ivory px-3 py-2 font-mono text-[12.5px] leading-relaxed text-near-black focus:border-terracotta/60 focus:outline-none"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-stone-gray">
        {label}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-9 w-full rounded-md border border-border-cream bg-ivory px-2 text-[12.5px] text-near-black disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
