// ADDED (multilingual round, 2026-07-14): can the fast-path tiers serve NON-CN/EN
// users (Malay / Indonesian / French / Portuguese) — and is gpt-5.4-nano/mini worth
// switching to? Three sections, three answers:
//
//   A. GATE AUDIT (zero API cost) — where do multilingual messages route through the
//      PRODUCTION fastPathGate + looksLikeSimpleLog? Documents the "tukar jadi 15"
//      misroute (Malay amend-with-number → mini → wrong CREATE card) before the
//      regex fix, and verifies the fix after.
//   B. MINI EXTRACTION (OpenAI) — the PRODUCTION miniExtractPrompt + MINI_TOOL_PARAMS
//      run against gpt-4o-mini vs gpt-5.4-nano vs gpt-5.4-mini on 14 multilingual
//      log cases with computed ground-truth dates. Verified pricing (2026-07-14,
//      developers.openai.com): 4o-mini $0.15/$0.60 · 5.4-nano $0.20/$1.25 ·
//      5.4-mini $0.75/$4.50 per MTok — nano is NOT cheaper than 4o-mini, so it only
//      wins if it's more ACCURATE.
//   C. HAIKU CLASSIFIER (Anthropic) — the PRODUCTION ROUTE_TOOL on multilingual
//      amend/delete/total phrasing with a last-expense context: if we open the gate
//      for Malay/Indonesian edit words, does Haiku classify them correctly?
//
//   npx tsx scripts/multilingual-sweep.ts
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

// ── pricing (USD per MTok, verified 2026-07-14) ──────────────
const PRICE: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-5.4-nano": { in: 0.2, out: 1.25 },
  "gpt-5.4-mini": { in: 0.75, out: 4.5 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
};

// ── timezone-safe ground truth (same fmt the runtime uses) ───
const fmt = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const daysAgo = (today: Date, n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return fmt(d);
};
const lastWeekdayDate = (now: Date, weekday: number) => {
  const d = new Date(now);
  const diff = ((d.getDay() + 7 - weekday) % 7) || 7;
  d.setDate(d.getDate() - diff);
  return fmt(d);
};

// ── section B cases ──────────────────────────────────────────
interface WantItem {
  amount: number;
  currency: string;
  cats: string[]; // acceptable categories
  /** "today" (date null) | "yesterday" | "3ago" | {weekday:n} */
  date: "today" | "yesterday" | "3ago" | { weekday: number };
  noteHas?: string[]; // note must contain ANY of these (case-insensitive), if set
  tagsHas?: string[]; // tags joined must contain ANY of these, if set
}
interface ExtractCase {
  lang: string;
  msg: string;
  items: WantItem[];
}

