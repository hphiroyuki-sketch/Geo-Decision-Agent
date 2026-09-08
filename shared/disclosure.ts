export type Framework = 'tnfd' | 'site';
export interface DisclosureSection { code: string; group: string; title: string; guidance: string; }
export const FRAMEWORKS = {
  tnfd: { title: 'TNFD 開示準備', source: 'https://tnfd.global/recommendations/', note: '4本柱・14推奨開示と一般要件の準備用メモ。企業の重要性判断・確認を経て開示文書へ反映します。' },
  site: { title: '自然共生サイト', source: 'https://www.erca.go.jp/nature/nintei.html', note: '現行の申請・認定後の活動整理用。公式様式への転記・添付とERCAへの提出が別途必要です。' },
} as const;
export const SECTIONS: Record<Framework, DisclosureSection[]> = {
  tnfd: [
    { code:'scope', group:'一般要件', title:'報告の範囲と前提', guidance:'対象企業・年度・拠点・バリューチェーン、重要性の考え方、時間軸、他の報告との統合、関係者との対話、評価対象外と理由を記入。' },
    { code:'G-A', group:'ガバナンス', title:'取締役会の監督', guidance:'自然関連の依存・影響・リスク・機会に対する監督体制、審議内容と頻度。議事録や規程の参照先。' },
    { code:'G-B', group:'ガバナンス', title:'経営者の役割', guidance:'評価・管理の責任者、担当部署、報告経路、意思決定の方法。' },
    { code:'G-C', group:'ガバナンス', title:'人権と関係者との対話', guidance:'先住民族・地域社会・影響を受ける関係者等への方針、対話、取締役会と経営者の監督。' },
    { code:'S-A', group:'戦略', title:'依存・影響・リスク・機会', guidance:'自社事業と自然との接点を、短期・中期・長期の時間軸で整理。衛星で分かる事実と仮説を分離。' },
    { code:'S-B', group:'戦略', title:'事業・財務計画と移行計画', guidance:'ビジネスモデル、バリューチェーン、戦略、財務計画への影響と対応。費用・便益には出典と前提を付す。' },
    { code:'S-C', group:'戦略', title:'シナリオとレジリエンス', guidance:'複数シナリオ、仮定、期間、戦略の耐性と対応策。未実施なら必要な検討を記入。' },
    { code:'S-D', group:'戦略', title:'優先地域と拠点', guidance:'直接操業と可能な範囲の上流・下流の優先地域、判断根拠と対象区域。10mメッシュのみで優先地域を確定しない。' },
    { code:'R-Ai', group:'リスクと影響の管理', title:'直接操業の評価プロセス', guidance:'依存・影響・リスク・機会を特定・評価・優先順位付けする手順、使用情報、限界。' },
    { code:'R-Aii', group:'リスクと影響の管理', title:'上流・下流の評価プロセス', guidance:'調達先・顧客等の評価範囲、所在地の把握度、代替情報と不足データ。' },
    { code:'R-B', group:'リスクと影響の管理', title:'モニタリング', guidance:'継続確認する指標、調査方法、地点、頻度、責任者、結果による見直し方法。' },
    { code:'R-C', group:'リスクと影響の管理', title:'全社リスク管理との統合', guidance:'既存のリスク管理・稟議・事業計画への反映と報告方法。' },
    { code:'M-A', group:'指標と目標', title:'リスク・機会の測定指標', guidance:'重要なリスク・機会の指標、単位、対象範囲、測定方法、値、財務的な含意。' },
    { code:'M-B', group:'指標と目標', title:'依存・影響の測定指標', guidance:'自然への依存・影響を測る指標と基準年・実績。欠測と推計、衛星指標と生物指標を分ける。' },
    { code:'M-C', group:'指標と目標', title:'目標と実績', guidance:'達成期限、基準年、目標値、実績、評価方法、未達時の対応と活動予算。' },
  ],
  site: [
    { code:'area', group:'申請の準備', title:'区域・権利・同意', guidance:'区域の名称、面積、境界図・GIS、所有者・管理者、必要な同意と確認資料。メッシュ解析範囲は申請区域の代わりになりません。' },
    { code:'value', group:'申請の準備', title:'生物多様性の価値と現状', guidance:'対象生態系と価値、現地調査、種・生息環境の証拠。希少性は国・自治体・評価年を明記。' },
    { code:'goal', group:'活動計画', title:'維持・回復・創出の目標', guidance:'対象区域、目標、指標、基準値、目標値、計画期間、設定根拠を記載。' },
    { code:'action', group:'活動計画', title:'活動・体制・資金', guidance:'活動内容、実施場所、時期、担当、協力者、必要費用と資金、人員を整理。回復計画のIDも参照可能。' },
    { code:'monitor', group:'活動計画', title:'モニタリング設計', guidance:'調査対象・地点・方法・時期・頻度・実施体制・指標。変化や未達を検出した場合の見直し方法。' },
    { code:'evidence', group:'活動の継続', title:'活動実績と効果の証拠', guidance:'実施日、活動内容、写真・動画・観察記録、指標の変化、比較条件、専門家確認を記録。' },
    { code:'annual', group:'活動の継続', title:'定期報告と次回確認', guidance:'認定後の活動・モニタリング情報の入力状況、最終報告日と次回予定。ERCAは少なくとも年1回の入力を案内しています。' },
    { code:'change', group:'活動の継続', title:'期間延長・変更の確認', guidance:'認定番号、計画期間、変更点、延長の要否、実施状況報告書。変更認定・軽微変更等の該当性はERCAへ確認。' },
  ],
};
export interface DisclosureEntry { code: string; content: string; evidence: string; owner: string; due: string; status: 'draft' | 'ready'; version: number; updated_at?: string; updated_by_name?: string; }
export interface EvidenceInventory { observed: number; confirmed: number; media: number; demo: number; pins: number; meshes: number; actions: number; }
