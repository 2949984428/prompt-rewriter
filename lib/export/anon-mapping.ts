// prompt-rewriter/lib/export/anon-mapping.ts
//
// 给一份 BatchRunRecord 算出 cell ↔ anon_id 的双向映射。
//
// anon_id 形式:`q{query_idx+1}-p{position}`(从 1 开始)。
// position 是该 query 内的展示位置:cells 按 hash(runId + skillId) 排序,
// 所以同 query 内的 skill 顺序看似随机但 deterministic ——
//   - 多次导出同一 record:位置一致(便于 reviewer 二次打开继续评)
//   - 反向导入时算法相同,把 anon_id 翻译回 (query_idx, skill_id)
//   - 不同 record / 不同 query / 不同 skill 间无规律,reviewer 无法
//     通过"位置"猜出策略身份
//
// 不外存 mapping 文件:接收方拿到的 ZIP 完全不含策略名,作者侧反向导入时
// 重新算同一个映射,无状态。
//
// 改算法 = 旧 .json 反向映射会断,所以一旦上线慎改。
//
// hash:用 djb2(轻量,纯位运算,不用 crypto 依赖)。8 字节十六进制串够避撞。

import type { BatchRunRecord } from "@/lib/schema";

function djb2(input: string): number {
  // 经典 djb2 hash 变体,32 位无符号整数
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  // 转无符号
  return h >>> 0;
}

// 给 query 内的 skill_id 算稳定排序键:hash(runId + queryIdx + skillId) hex
function sortKey(runId: string, queryIdx: number, skillId: string): string {
  return djb2(`${runId}|${queryIdx}|${skillId}`).toString(16).padStart(8, "0");
}

export type AnonCell = {
  query_idx: number;
  skill_id: string;
  anon_id: string; // "q1-p3"
  position: number; // query 内 1-based
};

export type AnonMapping = {
  // "queryIdx::skillId" → anon_id / position
  cellToAnon: Map<string, AnonCell>;
  // "anon_id" → cell 坐标
  anonToCell: Map<string, AnonCell>;
  // 按 query 分组的完整列表(渲染 HTML 用)
  byQuery: AnonCell[][];
};

export function buildAnonMapping(record: BatchRunRecord): AnonMapping {
  const cellToAnon = new Map<string, AnonCell>();
  const anonToCell = new Map<string, AnonCell>();
  const byQuery: AnonCell[][] = [];

  for (let qi = 0; qi < record.queries.length; qi++) {
    // 取该 query 的所有 skill,按稳定 hash 排序
    const skills = [...record.skill_ids].sort((a, b) =>
      sortKey(record.id, qi, a).localeCompare(sortKey(record.id, qi, b))
    );
    const list: AnonCell[] = skills.map((sid, i) => {
      const position = i + 1;
      const anonId = `q${qi + 1}-p${position}`;
      const item: AnonCell = {
        query_idx: qi,
        skill_id: sid,
        anon_id: anonId,
        position,
      };
      cellToAnon.set(`${qi}::${sid}`, item);
      anonToCell.set(anonId, item);
      return item;
    });
    byQuery.push(list);
  }

  return { cellToAnon, anonToCell, byQuery };
}