const EXTRACT_CASES: ExtractCase[] = [
  // ── Malay (SG/MY target market — deep coverage) ──
  { lang: "MS", msg: "makan tengah hari 12", items: [{ amount: 12, currency: "SGD", cats: ["food"], date: "today" }] },
  { lang: "MS", msg: "beli kopi 5 ringgit semalam", items: [{ amount: 5, currency: "MYR", cats: ["food"], date: "yesterday", noteHas: ["kopi"] }] },
  { lang: "MS", msg: "grab ke pejabat 15", items: [{ amount: 15, currency: "SGD", cats: ["trans"], date: "today", noteHas: ["grab"] }] },
  { lang: "MS", msg: "jumaat lepas beli buku 30", items: [{ amount: 30, currency: "SGD", cats: ["shop", "ent"], date: { weekday: 5 }, noteHas: ["buku"] }] },
  {
    lang: "MS",
    msg: "kopi 5, nasi lemak 8",
    items: [
      { amount: 5, currency: "SGD", cats: ["food"], date: "today", noteHas: ["kopi"] },
      { amount: 8, currency: "SGD", cats: ["food"], date: "today", noteHas: ["nasi lemak"] },
    ],
  },
  { lang: "MS", msg: "makan malam 20, tag makan luar", items: [{ amount: 20, currency: "SGD", cats: ["food"], date: "today", tagsHas: ["makan luar"] }] },
  { lang: "MS", msg: "isnin lepas taxi 18", items: [{ amount: 18, currency: "SGD", cats: ["trans"], date: { weekday: 1 }, noteHas: ["taxi"] }] },
  // ── Indonesian ──
  { lang: "ID", msg: "makan siang 12", items: [{ amount: 12, currency: "SGD", cats: ["food"], date: "today" }] },
  { lang: "ID", msg: "kemarin beli pulsa 20", items: [{ amount: 20, currency: "SGD", cats: ["bills", "other"], date: "yesterday", noteHas: ["pulsa"] }] },
  { lang: "ID", msg: "bensin 40 tiga hari lalu", items: [{ amount: 40, currency: "SGD", cats: ["trans"], date: "3ago", noteHas: ["bensin"] }] },
  // ── French ──
  { lang: "FR", msg: "déjeuner 15 hier", items: [{ amount: 15, currency: "SGD", cats: ["food"], date: "yesterday" }] },
  { lang: "FR", msg: "j'ai payé le taxi 20", items: [{ amount: 20, currency: "SGD", cats: ["trans"], date: "today", noteHas: ["taxi"] }] },
  // ── Portuguese ──
  { lang: "PT", msg: "almoço 18 ontem", items: [{ amount: 18, currency: "SGD", cats: ["food"], date: "yesterday" }] },
  {
    lang: "PT",
    msg: "café 4 e táxi 12",
    items: [
      { amount: 4, currency: "SGD", cats: ["food"], date: "today", noteHas: ["café", "cafe"] },
      { amount: 12, currency: "SGD", cats: ["trans"], date: "today", noteHas: ["táxi", "taxi"] },
    ],
  },
  // ── world languages (user goal: ANY language must log correctly) ──
  { lang: "ES", msg: "ayer almorcé 15", items: [{ amount: 15, currency: "SGD", cats: ["food"], date: "yesterday" }] },
  { lang: "DE", msg: "gestern Mittagessen 12", items: [{ amount: 12, currency: "SGD", cats: ["food"], date: "yesterday" }] },
  { lang: "JA", msg: "昨日ラーメンに12使った", items: [{ amount: 12, currency: "SGD", cats: ["food"], date: "yesterday", noteHas: ["ラーメン"] }] },
  { lang: "KO", msg: "어제 점심 15", items: [{ amount: 15, currency: "SGD", cats: ["food"], date: "yesterday" }] },
  { lang: "TH", msg: "เมื่อวานก๋วยเตี๋ยว 50", items: [{ amount: 50, currency: "SGD", cats: ["food"], date: "yesterday" }] },
  { lang: "VI", msg: "hôm qua ăn phở 12", items: [{ amount: 12, currency: "SGD", cats: ["food"], date: "yesterday", noteHas: ["phở", "pho"] }] },
  { lang: "TA", msg: "நேற்று மதிய உணவு 10", items: [{ amount: 10, currency: "SGD", cats: ["food"], date: "yesterday" }] },
  { lang: "HI", msg: "आज दोपहर के खाने पर 12 खर्च किए", items: [{ amount: 12, currency: "SGD", cats: ["food"], date: "today" }] },
  { lang: "AR", msg: "غداء 15 أمس", items: [{ amount: 15, currency: "SGD", cats: ["food"], date: "yesterday" }] },
  { lang: "RU", msg: "вчера обед 12", items: [{ amount: 12, currency: "SGD", cats: ["food"], date: "yesterday" }] },
  // ── CN/EN controls (regression guard — these MUST stay perfect) ──
  { lang: "EN", msg: "lunch 12 yesterday", items: [{ amount: 12, currency: "SGD", cats: ["food"], date: "yesterday" }] },
  { lang: "CN", msg: "昨天午餐12块", items: [{ amount: 12, currency: "SGD", cats: ["food"], date: "yesterday" }] },
];

// nano DROPPED after round 1 of this sweep: pricier than 4o-mini AND failed the
// English control case ("lunch 12 yesterday" → no item). Not worth further calls.
const OPENAI_MODELS = ["gpt-4o-mini", "gpt-5.4-mini"];

