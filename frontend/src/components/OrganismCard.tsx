import { useEffect, useState } from "react";
import { api } from "../lib/api";
import referenceData from "../data/speciesReference.json";

export interface ObservationRecord {
  id: string; project_id?: string; lat: number; lng: number;
  species_guess: string | null; demo?: number; source?: string;
  photo_key?: string | null; photo_content_type?: string | null;
  captured_at?: string; observer_name?: string; review_status?: string;
  media_sha256?: string | null; location_source?: string | null; created_at?: string;
  taxon_confidence?: string | null; notes?: string | null; gps_accuracy_m?: number | null;
}
const TAXON_JA: Record<string,string> = { Pinales:"マツ目", Fagales:"ブナ目", Poales:"イネ目", Sapindales:"ムクロジ目", Cupressaceae:"ヒノキ科", Fagaceae:"ブナ科", Betulaceae:"カバノキ科", Poaceae:"イネ科", Sapindaceae:"ムクロジ科", Cryptomeria:"スギ属", Fagus:"ブナ属", Quercus:"コナラ属", Betula:"カバノキ属", Sasa:"ササ属", Aesculus:"トチノキ属" };
type Reference = { scientificName: string; order?: string | null; family?: string | null; genus?: string | null; taxonomySource: string; image?: { url: string; source: string; author: string; license: string; licenseUrl: string } };

export default function OrganismCard({ recordId }: { recordId: string }) {
  const [record, setRecord] = useState<ObservationRecord | null>(null);
  const [error, setError] = useState("");
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api.get<{record: ObservationRecord}>(`/field-records/${encodeURIComponent(recordId)}`)
      .then(r => { if (live) setRecord(r.record); }).catch(() => { if (live) setError("記録を取得できませんでした。閉じて開き直してください。"); });
    return () => { live = false; };
  }, [recordId]);
  if (error) return <p role="alert">{error}</p>;
  if (!record) return <p role="status">生物の記録を読み込み中…</p>;
  const name = record.species_guess?.replace(/^【デモ】/, "").trim() || "種名未登録";
  const ref = (referenceData as Record<string, Reference>)[name];
  const actualPhoto = Boolean(record.photo_key && !record.demo);
  const src = actualPhoto ? `/api/field-records/${encodeURIComponent(record.id)}/photo` : ref?.image?.url;
  return <article className="organism-card">
    {src && !imageFailed ? <figure>
      {actualPhoto && record.photo_content_type?.startsWith("video/")
        ? <video src={src} controls preload="metadata" />
        : <img src={src} alt={`${name}（${actualPhoto ? "登録された現地写真" : "参考写真・この地点の観測ではありません"}）`} referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />}
      <figcaption>{actualPhoto ? "この記録に登録されたメディア" : <>参考写真・現地の観測証拠ではありません<br /><a href={ref?.image?.source} target="_blank" rel="noreferrer">{ref?.image?.author}</a> · <a href={ref?.image?.licenseUrl || ref?.image?.source} target="_blank" rel="noreferrer">{ref?.image?.license}</a></>}</figcaption>
    </figure> : <div className="organism-no-photo">{imageFailed ? "写真を読み込めませんでした" : "写真・動画は未登録"}</div>}
    <div className="organism-body">
      <span className="organism-badge">{record.demo ? "デモ / 実地観測ではありません" : record.source === "map_pin" ? "地図指定 / 現地未確認" : record.review_status === "confirmed" ? "現地記録 / レビュー済み" : "現地記録 / レビュー待ち"}</span>
      <h3>{name}</h3><p className="organism-latin">{ref?.scientificName ?? "学名は未登録"}</p>
      <dl>
        <dt>目 / 科 / 属</dt><dd>{[ref?.order, ref?.family, ref?.genus].map(v => v ? TAXON_JA[v] ?? v : "未確認").join(" / ")}</dd>
        <dt>希少性・レッドリスト</dt><dd>未照合（国・地域・評価年の確認が必要）</dd>
        <dt>AI同定</dt><dd>未実施 / 判定精度は未検証</dd>
        <dt>記録者の確信度</dt><dd>{record.demo ? "対象外（デモ）" : record.taxon_confidence || "未記入"} <small>※AIの正解率ではありません</small></dd>
        <dt>記録日時</dt><dd>{record.captured_at ? new Date(record.captured_at).toLocaleString("ja-JP") : "未登録"}{record.demo ? "（デモ作成日時）" : ""}</dd>
      </dl>
      {ref && <p className="organism-note">分類は入力された種名に対応する<a href={ref.taxonomySource} target="_blank" rel="noreferrer">GBIFの参考情報</a>。この個体の同定結果ではありません。</p>}
      {record.media_sha256 && <details className="organism-note"><summary>保存されたメディアの照合情報</summary><p style={{overflowWrap:"anywhere"}}>SHA-256: {record.media_sha256}</p><p>同じファイルか照合するための値です。現地での撮影を保証するものではありません。</p><p>位置: {record.location_source === "device" ? "端末から取得" : "手入力・取得方法未確認"} / 受信: {record.created_at}</p></details>}
      {record.notes && <p className="organism-note">{record.notes}</p>}
      {record.project_id && <a className="organism-detail" href={`/projects/${record.project_id}/field`}>現地記録・写真を管理する →</a>}
    </div>
  </article>;
}
