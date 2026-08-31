export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  SESSION_SECRET: string;
  CLAUDE_MODEL: string;
  DEFAULT_MONTHLY_BUDGET_JPY: string;
  DEFAULT_USD_JPY_RATE: string;
  APP_NAME: string;
}

export type Role = "admin" | "member" | "viewer";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  title: string | null;
}
