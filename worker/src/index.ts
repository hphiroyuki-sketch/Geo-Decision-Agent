import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Env, AuthUser } from "./types";
import { attachUser, requireAuth, requireAdmin } from "./lib/auth";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { projectRoutes } from "./routes/projects";
import { chatRoutes } from "./routes/chat";

type AppEnv = { Bindings: Env; Variables: { user: AuthUser | null } };

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use("/api/*", attachUser);

app.route("/api/auth", authRoutes);

app.use("/api/projects/*", requireAuth);
app.route("/api/projects", projectRoutes);

app.use("/api/conversations/*", requireAuth);
app.route("/api/conversations", chatRoutes);

app.use("/api/admin/*", requireAdmin);
app.route("/api/admin", adminRoutes);

app.get("/api/health", (c) => c.json({ ok: true, app: c.env.APP_NAME }));

export default app;
