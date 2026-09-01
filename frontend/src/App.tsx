import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
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

export default function App() {
  return (
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
        <Route path="/projects/:id/recovery" element={<RecoveryPlan />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