// ── section A: gate audit cases ──────────────────────────────
// want = the routing we WANT after the multilingual regex fix.
//   mini      — simple log, mini tier
//   classifier— fastPathGate passes but looksLikeSimpleLog blocks (amend/question)
//   agent     — fastPathGate rejects outright (full agent)
interface GateCase {
  lang: string;
  msg: string;
  hasLast: boolean;
  want: "mini" | "classifier" | "agent";
  why: string;
}
const GATE_CASES: GateCase[] = [
  { lang: "MS", msg: "tukar jadi 15", hasLast: true, want: "classifier", why: "Malay amend-with-number — MUST NOT reach mini (wrong CREATE card)" },
  { lang: "MS", msg: "padam yang tadi", hasLast: true, want: "classifier", why: "Malay delete of last expense" },
  { lang: "ID", msg: "ubah jadi 20", hasLast: true, want: "classifier", why: "Indonesian amend-with-number" },
  { lang: "ID", msg: "hapus yang tadi", hasLast: true, want: "classifier", why: "Indonesian delete" },
  { lang: "MS", msg: "salah, 25 sebenarnya", hasLast: true, want: "classifier", why: "Malay 'wrong, actually 25'" },
  { lang: "MS", msg: "berapa saya belanja bulan ini", hasLast: false, want: "agent", why: "Malay total question — no number, stays full-agent (perfect language) for now" },
  { lang: "FR", msg: "change à 15", hasLast: true, want: "classifier", why: "French amend — 'change' already matches EN regex" },
  { lang: "PT", msg: "muda para 25", hasLast: true, want: "classifier", why: "Portuguese amend-with-number" },
  { lang: "MS", msg: "makan tengah hari 12", hasLast: false, want: "mini", why: "clean Malay log must STAY on mini (no over-escalation)" },
  { lang: "ID", msg: "kemarin beli pulsa 20", hasLast: false, want: "mini", why: "clean Indonesian log stays on mini" },
  { lang: "MS", msg: "beli kopi tadi 5", hasLast: false, want: "classifier", why: "'tadi' referential — deliberately over-escalates (safe direction); Haiku logs it fine" },
  // ── world-language amends-with-number — every one of these reaching mini = wrong CREATE card ──
  { lang: "ES", msg: "cámbialo a 15", hasLast: true, want: "classifier", why: "Spanish amend" },
  { lang: "DE", msg: "ändere es auf 15", hasLast: true, want: "classifier", why: "German amend" },
  { lang: "JA", msg: "15に変更して", hasLast: true, want: "classifier", why: "Japanese amend" },
  { lang: "KO", msg: "15로 바꿔줘", hasLast: true, want: "classifier", why: "Korean amend" },
  { lang: "TH", msg: "เปลี่ยนเป็น 15", hasLast: true, want: "classifier", why: "Thai amend" },
  { lang: "VI", msg: "đổi thành 15", hasLast: true, want: "classifier", why: "Vietnamese amend" },
  { lang: "AR", msg: "غيّره إلى 15", hasLast: true, want: "classifier", why: "Arabic amend" },
  { lang: "RU", msg: "измени на 15", hasLast: true, want: "classifier", why: "Russian amend" },
  { lang: "TA", msg: "15 ஆக மாற்று", hasLast: true, want: "classifier", why: "Tamil amend (SG official language)" },
  { lang: "HI", msg: "इसे 15 कर दो", hasLast: true, want: "classifier", why: "Hindi amend" },
  { lang: "AR", msg: "غداء ١٥ أمس", hasLast: false, want: "mini", why: "Arabic-Indic digits ١٥ — documents the HAS_NUMBER_RE digit gap" },
  { lang: "EN", msg: "lunch 12 yesterday", hasLast: false, want: "mini", why: "EN control" },
  { lang: "CN", msg: "改成15块", hasLast: true, want: "classifier", why: "CN control — amend already blocked from mini" },
];

