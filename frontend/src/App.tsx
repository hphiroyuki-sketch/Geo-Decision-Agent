import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RefreshCw, WifiOff } from "lucide-react";
import { useAuth } from "./lib/auth";
import { registerServiceWorker, applyUpdate } from "./lib/pwa";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Home from "./pages/Home";
import ProjectChat from "./pages/ProjectChat";
import AnalysisResults from "./pages/AnalysisResults";
import DecisionReport from "./pages/DecisionReport";
import FieldSurvey from "./pages/FieldSurvey";
import Admin from "./pages/Admin";
import Dashboard from "./pages/Dashboard";
import MeshView from "./pages/MeshView";
import RecoveryPlan from "./pages/RecoveryPlan";
import MapExplorer from "./pages/MapExplorer";
import DataCatalog from "./pages/DataCatalog";
import ReportsIndex from "./pages/ReportsIndex";
import Alerts from "./pages/Alerts";
import LeapReport from "./pages/LeapReport";

function ProtectedLayout() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        読み込み中...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

/**
 * The two states a PWA has to tell the user about itself: a new build is ready,
 * and the network is gone. Both are one line at the top of the screen rather
 * than a modal, because neither blocks what the user is currently doing.
 */
function ConnectionBanners() {
  const [updateReady, setUpdateReady] = useState(false);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);

  useEffect(() => {
    registerServiceWorker(() => setUpdateReady(true));
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (!updateReady && !offline) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[60] flex flex-col items-center gap-1 p-2 pointer-events-none">
      {offline && (
        <div className="pointer-events-auto flex items-center gap-2 bg-slate-800 text-white text-[11px] rounded-full px-3 py-1.5 shadow-lg">
          <WifiOff size={12} />
          オフラインです。保存済みの画面は開けますが、新しい分析は通信が戻ってから実行されます。
        </div>
      )}
      {updateReady && (
        <button
          onClick={applyUpdate}
          className="pointer-events-auto flex items-center gap-2 bg-[var(--gda-green)] text-white text-[11px] font-medium rounded-full px-3 py-1.5 shadow-lg"
        >
          <RefreshCw size={12} />
          新しいバージョンがあります。タップして更新
        </button>
      )}
    </div>
  );
}

export default function App() {
  return (
    <>
    <ConnectionBanners />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/map" element={<MapExplorer />} />
        <Route path="/data" element={<DataCatalog />} />
        <Route path="/reports" element={<ReportsIndex />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/recovery" element={<RecoveryPlan />} />
        <Route path="/projects/:id" element={<ProjectChat />} />
        <Route path="/projects/:id/analysis" element={<AnalysisResults />} />
        <Route path="/projects/:id/report" element={<DecisionReport />} />
        <Route path="/projects/:id/field" element={<FieldSurvey />} />
        <Route path="/projects/:id/mesh" element={<MeshView />} />
        <Route path="/projects/:id/leap" element={<LeapReport />} />
        <Route path="/projects/:id/recovery" element={<RecoveryPlan />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
