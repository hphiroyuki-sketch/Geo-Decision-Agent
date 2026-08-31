import Anthropic from "@anthropic-ai/sdk";

export function buildSystemPrompt(appName: string): string {
  return `あなたは「${appName}」の意思決定支援AIです。ForestScope社の理念に基づき、法人が発電所・工場・物流拠点・不動産・送電線等を新設・拡張・改修する際、生物多様性への影響が最小となる選択肢を提示することが使命です。

# 行動原則
- 日本語で、専門用語なしでも理解できる説明を先に、詳細はその後に述べる（結論→理由→次の行動の順）。
- 対象地・期間・目的・制約が曖昧な場合は、分析を実行する前に確認質問をする。
- 断定を避け、信頼度（高・中・低）、データ不足、反証可能性、必要な現地確認を必ず添える。
- ミティゲーション・ヒエラルキー（回避→低減→回復→オフセット）の順で提案し、「回避」を常に最初の選択肢として提示する。
- 複数の候補地・配置案を比較する依頼を受けたら、必ず analyze_site_candidates ツールを呼び出して構造化された分析結果を取得すること。数値を自分で創作してはならない。
- 現時点の衛星データ連携はシミュレーション値であり、本番運用では Google Earth Engine 等の実データに置き換える設計であることを、数値を示す際に一度触れる。
- 法令・安全・大型投資・法定アセスメントの要否についての最終判断は行わず、専門家レビューまたは現地確認を必須事項として明記する。
- ツールを使う場合は一言添えてから呼び出してよい。ユーザーの依頼にツールで応えられない場合は、推測せずにその旨を伝える。内部処理用のXMLタグ等を応答に含めない。`;
}

export const ANALYZE_TOOL: Anthropic.Tool = {
  name: "analyze_site_candidates",
  description:
    "候補地（複数可）について、生息地重複度・保護区域近接・連結性影響・NDRE変化・AlphaEarth類似度・アクセス性を算出し、スコア順位、信頼度、回避/低減/回復/オフセットの推奨措置を返す。立地・設備の比較や生物多様性影響評価を求められたら必ずこれを呼び出す。",
  input_schema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        description: "比較する候補地のリスト（1件以上）",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "候補地の名称（例: 候補地A）" },
            lat: { type: "number", description: "緯度（分かる場合）" },
            lng: { type: "number", description: "経度（分かる場合）" },
            notes: { type: "string", description: "ユーザーが与えた補足情報" },
          },
          required: ["name"],
        },
      },
      purpose: { type: "string", description: "事業目的（例: 発電所の新設）" },
    },
    required: ["candidates"],
  },
};

export function makeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}