// ── section C: Haiku classifier cases ────────────────────────
interface RouteCase {
  lang: string;
  msg: string;
  wantIntent: string;
  check?: (input: Record<string, unknown>) => string | null;
}
const ROUTE_CASES: RouteCase[] = [
  {
    lang: "MS", msg: "tukar jadi 15", wantIntent: "amend_last",
    check: (i) => ((i.amend as { amount?: number } | undefined)?.amount === 15 ? null : "amend.amount ≠ 15"),
  },
  { lang: "MS", msg: "padam yang tadi", wantIntent: "delete_last" },
  {
    lang: "ID", msg: "ubah jadi 20", wantIntent: "amend_last",
    check: (i) => ((i.amend as { amount?: number } | undefined)?.amount === 20 ? null : "amend.amount ≠ 20"),
  },
  { lang: "ID", msg: "hapus pengeluaran tadi", wantIntent: "delete_last" },
  { lang: "FR", msg: "supprime la dernière dépense", wantIntent: "delete_last" },
  {
    lang: "PT", msg: "muda para 25", wantIntent: "amend_last",
    check: (i) => ((i.amend as { amount?: number } | undefined)?.amount === 25 ? null : "amend.amount ≠ 25"),
  },
  {
    lang: "MS", msg: "berapa jumlah belanja saya bulan ini", wantIntent: "total_query",
    check: (i) => ((i.total as { period?: string } | undefined)?.period === "this_month" ? null : "period ≠ this_month"),
  },
  { lang: "MS", msg: "beli ayam goreng 10", wantIntent: "log" },
  // ── world languages: can the FALLBACK tier (Haiku) handle what the gate sends it? ──
  {
    lang: "ES", msg: "cámbialo a 15", wantIntent: "amend_last",
    check: (i) => ((i.amend as { amount?: number } | undefined)?.amount === 15 ? null : "amend.amount ≠ 15"),
  },
  {
    lang: "JA", msg: "15に変更して", wantIntent: "amend_last",
    check: (i) => ((i.amend as { amount?: number } | undefined)?.amount === 15 ? null : "amend.amount ≠ 15"),
  },
  {
    lang: "TH", msg: "เปลี่ยนเป็น 15", wantIntent: "amend_last",
    check: (i) => ((i.amend as { amount?: number } | undefined)?.amount === 15 ? null : "amend.amount ≠ 15"),
  },
  { lang: "KO", msg: "방금 그거 삭제해줘", wantIntent: "delete_last" },
  { lang: "RU", msg: "удали последнюю запись", wantIntent: "delete_last" },
  { lang: "TA", msg: "15 ஆக மாற்று", wantIntent: "amend_last" },
  { lang: "JA", msg: "昨日ラーメンに12使った", wantIntent: "log" },
  { lang: "TH", msg: "เมื่อวานก๋วยเตี๋ยว 50", wantIntent: "log" },
];

