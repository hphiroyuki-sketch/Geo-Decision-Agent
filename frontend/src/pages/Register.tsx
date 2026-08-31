import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("パスワードは8文字以上で設定してください。");
      return;
    }
    setBusy(true);
    try {
      await register(code, name, email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登録に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--gda-navy)] px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-md bg-[var(--gda-green)] flex items-center justify-center text-white font-bold">
            G
          </div>
          <div className="font-semibold text-slate-800">アカウント作成</div>
        </div>
        <p className="text-xs text-slate-500 mb-6">管理者から発行された招待コードを入力してください。</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">招待コード</label>
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">氏名</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">パスワード（8文字以上）</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)]"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-[var(--gda-green)] hover:bg-[var(--gda-green-dark)] disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            {busy ? "作成中..." : "アカウントを作成"}
          </button>
        </form>
        <p className="text-xs text-slate-500 mt-5 text-center">
          既にアカウントをお持ちの方は{" "}
          <Link to="/login" className="text-[var(--gda-green)] font-medium">
            ログイン
          </Link>
        </p>
      </div>
    </div>
  );
}
