#!/usr/bin/env bash
# lovart-generator-probe.sh
#
# 一次性测试 Lovart Agent Generator API：创建任务 → 轮询 → 拿结果。
# 凭证从环境变量读（不进 shell history / 不入 git）。
# 不写死任何 token / signature / project_id。
#
# 用法：
#   1. 浏览器登录 www-pre.lovart.vip，操作一次任意生成
#   2. F12 → Network → 找 agent-generator-pre.lovart.vip/api/v1/generator/tasks
#   3. 复制以下 5 个 header 值到下面 export
#   4. 改 GENERATOR_NAME / INPUT_ARGS_JSON 试不同模型
#   5. 运行：bash scripts/lovart-generator-probe.sh
#
# 凭证（必填）：
#   LOVART_TOKEN          请求头 token（hex）
#   LOVART_USER_UUID      X-User-Uuid
#   LOVART_SIGNATURE      X-Client-Signature（含 "1:" 前缀）
#   LOVART_TIMESTAMP      X-Send-Timestamp（毫秒）
#   LOVART_PROJECT_ID     body.project_id
#
# 可选：
#   LOVART_BASE           默认 https://agent-generator-pre.lovart.vip
#   POLL_INTERVAL_SEC     默认 3
#   POLL_MAX_TRIES        默认 60（≈ 3 分钟）
#
# 用例参数（可在命令行覆盖，避免改文件）：
#   GENERATOR_NAME        默认 kling/kling-v2-6；也可填 vertex/anon-bob 等
#   INPUT_ARGS_JSON       JSON 字符串，generator 的 input_args 内容
#
# 示例：
#   LOVART_TOKEN=xxx LOVART_USER_UUID=xxx LOVART_SIGNATURE=1:xxx \
#   LOVART_TIMESTAMP=$(date +%s%3N) LOVART_PROJECT_ID=xxx \
#   GENERATOR_NAME=vertex/anon-bob \
#   INPUT_ARGS_JSON='{"prompt":"a red apple on a white plate"}' \
#   bash scripts/lovart-generator-probe.sh

set -uo pipefail

# ─────────────────── 参数 ───────────────────
BASE="${LOVART_BASE:-https://agent-generator-pre.lovart.vip}"
GENERATOR_NAME="${GENERATOR_NAME:-kling/kling-v2-6}"
# 注意:bash ${VAR:-default} 在 default 含 `}` 时会贪婪闭合,所以默认值用独立变量绕开
DEFAULT_INPUT_ARGS_JSON='{"prompt":"a red apple on a white plate"}'
INPUT_ARGS_JSON="${INPUT_ARGS_JSON:-$DEFAULT_INPUT_ARGS_JSON}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-3}"
POLL_MAX_TRIES="${POLL_MAX_TRIES:-60}"

# ─────────────────── 凭证检查 ───────────────────
REQUIRED_VARS=(LOVART_TOKEN LOVART_USER_UUID LOVART_SIGNATURE LOVART_TIMESTAMP LOVART_PROJECT_ID)
missing=()
for v in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    missing+=("$v")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "✗ 缺少环境变量：${missing[*]}" >&2
  echo "  请按脚本顶部注释设置后重跑。" >&2
  exit 2
fi

# 工具检查
if ! command -v jq >/dev/null 2>&1; then
  echo "✗ 缺 jq。装：brew install jq" >&2
  exit 2
fi