// ── runners ──────────────────────────────────────────────────
async function main() {
  const now = new Date();
  const { fastPathGate, looksLikeSimpleLog, miniExtractPrompt, MINI_TOOL_PARAMS, ROUTE_TOOL, routeSystemPrompt } =
    await import("../src/lib/assistant/fast-path");

  // ═══ A. GATE AUDIT (no API) ═══
  console.log("═══ A. GATE AUDIT (production regexes, zero API) ═══");
  let gatePass = 0;
  for (const c of GATE_CASES) {
    const inGate = fastPathGate(c.msg);
    const route = !inGate ? "agent" : looksLikeSimpleLog(c.msg) ? "mini" : "classifier";
    const ok = route === c.want;
    if (ok) gatePass++;
    console.log(`${ok ? "✅" : "❌"} [${c.lang}] "${c.msg}" → ${route} (want ${c.want}) — ${c.why}`);
  }
  console.log(`GATE: ${gatePass}/${GATE_CASES.length}\n`);

  // ═══ B. MINI EXTRACTION — 3 OpenAI models ═══
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY missing in .env.local");
  const system = miniExtractPrompt(now);

  interface ModelStat { pass: number; total: number; perLang: Record<string, { p: number; t: number }>; cost: number; calls: number; fails: string[]; ms: number[]; replyLangBad: number }
  const stats: Record<string, ModelStat> = {};

  for (const model of OPENAI_MODELS) {
    const s: ModelStat = { pass: 0, total: 0, perLang: {}, cost: 0, calls: 0, fails: [], ms: [], replyLangBad: 0 };
    stats[model] = s;
    console.log(`═══ B. EXTRACTION — ${model} ═══`);
    for (const c of EXTRACT_CASES) {
      s.total++;
      s.perLang[c.lang] ??= { p: 0, t: 0 };
      s.perLang[c.lang].t++;
      let verdict = "";
      let reply: string | null = null;
      try {
        const t0 = Date.now();
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: c.msg },
            ],
            tools: [{ type: "function", function: { name: "log_expenses", description: "Extract every expense stated.", parameters: MINI_TOOL_PARAMS, strict: true } }],
            tool_choice: { type: "function", function: { name: "log_expenses" } },
          }),
        });
        if (!res.ok) {
          verdict = `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`;
        } else {
          const json = (await res.json()) as {
            choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          s.ms.push(Date.now() - t0);
          const p = PRICE[model];
          s.cost += ((json.usage?.prompt_tokens ?? 0) * p.in + (json.usage?.completion_tokens ?? 0) * p.out) / 1e6;
          s.calls++;
          const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
          const parsedArgs = (args ? JSON.parse(args) : {}) as { expenses?: Record<string, unknown>[]; reply?: unknown };
          verdict = grade(c, parsedArgs.expenses ?? [], now);
          if (verdict === "" && typeof parsedArgs.reply === "string") reply = parsedArgs.reply;
        }
      } catch (e) {
        verdict = `ERR ${e instanceof Error ? e.message : e}`;
      }
      const ok = verdict === "";
      if (ok) {
        s.pass++;
        s.perLang[c.lang].p++;
      } else {
        s.fails.push(`[${c.lang}] "${c.msg}" — ${verdict}`);
      }
      // ⚠ = raw model reply is CJK for a non-CJK message (or vice versa) — production's
      // deterministic guard would swap in the bilingual template for these.
      const cjk = (s2: string) => /[一-鿿]/.test(s2);
      const langBad = reply !== null && cjk(reply) !== cjk(c.msg);
      if (langBad) s.replyLangBad++;
      console.log(`${ok ? "✅" : "❌"} [${c.lang}] "${c.msg}"${ok ? "" : ` — ${verdict}`}${reply ? `\n   ${langBad ? "⚠" : "↳"} ${reply}` : ""}`);
    }
    console.log("");
  }

  // ═══ B2. MINI SELF-SCREEN (Layer 2) — non-log messages must yield an EMPTY array ═══
  // TR/IT/SW are deliberately NOT in the Layer-1 regexes — they test the model net alone.
  console.log("═══ B2. MINI SELF-SCREEN — gpt-5.4-mini, amends/questions → expenses:[] ═══");
  const SCREEN_CASES: { lang: string; msg: string }[] = [
    { lang: "MS", msg: "tukar jadi 15" },
    { lang: "JA", msg: "15に変更して" },
    { lang: "TH", msg: "เปลี่ยนเป็น 15" },
    { lang: "AR", msg: "غيّره إلى 15" },
    { lang: "TR", msg: "15 olarak değiştir" },
    { lang: "IT", msg: "correggi a 15" },
    { lang: "SW", msg: "badilisha kuwa 15" },
    { lang: "TR", msg: "dün öğle yemeği 12" }, // Turkish LOG — must NOT be screened out
  ];
  let screenPass = 0;
  for (const c of SCREEN_CASES) {
    const isLog = c.msg.includes("öğle"); // the one control log case
    let verdict = "";
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.4-mini",
          messages: [
            { role: "system", content: system },
            { role: "user", content: c.msg },
          ],
          tools: [{ type: "function", function: { name: "log_expenses", description: "Extract every expense stated.", parameters: MINI_TOOL_PARAMS, strict: true } }],
          tool_choice: { type: "function", function: { name: "log_expenses" } },
        }),
      });
      if (!res.ok) verdict = `HTTP ${res.status}`;
      else {
        const json = (await res.json()) as { choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[] };
        const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        const items = ((args ? JSON.parse(args) : {}) as { expenses?: unknown[] }).expenses ?? [];
        if (isLog) verdict = items.length === 1 ? "" : `${items.length} items (log control wants 1)`;
        else verdict = items.length === 0 ? "" : `${items.length} items extracted (want 0 → fall-through)`;
      }
    } catch (e) {
      verdict = `ERR ${e instanceof Error ? e.message : e}`;
    }
    const ok = verdict === "";
    if (ok) screenPass++;
    console.log(`${ok ? "✅" : "❌"} [${c.lang}] "${c.msg}"${ok ? (isLog ? " → 1 item (log kept)" : " → [] (falls through to Haiku)") : ` — ${verdict}`}`);
  }
  console.log(`SELF-SCREEN: ${screenPass}/${SCREEN_CASES.length}\n`);

  // ═══ C. HAIKU CLASSIFIER — multilingual amend/delete/total ═══
  console.log("═══ C. HAIKU CLASSIFIER (production ROUTE_TOOL) ═══");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const HAIKU = "claude-haiku-4-5-20251001";
  let routePass = 0;
  let haikuCost = 0;
  const haikuMs: number[] = [];
  for (const c of ROUTE_CASES) {
    let verdict = "";
    try {
      const t0 = Date.now();
      const response = await anthropic.messages.create({
        model: HAIKU,
        max_tokens: 500,
        thinking: { type: "disabled" },
        system: [
          { type: "text", text: routeSystemPrompt(now) },
          {
            type: "text",
            text: `LAST-LOGGED expense in this chat (for amend_last/delete_last matching): S$12.00 · food · nasi ayam · ${fmt(now)} (card status: confirmed).`,
          },
        ],
        tools: [ROUTE_TOOL],
        tool_choice: { type: "tool", name: "route" },
        messages: [{ role: "user", content: c.msg }],
      });
      haikuMs.push(Date.now() - t0);
      const p = PRICE[HAIKU];
      haikuCost += (response.usage.input_tokens * p.in + response.usage.output_tokens * p.out) / 1e6;
      const block = response.content.find((b) => b.type === "tool_use");
      const input = (block && "input" in block ? block.input : {}) as Record<string, unknown>;
      if (input.intent !== c.wantIntent) verdict = `intent=${input.intent} (want ${c.wantIntent})`;
      else if (c.check) verdict = c.check(input) ?? "";
    } catch (e) {
      verdict = `ERR ${e instanceof Error ? e.message : e}`;
    }
    const ok = verdict === "";
    if (ok) routePass++;
    console.log(`${ok ? "✅" : "❌"} [${c.lang}] "${c.msg}"${ok ? ` → ${c.wantIntent}` : ` — ${verdict}`}`);
  }

  // ═══ SUMMARY ═══
  console.log("\n═══ SUMMARY ═══");
  console.log(`Gate audit: ${gatePass}/${GATE_CASES.length}`);
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  for (const model of OPENAI_MODELS) {
    const s = stats[model];
    const langs = Object.entries(s.perLang).map(([l, v]) => `${l} ${v.p}/${v.t}`).join(" · ");
    console.log(
      `${model}: ${s.pass}/${s.total} (${langs}) — avg $${s.calls ? (s.cost / s.calls).toFixed(6) : "n/a"}/call · avg ${avg(s.ms)}ms (max ${s.ms.length ? Math.max(...s.ms) : 0}ms) · reply-lang ⚠ ${s.replyLangBad}`,
    );
    for (const f of s.fails) console.log(`   ✗ ${f}`);
  }
  console.log(
    `Haiku route: ${routePass}/${ROUTE_CASES.length} — avg $${(haikuCost / ROUTE_CASES.length).toFixed(6)}/call · avg ${avg(haikuMs)}ms (max ${haikuMs.length ? Math.max(...haikuMs) : 0}ms)`,
  );
}

