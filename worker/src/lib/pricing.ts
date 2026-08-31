// Claude API pricing (USD per million tokens), first-party rates.
// Kept as a small static table rather than an external call - pricing changes
// rarely enough that a redeploy to update this table is an acceptable cost.
const PRICING_PER_MTOK_USD: Record<string, { input: number; output: number }> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const rates = PRICING_PER_MTOK_USD[model] ?? PRICING_PER_MTOK_USD["claude-sonnet-5"];
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

export interface BudgetStatus {
  monthlyBudgetJpy: number;
  usdJpyRate: number;
  spentJpySoFar: number;
  remainingJpy: number;
  percentUsed: number;
  overBudget: boolean;
}

export async function getBudgetStatus(
  db: D1Database,
  month: string,
  monthlyBudgetJpy: number,
  usdJpyRate: number,
): Promise<BudgetStatus> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(cost_jpy), 0) as total FROM usage_log WHERE month = ?")
    .bind(month)
    .first<{ total: number }>();
  const spentJpySoFar = row?.total ?? 0;
  const remainingJpy = monthlyBudgetJpy - spentJpySoFar;
  return {
    monthlyBudgetJpy,
    usdJpyRate,
    spentJpySoFar,
    remainingJpy,
    percentUsed: monthlyBudgetJpy > 0 ? (spentJpySoFar / monthlyBudgetJpy) * 100 : 0,
    overBudget: remainingJpy <= 0,
  };
}
