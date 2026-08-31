import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Home,
  FolderKanban,
  Map,
  BarChart3,
  Database,
  FileText,
  Bell,
  Share2,
  Settings,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { useAuth } from "../lib/auth";

function NavItem({ to, icon: Icon, label, disabled }: { to: string; icon: typeof Home; label: string; disabled?: boolean }) {
  if (disabled) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-2.5 text-slate-500 cursor-not-allowed opacity-50"
        title="今後のアップデートで提供予定"
      >
        <Icon size={18} />
        <span className="text-sm">{label}</span>
      </div>
    );
  }
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2.5 rounded-lg mx-2 text-sm transition-colors ${
          isActive ? "bg-[var(--gda-green)] text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
        }`
      }
    >
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-60 shrink-0 bg-[var(--gda-navy)] flex flex-col py-4">
        <div className="flex items-center gap-2 px-4 pb-4 mb-2 border-b border-white/10">
          <div className="w-8 h-8 rounded-md bg-[var(--gda-green)] flex items-center justify-center text-white font-bold">
            G
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-tight">Geo Decision Agent</div>
            <div className="text-slate-400 text-[11px] leading-tight">限定公開 / MVP</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1">
          <NavItem to="/" icon={Home} label="ホーム" />
          <NavItem to="/" icon={FolderKanban} label="プロジェクト" />
          <NavItem to="#" icon={Map} label="地図ビュー" disabled />
          <NavItem to="#" icon={BarChart3} label="分析" disabled />
          <NavItem to="#" icon={Database} label="データ" disabled />
          <NavItem to="#" icon={FileText} label="レポート" disabled />
          <NavItem to="#" icon={Bell} label="アラート" disabled />
          <NavItem to="#" icon={Share2} label="共有" disabled />
          {user?.role === "admin" && <NavItem to="/admin" icon={Settings} label="管理設定" />}
        </nav>
        <div className="px-2 pt-2 border-t border-white/10 mt-2">
          <div className="flex items-center gap-2 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-white text-xs font-medium">
              {user?.name?.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <div className="text-white text-xs font-medium truncate">{user?.name}</div>
              <div className="text-slate-400 text-[11px] flex items-center gap-1">
                {user?.role === "admin" && <ShieldCheck size={11} />}
                {user?.role === "admin" ? "管理者" : "メンバー"}
              </div>
            </div>
          </div>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="flex items-center gap-2 w-full px-4 py-2 text-slate-400 hover:text-white text-sm"
          >
            <LogOut size={16} /> ログアウト
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-[var(--gda-bg)]">
        <Outlet />
      </main>
    </div>
  );
}
