import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Copy, Trash2 } from "lucide-react";
import { api } from "../lib/api";

interface Invite {
  id: string;
  code: string;
  email: string | null;
  role: string;
  used_by: string | null;
  created_at: string;
}

interface UsageResponse {
  month: string;
  status: { monthlyBudgetJpy: number; spentJpySoFar: number; remainingJpy: number; percentUsed: number; overBudget: boolean };
  byUser: { name: string; email: string; cost_jpy: number; input_tokens: number; output_tokens: number }[];
  history: { month: string; cost_jpy: number }[];
}

interface Settings {
  monthlyBudgetJpy: number;
  usdJpyRate: number;
  claudeModel: string;
}

export default function Admin() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");

  const loadAll = async () => {
    const [i, u, s] = await Promise.all([
      api.get<{ invites: Invite[] }>("/admin/invites"),
      api.get<UsageResponse>("/admin/usage"),
      api.get<Settings>("/admin/settings"),
    ]);
    setInvites(i.invites);
    setUsage(u);
    setSettings(s);
    setBudgetInput(String(s.monthlyBudgetJpy));
  };

  useEffect(() => {
    loadAll();
  }, []);

  const createInvite = async () => {
    const res = await api.post<{ invite: { code: string } }>("/admin/invites", {
      email: inviteEmail.trim() || undefined,
      role: inviteRole,
    });
    setNewCode(res.invite.code);
    setInviteEmail("");
    await loadAll();
  };

  const revokeInvite = async (id: string) => {
    await api.del(`/admin/invites/${id}`);
    await loadAll();
  };

  const saveBudget = async () => {
    await api.post("/admin/settings", { monthlyBudgetJpy: Number(budgetInput) });
    await loadAll();
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-lg font-semibold text-slate-800">管理設定</h1>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium text-sm text-slate-800">今月のAI利用状況</div>
          {usage && (
            <div className="text-xs text-slate-500">
              ¥{Math.round(usage.status.spentJpySoFar).toLocaleString()} / ¥
              {usage.status.monthlyBudgetJpy.toLocaleString()}（{usage.status.percentUsed.toFixed(1)}%）
            </div>
          )}
        </div>
        {usage && (
          <div className="w-full bg-slate-100 rounded-full h-2.5 mb-4">
            <div
              className={`h-2.5 rounded-full ${usage.status.overBudget ? "bg-red-500" : "bg-[var(--gda-green)]"}`}
              style={{ width: `${Math.min(100, usage.status.percentUsed)}%` }}
            />
          </div>
        )}
        {usage?.status.overBudget && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3 mb-4">
            今月の上限に達しています。チャットは来月まで自動停止中です。下記で上限を引き上げられます。
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <div className="text-xs text-slate-500 mb-2">過去の月別コスト（円）</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(usage?.history ?? []).slice().reverse()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="cost_jpy" fill="#1f7a4d" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-2">ユーザー別（今月）</div>
            <div className="space-y-2">
              {(usage?.byUser ?? []).map((u) => (
                <div key={u.email} className="flex justify-between text-xs">
                  <span>{u.name}</span>
                  <span className="text-slate-500">¥{Math.round(u.cost_jpy).toLocaleString()}</span>
                </div>
              ))}
              {(usage?.byUser ?? []).length === 0 && <div className="text-xs text-slate-400">まだ利用がありません。</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="font-medium text-sm text-slate-800 mb-3">予算設定</div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-slate-500">月間上限（円）</label>
          <input
            type="number"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-32"
          />
          <button onClick={saveBudget} className="bg-[var(--gda-green)] text-white text-xs font-medium px-3 py-1.5 rounded-lg">
            保存
          </button>
          {settings && <span className="text-[11px] text-slate-400">現在のモデル: {settings.claudeModel}</span>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="font-medium text-sm text-slate-800 mb-3">招待コードの発行</div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
          <input
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="メールアドレス（任意・限定する場合）"
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="member">メンバー</option>
            <option value="viewer">閲覧のみ</option>
            <option value="admin">管理者</option>
          </select>
          <button onClick={createInvite} className="bg-[var(--gda-navy)] text-white text-sm font-medium px-4 py-2 rounded-lg">
            発行
          </button>
        </div>
        {newCode && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-3 py-2 mb-3">
            招待コード: <span className="font-mono font-semibold">{newCode}</span>
            <button
              onClick={() => navigator.clipboard.writeText(newCode).catch(() => {})}
              className="ml-auto text-green-700 hover:text-green-900"
            >
              <Copy size={14} />
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[480px]">
          <thead>
            <tr className="text-slate-500 border-b border-slate-100">
              <th className="text-left py-2">コード</th>
              <th className="text-left py-2">メール</th>
              <th className="text-left py-2">ロール</th>
              <th className="text-left py-2">状態</th>
              <th className="text-left py-2"></th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id} className="border-b border-slate-50">
                <td className="py-2 font-mono">{inv.code}</td>
                <td className="py-2">{inv.email ?? "指定なし"}</td>
                <td className="py-2">{inv.role}</td>
                <td className="py-2">{inv.used_by ? "使用済み" : "未使用"}</td>
                <td className="py-2">
                  {!inv.used_by && (
                    <button onClick={() => revokeInvite(inv.id)} className="text-red-500 hover:text-red-700">
                      <Trash2 size={14} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
