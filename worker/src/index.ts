import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Env, AuthUser } from "./types";
import { attachUser, requireAuth, requireAdmin } from "./lib/auth";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { projectRoutes } from "./routes/projects";
import { chatRoutes } from "./routes/chat";
import { fieldRecordRoutes } from "./routes/fieldRecords";
import { meshRoutes } from "./routes/mesh";
import { dashboardRoutes } from "./routes/dashboard";
import { alertRoutes } from "./routes/alerts";
import { runSystemChecks, generateAlerts } from "./lib/scheduled";
import { newId } from "./lib/crypto";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use("/api/*", attachUser);

app.route("/api/auth", authRoutes);

app.use("/api/projects/*", requireAuth);
app.route("/api/projects", projectRoutes);

app.use("/api/field-records/*", requireAuth);
app.route("/api", fieldRecordRoutes);

// Mesh endpoints are addressed both per project and per mesh, so they mount at
// the API root and each prefix they own is guarded here.
app.use("/api/meshes/*", requireAuth);
app.use("/api/recovery-actions/*", requireAuth);
app.route("/api", meshRoutes);

app.use("/api/alerts/*", requireAuth);
app.route("/api/alerts", alertRoutes);

app.use("/api/dashboard/*", requireAuth);
app.route("/api/dashboard", dashboardRoutes);

app.use("/api/conversations/*", requireAuth);
app.route("/api/conversations", chatRoutes);

app.use("/api/admin/*", requireAdmin);
app.route("/api/admin", adminRoutes);

app.get("/api/health", (c) => c.json({ ok: true, app: c.env.APP_NAME }));

export default {
  fetch: app.fetch,
  /**
   * Cron entry point. Runs the Earth Engine self-checks and refreshes alerts,
   * so a broken expression graph or a standing threshold breach is recorded
   * without anyone having to open a page.
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        // Heartbeat first. If the checks below overrun the CPU budget and the
        // isolate is killed, this row still proves the cron fired at all -
        // which is otherwise indistinguishable from a trigger that never ran.
        try {
          await env.DB.prepare(
            `INSERT INTO system_checks (id, check_name, ok, message, duration_ms, checked_at)
             VALUES (?, 'cron_heartbeat', 1, ?, 0, ?)`,
          )
            .bind(newId("chk"), `cron ${event.cron ?? ""}`, new Date().toISOString())
            .run();
        } catch {
          // Nothing useful to do here; the run continues either way.
        }

        try {
          await runSystemChecks(env);
        } catch (err) {
          console.error("system checks failed", err);
        }
        try {
          await generateAlerts(env);
        } catch (err) {
          console.error("alert generation failed", err);
        }
      })(),
    );
  },
};
