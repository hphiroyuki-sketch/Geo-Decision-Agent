export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PHOTOS: R2Bucket;
  ANTHROPIC_API_KEY: string;
  SESSION_SECRET: string;
  CLAUDE_MODEL: string;
  DEFAULT_MONTHLY_BUDGET_JPY: string;
  DEFAULT_USD_JPY_RATE: string;
  APP_NAME: string;
  // Google Earth Engine (optional - falls back to simulated data when unset)
  EE_SERVICE_ACCOUNT_JSON?: string;
  EE_PROJECT_ID?: string;
}

export type Role = "admin" | "member" | "viewer";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  title: string | null;
}
