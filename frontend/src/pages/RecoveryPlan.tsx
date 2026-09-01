import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { MapPin, Target, Gauge, CalendarClock, User2 } from "lucide-react";
import { api } from "../lib/api";

interface ActionRow {
  id: string;
  project_id: string;
  hotspot_id: string;
  stage: string;
  title: string;
  description: string;
  expected_change: string;
  indicator: string;
  frequency: string;
  area_ha: number;
  center_lat: number;
  center_lng: number;
  priority: number;
  status: string;
  owner_user_id: string | null;
  owner_name?: string | null;
  due_date: string | null;
  project_name?: string;
}

interface UserRow {
  id: string;
  name: string;
}

const STAGE_LABEL: Record<string, string> = {
  avoid: "回避",
  reduce: "低減",
  restore: "回復",
  offset: "オフセット",
};

const STAGE_STYLE: Record<string, string> = {
  avoid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  reduce: "bg-sky-50 text-sky-700 border-sky-200",
  restore: "bg-amber-50 text-amber-700 border-amber-200",
  offset: "bg-slate-100 text-slate-600 border-slate-200",
};

const STATUS_OPTIONS = [
  { value: "proposed", label: "提案" },
  { value: "accepted", label: "採用" },
  { value: "in_progress", label: "実施中" },
  { value: "done", label: "完了" },
  { value: "rejected", label: "見送り" },
];

export default function RecoveryPlan() {
  const { id } = useParams<{ id: string }>();
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [members, setMembers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const res = await api.get<{ actions: ActionRow[] }>("/dashboard/recovery-actions");
    setActions(id ? res.actions.filter((a) => a.project_id === id) : res.actions);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // Assigning an owner needs the member list; a viewer without admin rights
    // still sees the plan, just without the picker.
    api
      .get<{ users: UserRow[] }>("/admin/users")
      .then((r) => setMembers(r.users))
      .catch(() => setMembers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const update = async (actionId: string, patch: Record<string, unknown>) => {
    await api.post(`/recovery-actions/${actionId}`, patch);
    load();
  };

  const totalArea = actions.reduce((sum, a) => sum + a.area_ha, 0);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <div className="text-xs text-slate-400">FR-052 / FR-054 / FR-055</div>
        <h1 className="text-lg font-semibold text-slate-800">生物多様性 回復計画</h1>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          10mメッシュで抽出した重要区域ごとに、回避→低減→回復→オフセットの順で施策を提示します。各施策は
          対象区域・期待変化・測定指標・頻度を持ち、担当者と期限を設定して実行に移せます。
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[11px] text-slate-500">施策件数</div>
          <div className="text-xl font-semibold text-slate-800">{actions.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[11px] text-slate-500">対象面積</div>
          <div className="text-xl font-semibold text-slate-800">
            {totalArea.toFixed(2)} <span className="text-xs font-normal">ha</span>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-3">
          <div className="text-[11px] text-slate-500">担当者未設定</div>
          <div className="text-xl font-semibold text-slate-800">
            {actions.filter((a) => !a.owner_user_id).length}
          </div>
        </div>
      </div>

      {loading && <div className="text-sm text-slate-400 py-10 text-center">読み込み中...</div>}

      {!loading && actions.length === 0 && (
        <div className="text-center text-slate-400 text-sm py-12 bg-white rounded-xl border border-slate-200">
          まだ回復計画がありません。10mメッシュ解析を実行すると、重要区域ごとの施策が自動生成されます。
        </div>
      )}

      <div className="space-y-3">
        {actions.map((a) => (
          <div key={a.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-start gap-3">
              <div className="text-xs font-semibold text-slate-400 pt-0.5 w-6 shrink-0">{a.priority}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[11px] font-medium border rounded-full px-2 py-0.5 ${STAGE_STYLE[a.stage]}`}>
                    {STAGE_LABEL[a.stage] ?? a.stage}
                  </span>
                  <span className="text-[11px] text-slate-400">{a.area_ha.toFixed(2)} ha</span>
                </div>
                <h2 className="text-sm font-semibold text-slate-800 mt-1.5">{a.title}</h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{a.description}</p>

                <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="flex gap-1.5">
                    <MapPin size={13} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className="text-slate-400">施策区域</dt>
                      <dd className="text-slate-700">
                        {a.center_lat.toFixed(5)}, {a.center_lng.toFixed(5)}
                      </dd>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Target size={13} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className="text-slate-400">期待変化</dt>
                      <dd className="text-slate-700">{a.expected_change}</dd>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Gauge size={13} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className="text-slate-400">測定指標</dt>
                      <dd className="text-slate-700">{a.indicator}</dd>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <CalendarClock size={13} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <dt className="text-slate-400">測定頻度</dt>
                      <dd className="text-slate-700">{a.frequency}</dd>
                    </div>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <select
                    value={a.status}
                    onChange={(e) => update(a.id, { status: e.target.value })}
                    className="text-[11px] border border-slate-300 rounded-lg px-2 py-1"
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span className="flex items-center gap-1 text-[11px] text-slate-400">
                    <User2 size={12} />
                  </span>
                  <select
                    value={a.owner_user_id ?? ""}
                    onChange={(e) => update(a.id, { ownerUserId: e.target.value || null })}
                    className="text-[11px] border border-slate-300 rounded-lg px-2 py-1"
                  >
                    <option value="">担当者未設定</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={a.due_date ?? ""}
                    onChange={(e) => update(a.id, { dueDate: e.target.value || null })}
                    className="text-[11px] border border-slate-300 rounded-lg px-2 py-1"
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
