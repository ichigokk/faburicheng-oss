// 接收 LLM 返回的 toolCalls，按顺序执行每个 handler，更新 state
const HANDLERS = require("./handlers");

function executeToolCalls(state, toolCalls, assistantMessageFromLlm) {
  const actionResults = [];
  const toolMessages = [];
  let finalReply = assistantMessageFromLlm || "";

  const calls = (toolCalls || []).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));

  for (const call of calls) {
    if (!call?.name) continue;
    if (call.name === "reply_only") {
      const msg = String(call.args?.message || "").trim();
      if (msg) finalReply = msg;
      toolMessages.push({ role: "tool", tool_call_id: call.id, name: "reply_only", content: "ok" });
      continue;
    }
    const handler = HANDLERS[call.name];
    if (!handler) {
      const r = { ok: false, message: `这个动作我还没学会：${call.name}` };
      actionResults.push(r);
      toolMessages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: r.message });
      continue;
    }
    try {
      const result = handler(state, call.args || {});
      const r = result || { ok: true, message: "" };
      actionResults.push(r);
      toolMessages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: `${r.ok ? "成功" : "失败"}: ${r.message || ""}`,
      });
    } catch (err) {
      const r = { ok: false, message: `执行 ${call.name} 出错：${err.message}` };
      actionResults.push(r);
      toolMessages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: r.message });
    }
  }

  let summary = buildExecutionSummary(actionResults, finalReply);
  if (!summary && calls.length === 0) summary = "我没听明白，再说一遍试试？";
  // 失败时不被 LLM 乐观回复吞掉：⚠️ 前缀贴上
  const failures = actionResults.filter((r) => !r.ok && r.message);
  if (failures.length) {
    if (failures.some((r) => /没找到客户/.test(r.message))) {
      summary += "\n（到 我的 → 客户管理 加这个客户再试）";
    }
  }
  const allOk = actionResults.every((r) => r.ok) && (calls.length || finalReply);
  return {
    summary: summary || "好的。",
    allOk,
    calls,
    actionResults,
    toolMessages,
  };
}

function isVagueAssistantReply(message) {
  const text = String(message || "").trim();
  if (!text) return true;
  return /^(好嘞|好的|行|嗯|我)?(先|来)?(看一下|看看|查一下|查查|确认一下|处理一下|整理一下)/.test(text)
    || /我(先|来)?(看一下|看看|查一下|查查|确认一下|处理一下|整理一下)/.test(text);
}

function buildExecutionSummary(actionResults, finalReply = "") {
  const resultLines = (actionResults || [])
    .map((result) => {
      const message = String(result?.message || "").trim();
      if (!message) return result?.ok ? "✅ 已执行。" : "⚠️ 执行失败。";
      return `${result.ok ? "✅" : "⚠️"} ${message}`;
    })
    .filter(Boolean);
  const reply = String(finalReply || "").trim();
  if (!resultLines.length) return reply;
  if (reply && !isVagueAssistantReply(reply)) return `${resultLines.join("\n")}\n${reply}`;
  return resultLines.join("\n");
}

module.exports = { executeToolCalls };