/** Grade extracted items vs the case's ground truth. "" = pass, else reason. */
function grade(c: ExtractCase, items: Record<string, unknown>[], now: Date): string {
  if (items.length !== c.items.length) return `${items.length} items (want ${c.items.length})`;
  const remaining = [...items];
  for (const want of c.items) {
    const idx = remaining.findIndex((it) => it.amount === want.amount);
    if (idx < 0) return `no item with amount ${want.amount}`;
    const [it] = remaining.splice(idx, 1);
    const cur = typeof it.currency === "string" ? it.currency : "SGD";
    if (cur !== want.currency) return `amount ${want.amount}: currency ${cur} (want ${want.currency})`;
    if (typeof it.category !== "string" || !want.cats.includes(it.category))
      return `amount ${want.amount}: category ${it.category} (want ${want.cats.join("/")})`;
    // date grading
    const date = typeof it.date === "string" ? it.date : null;
    const wd = typeof it.lastWeekday === "number" ? it.lastWeekday : null;
    if (typeof want.date === "object") {
      const okViaField = wd === want.date.weekday && !date;
      const okSelfComputed = wd === null && date === lastWeekdayDate(now, want.date.weekday);
      if (!okViaField && !okSelfComputed)
        return `amount ${want.amount}: weekday ref → lastWeekday=${wd} date=${date} (want lastWeekday=${want.date.weekday})`;
      if (okSelfComputed) console.log(`   ⚠ self-computed weekday date (right today, but the risky path): "${c.msg}"`);
    } else {
      const expected = want.date === "today" ? null : want.date === "yesterday" ? daysAgo(now, 1) : daysAgo(now, 3);
      if ((date ?? null) !== expected) return `amount ${want.amount}: date ${date} (want ${expected ?? "null/today"})`;
      if (wd !== null) return `amount ${want.amount}: unexpected lastWeekday=${wd}`;
    }
    if (want.noteHas) {
      const note = typeof it.note === "string" ? it.note.toLowerCase() : "";
      if (!want.noteHas.some((n) => note.includes(n.toLowerCase())))
        return `amount ${want.amount}: note "${it.note}" lacks ${want.noteHas.join("|")}`;
    }
    if (want.tagsHas) {
      const tags = (Array.isArray(it.tags) ? it.tags : []).join(",").toLowerCase();
      if (!want.tagsHas.some((t) => tags.includes(t.toLowerCase())))
        return `amount ${want.amount}: tags [${Array.isArray(it.tags) ? it.tags.join(",") : ""}] lack ${want.tagsHas.join("|")}`;
    }
  }
  return "";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
