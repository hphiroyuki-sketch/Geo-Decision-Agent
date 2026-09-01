import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Camera, MapPin, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { api } from "../lib/api";

interface FieldRecordRow {
  id: string;
  lat: number;
  lng: number;
  gps_accuracy_m: number | null;
  species_guess: string | null;
  taxon_confidence: string | null;
  notes: string | null;
  photo_key: string | null;
  captured_at: string;
  review_status: string;
  observer_name: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function FieldSurvey() {
  const { id } = useParams<{ id: string }>();
  const [records, setRecords] = useState<FieldRecordRow[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [speciesGuess, setSpeciesGuess] = useState("");
  const [taxonConfidence, setTaxonConfidence] = useState("中");
  const [notes, setNotes] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [manualCoords, setManualCoords] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    if (!id) return;
    api.get<{ records: FieldRecordRow[] }>(`/projects/${id}/field-records`).then((r) => setRecords(r.records));
  };

  useEffect(load, [id]);

  const captureLocation = () => {
    setLocationError(null);
    if (!navigator.geolocation) {
      setLocationError("この端末では位置情報を取得できません。");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setLocating(false);
      },
      (err) => {
        setLocationError(`位置情報の取得に失敗しました（${err.message}）。手動入力に切り替えてください。`);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const applyManualCoords = () => {
    setLocationError(null);
    const parts = manualCoords.split(/[,\s]+/).filter(Boolean).map(Number);
    if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) {
      setLocationError("「緯度, 経度」の形式で入力してください（例: 34.723083, 135.502149）。");
      return;
    }
    const [lat, lng] = parts;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setLocationError("緯度は-90〜90、経度は-180〜180の範囲で入力してください。");
      return;
    }
    setCoords({ lat, lng, accuracy: 0 });
  };

  const onPhotoSelected = (file: File | null) => {
    setPhotoFile(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  };

  const submit = async () => {
    if (!id || !coords) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        lat: coords.lat,
        lng: coords.lng,
        gpsAccuracyM: coords.accuracy,
        speciesGuess: speciesGuess || undefined,
        taxonConfidence,
        notes: notes || undefined,
        capturedAt: new Date().toISOString(),
      };
      if (photoFile) {
        body.photoBase64 = await fileToBase64(photoFile);
        body.photoContentType = photoFile.type || "image/jpeg";
      }
      await api.post(`/projects/${id}/field-records`, body);
      setSpeciesGuess("");
      setNotes("");
      onPhotoSelected(null);
      setCoords(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const review = async (recordId: string, status: "confirmed" | "rejected") => {
    await api.post(`/field-records/${recordId}/review`, { status });
    load();
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <div className="text-xs text-slate-400">現地調査</div>
        <h1 className="text-lg font-semibold text-slate-800">現地記録の登録</h1>
        <p className="text-xs text-slate-500 mt-1">
          現場で撮影した生物・植物の写真とGPS位置を記録します。分析時に衛星データと重ね合わせて評価されます。
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">写真</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => onPhotoSelected(e.target.files?.[0] ?? null)}
            className="hidden"
            id="photo-input"
          />
          {photoPreview ? (
            <div className="relative w-full max-w-xs">
              <img src={photoPreview} alt="プレビュー" className="rounded-lg w-full object-cover" />
              <button
                onClick={() => onPhotoSelected(null)}
                className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1"
              >
                <XCircle size={18} />
              </button>
            </div>
          ) : (
            <label
              htmlFor="photo-input"
              className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-lg py-8 text-slate-500 text-sm cursor-pointer hover:border-[var(--gda-green)] hover:text-[var(--gda-green)]"
            >
              <Camera size={20} /> 写真を撮影 / 選択
            </label>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1.5">位置情報</label>
          {coords ? (
            <div className="flex items-center justify-between gap-2 text-sm text-slate-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <span className="flex items-center gap-2">
                <MapPin size={16} className="text-green-700" />
                {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                {coords.accuracy > 0 ? `（精度 ±${coords.accuracy.toFixed(0)}m）` : "（手入力）"}
              </span>
              <button onClick={() => setCoords(null)} className="text-xs text-slate-500 underline shrink-0">
                変更
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                onClick={captureLocation}
                disabled={locating}
                className="flex items-center gap-2 text-sm font-medium bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-lg px-3 py-2"
              >
                {locating ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} />}
                {locating ? "取得中..." : "現在地を取得"}
              </button>
              <div className="flex gap-2">
                <input
                  value={manualCoords}
                  onChange={(e) => setManualCoords(e.target.value)}
                  placeholder="または緯度, 経度を入力（例: 34.723083, 135.502149）"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)]"
                  onKeyDown={(e) => e.key === "Enter" && applyManualCoords()}
                />
                <button
                  onClick={applyManualCoords}
                  className="text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg px-3 shrink-0"
                >
                  設定
                </button>
              </div>
            </div>
          )}
          {locationError && <p className="text-xs text-red-600 mt-1.5">{locationError}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">種候補（分かる範囲で）</label>
            <input
              value={speciesGuess}
              onChange={(e) => setSpeciesGuess(e.target.value)}
              placeholder="例: ニホンイシガメ"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">同定の確からしさ</label>
            <select
              value={taxonConfidence}
              onChange={(e) => setTaxonConfidence(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="高">高（種まで確実）</option>
              <option value="中">中（近い種と思われる）</option>
              <option value="低">低（不明・要確認）</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">メモ</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="状況、周辺環境など"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gda-green)]"
          />
        </div>

        <button
          onClick={submit}
          disabled={!coords || submitting}
          className="w-full bg-[var(--gda-green)] hover:bg-[var(--gda-green-dark)] disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg"
        >
          {submitting ? "送信中..." : "現地記録を登録"}
        </button>
      </div>

      <div>
        <div className="text-sm font-medium text-slate-700 mb-2">登録済みの現地記録（{records.length}件）</div>
        <div className="space-y-2">
          {records.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex gap-3">
              {r.photo_key && (
                <img
                  src={`/api/field-records/${r.id}/photo`}
                  alt={r.species_guess ?? "現地写真"}
                  className="w-16 h-16 rounded-lg object-cover shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-sm text-slate-800 truncate">{r.species_guess ?? "種未記入"}</div>
                  <span
                    className={`shrink-0 text-[11px] flex items-center gap-1 font-medium ${
                      r.review_status === "confirmed"
                        ? "text-green-700"
                        : r.review_status === "rejected"
                          ? "text-red-600"
                          : "text-slate-400"
                    }`}
                  >
                    {r.review_status === "confirmed" ? (
                      <CheckCircle2 size={13} />
                    ) : r.review_status === "rejected" ? (
                      <XCircle size={13} />
                    ) : (
                      <Clock size={13} />
                    )}
                    {r.review_status === "confirmed" ? "確認済み" : r.review_status === "rejected" ? "却下" : "未確認"}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {r.observer_name} ・ {new Date(r.captured_at).toLocaleString("ja-JP")}
                </div>
                {r.notes && <div className="text-xs text-slate-600 mt-1">{r.notes}</div>}
                {r.review_status === "unreviewed" && (
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => review(r.id, "confirmed")}
                      className="text-[11px] font-medium bg-green-50 text-green-700 border border-green-200 rounded-full px-2.5 py-1"
                    >
                      確認済みにする
                    </button>
                    <button
                      onClick={() => review(r.id, "rejected")}
                      className="text-[11px] font-medium bg-red-50 text-red-600 border border-red-200 rounded-full px-2.5 py-1"
                    >
                      却下
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {records.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-8">まだ現地記録がありません。</div>
          )}
        </div>
      </div>
    </div>
  );
}
