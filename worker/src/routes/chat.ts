import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env, AuthUser } from "../types";
import { newId } from "../lib/crypto";
import { getSetting, currentMonthKey } from "../lib/db";
import { estimateCostUsd, getBudgetStatus } from "../lib/pricing";
import {
  makeClient,
  buildSystemPrompt,
  ANALYZE_TOOL,
  PROMPT_VERSION,
  EMBEDDING_DATASET,
  INDICES_DATASET,
} from "../lib/anthropicClient";
import { analyzeCandidates, ENGINE_VERSION, type CandidateInput, type RealDataOverride } from "../lib/geoEngine";
import { buildMeshContext } from "../lib/mesh";
import {
  getEmbeddingVector,
  getReferenceEmbedding,
  findNearbyFieldRecords,
  distanceToNearestReferencePointM,
  getIndexChange,
  cosineSimilarity,
} from "../lib/fieldData";

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

      // The mesh findings ride along as context so the assistant reasons from
      // what the grid measured rather than restating the conversation.
      const meshContext = conversation.project_id
        ? await buildMeshContext(c.env.DB, conversation.project_id)
        : null;

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
              ...(meshContext ? [{ type: "text" as const, text: meshContext }] : []),
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

              // FR-002 / 4.2: the user asked in their own words, so the plan the
              // request was turned into has to be visible before the answer is.
              // The stages are announced up front and then reported as they
              // finish, which is also what makes a wrong answer traceable to the
              // stage that produced it.
              const plan = [
                { label: "評価条件を整理", detail: `対象 ${(input.candidates ?? []).length} 地点／${input.purpose ?? "目的未指定"}` },
                {
                  label: "現地記録と重ね合わせ",
                  detail: "確認済みの観察記録を候補地の周辺2km圏で照合します",
                },
                {
                  label: eeConfigured ? "衛星データを取得（AlphaEarth・Sentinel-2）" : "衛星データ（シミュレーション）",
                  detail: eeConfigured
                    ? "埋め込み類似度とNDRE等の指標を実測します"
                    : "Earth Engine未接続のため推定値で代替します",
                },
                { label: "候補地をスコアリング", detail: "同一の評価軸でランキングします" },
                { label: "ミティゲーション案を作成", detail: "回避 → 低減 → 回復 → オフセットの順で提示します" },
              ];
              send("plan", { steps: plan });
              const advance = (index: number) => send("step", { index, label: plan[index].label });

              steps.push({ label: "AlphaEarthで類似環境・変化を分析中", status: "done" });
              advance(0);

              const overrides: Record<string, RealDataOverride> = {};
              let referencePointCount = 0;
              advance(1);
              if (conversation.project_id) {
                const year = Number(await getSetting(c.env.DB, "earth_engine_year", "2024"));
                const referenceEmbedding = await getReferenceEmbedding(c.env, c.env.DB, conversation.project_id, year);
                referencePointCount = referenceEmbedding?.points.length ?? 0;

                for (const cand of input.candidates ?? []) {
                  const override: RealDataOverride = {};

                  if (cand.lat != null && cand.lng != null) {
                    advance(2);
                    const nearby = await findNearbyFieldRecords(c.env.DB, conversation.project_id, cand.lat, cand.lng);
                    override.fieldRecordsCount = nearby.length;
                    override.confirmedFieldRecordsCount = nearby.filter((n) => n.review_status === "confirmed").length;
                    const species = nearby.map((n) => n.species_guess).filter((s): s is string => !!s);
                    if (species.length) override.fieldSpeciesNames = [...new Set(species)];

                    // FR-022: the measured index change for this point. Two
                    // cached Earth Engine calls, so a three-candidate analysis
                    // stays well inside the 50-subrequest budget.
                    const change = await getIndexChange(c.env, c.env.DB, cand.lat, cand.lng, year);
                    if (change) {
                      override.indices = change.current;
                      if (change.ndreChangePct !== null) {
                        override.ndreChangePct = change.ndreChangePct;
                        override.ndreYears = [change.previousYear, change.year];
                      }
                    }

                    if (referenceEmbedding) {
                      const candVector = await getEmbeddingVector(c.env, c.env.DB, cand.lat, cand.lng, year);
                      if (candVector) {
                        override.alphaEarthSimilarity = Number(
                          cosineSimilarity(candVector, referenceEmbedding.vector).toFixed(3),
                        );
                        override.referenceDistanceM = distanceToNearestReferencePointM(
                          cand.lat,
                          cand.lng,
                          referenceEmbedding.points,
                        );
                      }
                    }
                  }

                  overrides[cand.name] = override;
                }
              }

              advance(3);
              const results = analyzeCandidates(`${conversation.project_id ?? conversationId}`, input.candidates ?? [], overrides);
              advance(4);

              if (conversation.project_id) {
                const analysisId = newId("an");
                const year = Number(await getSetting(c.env.DB, "earth_engine_year", "2024"));

                // FR-007 / NFR-010: the snapshot. Everything that could move the
                // numbers between two runs is written down here, so "re-run this
                // analysis" is replaying a record rather than trusting scroll-back.
                await c.env.DB.prepare(
                  `INSERT INTO analyses (id, project_id, conversation_id, run_by, purpose, inputs_json, candidate_count,
                     model, prompt_version, engine_version, earth_engine_year, embedding_dataset, indices_dataset,
                     earth_engine_available, reference_points, executed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                  .bind(
                    analysisId,
                    conversation.project_id,
                    conversationId,
                    user.id,
                    input.purpose ?? null,
                    JSON.stringify(input.candidates ?? []),
                    results.length,
                    claudeModel,
                    PROMPT_VERSION,
                    ENGINE_VERSION,
                    year,
                    EMBEDDING_DATASET,
                    INDICES_DATASET,
                    eeConfigured ? 1 : 0,
                    referencePointCount,
                    new Date().toISOString(),
                  )
                  .run();

                for (const r of results) {
                  const candidateId = newId("cand");
                  await c.env.DB.prepare(
                    `INSERT INTO site_candidates (id, project_id, label, lat, lng, rank, score, habitat_overlap, protected_area_distance_km, connectivity_impact, ndre_change_pct, alphaearth_similarity, access_distance_km, access_rating, confidence, evidence_basis, field_records_count, recommended_action, analysis_id, created_at, ndre_measured, ndvi, ndre, ndmi, nbr)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                      r.ndreMeasured ? 1 : 0,
                      r.indices?.ndvi ?? null,
                      r.indices?.ndre ?? null,
                      r.indices?.ndmi ?? null,
                      r.indices?.nbr ?? null,
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