# 脱敏打印（只显示前 8 + 后 4 字符）
mask() {
  local s="$1"
  local n=${#s}
  if (( n <= 12 )); then
    echo "***"
  else
    echo "${s:0:8}…${s: -4}"
  fi
}

echo "═══ Lovart Agent Generator 调用测试 ═══"
echo "base:          $BASE"
echo "generator:     $GENERATOR_NAME"
echo "project_id:    $(mask "$LOVART_PROJECT_ID")"
echo "user_uuid:     $(mask "$LOVART_USER_UUID")"
echo "token:         $(mask "$LOVART_TOKEN")"
echo "signature:     $(mask "$LOVART_SIGNATURE")"
echo "timestamp:     $LOVART_TIMESTAMP"
ts_now_ms=$(($(date +%s) * 1000))
ts_age=$((ts_now_ms - LOVART_TIMESTAMP))
echo "timestamp 距今: $((ts_age / 1000))s"
if (( ts_age > 300000 )); then
  echo "⚠ timestamp 已超过 5 分钟，签名很可能已失效（服务端通常 ±5 min 容差）"
fi
echo "input_args:    $INPUT_ARGS_JSON"
echo ""

# ─────────────────── 第 1 步：创建任务 ───────────────────
REQ_UUID=$(uuidgen | tr -d '-' | tr 'A-Z' 'a-z')
BODY=$(jq -n \
  --arg pid "$LOVART_PROJECT_ID" \
  --arg gen "$GENERATOR_NAME" \
  --argjson args "$INPUT_ARGS_JSON" \
  '{project_id:$pid, generator_type:"generator", generator_name:$gen, input_args:$args}')

echo "▶ 创建任务…"
TMP_RESP=$(mktemp)
HTTP_CODE=$(curl -s --max-time 30 -o "$TMP_RESP" -w "%{http_code}" \
  -X POST "$BASE/api/v1/generator/tasks" \
  -H 'Accept: */*' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://www-pre.lovart.vip' \
  -H 'Referer: https://www-pre.lovart.vip/' \
  -H "token: $LOVART_TOKEN" \
  -H "X-User-Uuid: $LOVART_USER_UUID" \
  -H "X-Client-Signature: $LOVART_SIGNATURE" \
  -H "X-Send-Timestamp: $LOVART_TIMESTAMP" \
  -H "X-Req-Uuid: $REQ_UUID" \
  -d "$BODY")

echo "  HTTP $HTTP_CODE"
RESP_BODY=$(cat "$TMP_RESP")
rm -f "$TMP_RESP"

if [[ "$HTTP_CODE" -ge 400 ]]; then
  echo "✗ 创建任务失败"
  echo "$RESP_BODY" | jq . 2>/dev/null || echo "$RESP_BODY" | head -c 800
  echo ""
  if echo "$RESP_BODY" | grep -qi "signature"; then
    echo "↑ 签名层问题。重新到浏览器抓最新 curl 拿新 timestamp + signature。"
  elif echo "$RESP_BODY" | grep -qi "token\|auth\|unauth"; then
    echo "↑ token 层问题。重新登录刷新。"
  elif echo "$RESP_BODY" | grep -qi "generator\|model"; then
    echo "↑ 模型不存在或未启用。换 generator_name 试。"
  fi
  exit 1
fi

# 成功了：提取 task_id
# 实测 Lovart 返回 .data.generator_task_id（不是 .data.task_id）
TASK_ID=$(echo "$RESP_BODY" | jq -r '.data.generator_task_id // .data.task_id // .task_id // empty' 2>/dev/null)
if [[ -z "$TASK_ID" ]]; then
  echo "✗ 响应里没找到 task_id："
  echo "$RESP_BODY" | jq . 2>/dev/null || echo "$RESP_BODY"
  exit 1
fi
echo "✓ 任务创建成功 task_id=$TASK_ID"
echo ""

# ─────────────────── 第 2 步：轮询 ───────────────────
echo "▶ 轮询任务结果（每 ${POLL_INTERVAL_SEC}s，最多 ${POLL_MAX_TRIES} 次）…"
for ((i=1; i<=POLL_MAX_TRIES; i++)); do
  sleep "$POLL_INTERVAL_SEC"
  TMP_POLL=$(mktemp)
  PCODE=$(curl -s --max-time 15 -o "$TMP_POLL" -w "%{http_code}" \
    -X GET "$BASE/api/v1/generator/tasks?task_id=$TASK_ID" \
    -H 'Accept: */*' \
    -H 'Origin: https://www-pre.lovart.vip' \
    -H 'Referer: https://www-pre.lovart.vip/' \
    -H "token: $LOVART_TOKEN" \
    -H "X-User-Uuid: $LOVART_USER_UUID" \
    -H "X-Client-Signature: $LOVART_SIGNATURE" \
    -H "X-Send-Timestamp: $LOVART_TIMESTAMP")
  PBODY=$(cat "$TMP_POLL")
  rm -f "$TMP_POLL"

  STATUS=$(echo "$PBODY" | jq -r '.data.status // .status // "unknown"' 2>/dev/null)
  printf "  [%02d/%02d] HTTP %s · status=%s\n" "$i" "$POLL_MAX_TRIES" "$PCODE" "$STATUS"

  # Lovart 实测 image 模型 status 就是 "completed",但保留多种别名以防 video / font 模型不同
  case "$STATUS" in
    "completed"|"succeed"|"success"|"finished")
      echo "✓ 任务完成"
      echo ""
      echo "─── 完整响应 ───"
      echo "$PBODY" | jq . 2>/dev/null || echo "$PBODY"
      exit 0
      ;;
    "failed"|"error")
      echo "✗ 任务失败"
      echo ""
      echo "$PBODY" | jq . 2>/dev/null || echo "$PBODY"
      exit 1
      ;;
  esac
done

echo "✗ 轮询超时（${POLL_MAX_TRIES} 次仍未完成）"
echo "最后一次响应："
echo "$PBODY" | jq . 2>/dev/null || echo "$PBODY"
exit 1
