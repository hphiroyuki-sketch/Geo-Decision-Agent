import { useState } from "react";
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
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";

function NavItem({
  to,
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  to: string;
  icon: typeof Home;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
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
      onClick={onClick}
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

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <nav className="flex-1 space-y-1">
        <NavItem to="/" icon={Home} label="ホーム" onClick={onNavigate} />
        <NavItem to="/" icon={FolderKanban} label="プロジェクト" onClick={onNavigate} />
        <NavItem to="#" icon={Map} label="地図ビュー" disabled />
        <NavItem to="#" icon={BarChart3} label="分析" disabled />
        <NavItem to="#" icon={Database} label="データ" disabled />
        <NavItem to="#" icon={FileText} label="レポート" disabled />
        <NavItem to="#" icon={Bell} label="アラート" disabled />
        <NavItem to="#" icon={Share2} label="共有" disabled />
        {user?.role === "admin" && <NavItem to="/admin" icon={Settings} label="管理設定" onClick={onNavigate} />}
      </nav>
      <div className="px-2 pt-2 border-t border-white/10 mt-2">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="w-8 h-8 rounded-full bg-slate-600 flex items-center justify-center text-white text-xs font-medium shrink-0">
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
    </>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 bg-[var(--gda-navy)] flex-col py-4">
        <div className="flex items-center gap-2 px-4 pb-4 mb-2 border-b border-white/10">
          <div className="w-8 h-8 rounded-md bg-[var(--gda-green)] flex items-center justify-center text-white font-bold shrink-0">
            G
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-tight">Geo Decision Agent</div>
            <div className="text-slate-400 text-[11px] leading-tight">限定公開 / MVP</div>
          </div>
        </div>
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center justify-between px-4 h-14 shrink-0 bg-[var(--gda-navy)]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-[var(--gda-green)] flex items-center justify-center text-white font-bold text-sm shrink-0">
            G
          </div>
          <div className="text-white font-semibold text-sm truncate">Geo Decision Agent</div>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="text-slate-300 p-2 -mr-2"
          aria-label="メニューを開く"
        >
          <Menu size={22} />
        </button>
      </header>

      {/* Mobile slide-over drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-72 max-w-[85vw] bg-[var(--gda-navy)] flex flex-col py-4 h-full">
            <div className="flex items-center justify-between px-4 pb-4 mb-2 border-b border-white/10">
              <div className="text-white font-semibold text-sm">メニュー</div>
              <button onClick={() => setDrawerOpen(false)} className="text-slate-300 p-1" aria-label="閉じる">
                <X size={20} />
              </button>
            </div>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto bg-[var(--gda-bg)] pb-16 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--gda-navy)] border-t border-white/10 flex items-stretch h-16">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] ${
              isActive ? "text-[var(--gda-green)]" : "text-slate-400"
            }`
          }
        >
          <Home size={20} />
          ホーム
        </NavLink>
        <NavLink
          to="/"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] ${
              isActive ? "text-[var(--gda-green)]" : "text-slate-400"
            }`
          }
        >
          <FolderKanban size={20} />
          プロジェクト
        </NavLink>
        {user?.role === "admin" && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] ${
                isActive ? "text-[var(--gda-green)]" : "text-slate-400"
              }`
            }
          >
            <Settings size={20} />
            管理設定
          </NavLink>
        )}
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] text-slate-400"
        >
          <Menu size={20} />
          メニュー
        </button>
      </nav>
    </div>
  );
}
