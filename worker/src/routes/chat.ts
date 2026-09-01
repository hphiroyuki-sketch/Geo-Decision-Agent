import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env, AuthUser } from "../types";
import { newId } from "../lib/crypto";
import { getSetting, currentMonthKey } from "../lib/db";
import { estimateCostUsd, getBudgetStatus } from "../lib/pricing";
import { makeClient, buildSystemPrompt, ANALYZE_TOOL } from "../lib/anthropicClient";
import { analyzeCandidates, type CandidateInput, type RealDataOverride } from "../lib/geoEngine";
import { getEmbeddingVector, getReferenceEmbedding, findNearbyFieldRecords, cosineSimilarity } from "../lib/fieldData";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

export const chatRoutes = new Hono<AppEnv>();

chatRoutes.get("/:conversationId/messages", async (c) => {
  const conversationId = c.req.param("conversationId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, role, content, steps_json, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
  )
    .bind(conversationId)
    .all();
  return c.json({ messages: results });
});

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

chatRoutes.post("/:conversationId/messages", async (c) => {
  const user = c.get("user") as AuthUser;
  const conversationId = c.req.param("conversationId");
  const body = await c.req.json<{ content?: string }>();
  const userContent = (body.content ?? "").trim();
  if (!userContent) return c.json({ error: "メッセージを入力してください。" }, 400);

  const conversation = await c.env.DB.prepare(
    "SELECT id, project_id FROM conversations WHERE id = ?",
  )
    .bind(conversationId)
    .first<{ id: string; project_id: string | null }>();
  if (!conversation) return c.json({ error: "会話が見つかりません。" }, 404);

  const monthlyBudgetJpy = Number(await getSetting(c.env.DB, "monthly_budget_jpy", c.env.DEFAULT_MONTHLY_BUDGET_JPY));
  const usdJpyRate = Number(await getSetting(c.env.DB, "usd_jpy_rate", c.env.DEFAULT_USD_JPY_RATE));
  const month = currentMonthKey();
  const budget = await getBudgetStatus(c.env.DB, month, monthlyBudgetJpy, usdJpyRate);

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
  )
    .bind(newId("msg"), conversationId, userContent, now)
    .run();

  if (budget.overBudget) {
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(
          enc.encode(
            sseEvent("budget_exceeded", {
              message: `今月のAI利用上限（¥${monthlyBudgetJpy.toLocaleString()}）に達したため、チャット機能は来月まで停止しています。管理者に上限の引き上げを依頼してください。`,
              spentJpySoFar: Math.round(budget.spentJpySoFar),
              monthlyBudgetJpy,
            }),
          ),
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  }

  const claudeModel = await getSetting(c.env.DB, "claude_model", c.env.CLAUDE_MODEL);
  const { results: history } = await c.env.DB.prepare(
    "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
  )
    .bind(conversationId)
    .all<{ role: string; content: string }>();

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const client = makeClient(c.env.ANTHROPIC_API_KEY);
  const appName = c.env.APP_NAME || "Geo Decision Agent";

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (type: string, data: unknown) => controller.enqueue(enc.encode(sseEvent(type, data)));

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let fullText = "";
      const steps: Array<{ label: string; status: string }> = [];

      try {
        for (let hop = 0; hop < 3; hop++) {
          const anthropicStream = client.messages.stream({
            model: claudeModel,
            max_tokens: 4096,
            thinking: { type: "disabled" },
            system: [
              { type: "text", text: buildSystemPrompt(appName), cache_control: { type: "ephemeral" } },
            ],
            tools: [ANALYZE_TOOL],
            messages,
          });

          anthropicStream.on("text", (delta) => {
            fullText += delta;
            send("delta", { text: delta });
          });

          const message = await anthropicStream.finalMessage();
          totalInputTokens += message.usage.input_tokens;
          totalOutputTokens += message.usage.output_tokens;

          const toolUses = message.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );

          messages.push({ role: "assistant", content: message.content });

          if (toolUses.length === 0 || message.stop_reason !== "tool_use") {
            break;
          }

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const toolUse of toolUses) {
            if (toolUse.name === "analyze_site_candidates") {
              const input = toolUse.input as { candidates: CandidateInput[]; purpose?: string };
              const eeConfigured = !!c.env.EE_SERVICE_ACCOUNT_JSON;
              steps.push({ label: "AlphaEarthで類似環境・変化を分析中", status: "done" });
              send("step", {
                label: eeConfigured
                  ? "Earth Engine実データ・現地記録と重ね合わせて分析中"
                  : "候補地の生物多様性影響を分析中（シミュレーション）",
              });

              const overrides: Record<string, RealDataOverride> = {};
              if (conversation.project_id) {
                const year = Number(await getSetting(c.env.DB, "earth_engine_year", "2024"));
                const referenceEmbedding = await getReferenceEmbedding(c.env, c.env.DB, conversation.project_id, year);

                for (const cand of input.candidates ?? []) {
                  const override: RealDataOverride = {};

                  if (cand.lat != null && cand.lng != null) {
                    const nearby = await findNearbyFieldRecords(c.env.DB, conversation.project_id, cand.lat, cand.lng);
                    override.fieldRecordsCount = nearby.length;
                    const species = nearby.map((n) => n.species_guess).filter((s): s is string => !!s);
                    if (species.length) override.fieldSpeciesNames = [...new Set(species)];

                    if (referenceEmbedding) {
                      const candVector = await getEmbeddingVector(c.env, c.env.DB, cand.lat, cand.lng, year);
                      if (candVector) {
                        override.alphaEarthSimilarity = Number(cosineSimilarity(candVector, referenceEmbedding).toFixed(3));
                      }
                    }
                  }

                  overrides[cand.name] = override;
                }
              }

              const results = analyzeCandidates(`${conversation.project_id ?? conversationId}`, input.candidates ?? [], overrides);

              if (conversation.project_id) {
                const analysisId = newId("an");
                for (const r of results) {
                  const candidateId = newId("cand");
                  await c.env.DB.prepare(
                    `INSERT INTO site_candidates (id, project_id, label, lat, lng, rank, score, habitat_overlap, protected_area_distance_km, connectivity_impact, ndre_change_pct, alphaearth_similarity, access_distance_km, access_rating, confidence, evidence_basis, field_records_count, recommended_action, analysis_id, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  )
                    .bind(
                      candidateId,
                      conversation.project_id,
                      r.label,
                      r.lat,
                      r.lng,
                      r.rank,
                      r.score,
                      r.habitatOverlap,
                      r.protectedAreaDistanceKm,
                      r.connectivityImpact,
                      r.ndreChangePct,
                      r.alphaEarthSimilarity,
                      r.accessDistanceKm,
                      r.accessRating,
                      r.confidence,
                      r.evidenceBasis.join(","),
                      r.fieldRecordsCount,
                      r.recommendedAction,
                      analysisId,
                      new Date().toISOString(),
                    )
                    .run();
                  for (const m of r.mitigations) {
                    await c.env.DB.prepare(
                      `INSERT INTO mitigation_measures (id, candidate_id, hierarchy_stage, description, priority, cost_impact, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    )
                      .bind(newId("mit"), candidateId, m.stage, m.description, m.priority, m.costImpact, new Date().toISOString())
                      .run();
                  }
                }
                send("analysis_saved", { analysisId, candidateCount: results.length });
              }

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify({
                  results,
                  note: eeConfigured
                    ? "evidenceBasisに「Earth Engine実データ」とある指標はGoogle Satellite Embeddingの実データ、それ以外（habitatOverlap/protectedAreaDistanceKm/connectivityImpact/ndreChangePct/accessDistanceKm）は本MVPのシミュレーション値。fieldRecordsCount・現地記録種は実際の現地記録。"
                    : "衛星データはシミュレーション値です（MVP）。fieldRecordsCountは実際の現地記録件数（登録があれば）。",
                }),
              });
            } else {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: "unknown tool",
                is_error: true,
              });
            }
          }

          messages.push({ role: "user", content: toolResults });
        }

        const costUsd = estimateCostUsd(claudeModel, totalInputTokens, totalOutputTokens);
        const costJpy = costUsd * usdJpyRate;

        await c.env.DB.prepare(
          "INSERT INTO messages (id, conversation_id, role, content, steps_json, input_tokens, output_tokens, cost_usd, created_at) VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)",
        )
          .bind(
            newId("msg"),
            conversationId,
            fullText,
            steps.length ? JSON.stringify(steps) : null,
            totalInputTokens,
            totalOutputTokens,
            costUsd,
            new Date().toISOString(),
          )
          .run();

        await c.env.DB.prepare(
          "INSERT INTO usage_log (id, user_id, month, model, input_tokens, output_tokens, cost_usd, cost_jpy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
          .bind(newId("use"), user.id, month, claudeModel, totalInputTokens, totalOutputTokens, costUsd, costJpy, new Date().toISOString())
          .run();

        await c.env.DB.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), conversationId)
          .run();

        send("done", { costJpy: Math.round(costJpy * 100) / 100 });
      } catch (err) {
        const message = err instanceof Anthropic.APIError ? err.message : "AIサービスでエラーが発生しました。";
        send("error", { message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
});
