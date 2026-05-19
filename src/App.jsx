import { useState } from "react";

// API Key 从环境变量读取（部署时在 Vercel 配置）
const API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";

// ─── API ──────────────────────────────────────────────────────
async function callClaude(messages) {
  if (!API_KEY) {
    throw new Error("未配置 API Key，请在 Vercel 环境变量中添加 VITE_ANTHROPIC_API_KEY");
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return (data.content || []).map((c) => c.text || "").join("");
}

function buildPrompt(criteria, resumeText) {
  const lines = [
    "你是专业 HR 招聘顾问，请仔细阅读候选人简历，结合招聘要求进行综合评估。",
    "", "## 招聘筛选条件",
  ];
  if (criteria.education !== "不限") lines.push(`- 学历要求：${criteria.education}`);
  if (criteria.gender !== "不限") lines.push(`- 性别要求：${criteria.gender}`);
  if (criteria.major) lines.push(`- 专业方向：${criteria.major}`);
  if (criteria.companyBackground) lines.push(`- 公司背景：${criteria.companyBackground}`);
  if (criteria.ageMin || criteria.ageMax)
    lines.push(`- 年龄范围：${criteria.ageMin || "不限"} ~ ${criteria.ageMax || "不限"} 岁`);
  if (criteria.talentProfile) lines.push(`\n## 人才画像 / 岗位需求\n${criteria.talentProfile}`);
  if (criteria.customRequirements) lines.push(`\n## 其他要求\n${criteria.customRequirements}`);
  if (resumeText) lines.push(`\n## 简历内容\n${resumeText}`);
  lines.push(`\n## 输出格式\n只返回如下 JSON，不要其他内容：\n{"name":"姓名或未知","match":true或false,"score":0到100整数,"education":"学历","age":"年龄或未知","gender":"性别或未知","currentCompany":"最近公司","highlights":["亮点1","亮点2","亮点3"],"gaps":["不足1","不足2"],"summary":"30字内综合评价"}`);
  return lines.join("\n");
}

async function screenResume(entry, criteria) {
  let messages;
  if (entry.pdfB64) {
    messages = [{ role: "user", content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: entry.pdfB64 } },
      { type: "text", text: buildPrompt(criteria, "") },
    ]}];
  } else {
    messages = [{ role: "user", content: buildPrompt(criteria, entry.text) }];
  }
  const raw = await callClaude(messages);
  return JSON.parse(raw.replace(/```json|```/gi, "").trim());
}

// ─── 常量 ─────────────────────────────────────────────────────
const EDU_OPTS = ["不限","大专及以上","本科及以上","硕士及以上","博士及以上"];
const GENDER_OPTS = ["不限","男","女"];
const INIT = { education:"不限", gender:"不限", major:"", companyBackground:"", ageMin:"", ageMax:"", talentProfile:"", customRequirements:"" };
const STEPS = ["录入简历","设置条件","开始筛选","查看结果"];

const inp = { padding:"8px 10px", borderRadius:8, border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-primary)", color:"var(--color-text-primary)", fontSize:13, width:"100%", fontFamily:"inherit" };

function PBtn({ label, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ padding:"9px 22px", borderRadius:8, fontSize:13, cursor:disabled?"not-allowed":"pointer", fontWeight:500, border:"none", background:disabled?"var(--color-background-secondary)":"#185FA5", color:disabled?"var(--color-text-tertiary)":"#fff" }}>{label}</button>;
}
function GBtn({ label, onClick, disabled }) {
  return <button onClick={onClick} disabled={disabled} style={{ padding:"9px 18px", borderRadius:8, fontSize:13, cursor:disabled?"not-allowed":"pointer", border:"0.5px solid var(--color-border-secondary)", background:"none", color:"var(--color-text-secondary)" }}>{label}</button>;
}

function StepBar({ current }) {
  return (
    <div style={{ display:"flex", alignItems:"center", marginBottom:"1.75rem" }}>
      {STEPS.map((s,i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", flex: i<STEPS.length-1?1:0 }}>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
            <div style={{ width:30, height:30, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:500, background: i<current?"#E6F1FB":i===current?"#185FA5":"var(--color-background-secondary)", color: i<current?"#185FA5":i===current?"#fff":"var(--color-text-tertiary)", border: i===current?"2px solid #185FA5":"0.5px solid var(--color-border-secondary)" }}>
              {i<current?"✓":i+1}
            </div>
            <span style={{ fontSize:11, color: i===current?"var(--color-text-primary)":"var(--color-text-tertiary)", whiteSpace:"nowrap", fontWeight: i===current?500:400 }}>{s}</span>
          </div>
          {i<STEPS.length-1 && <div style={{ flex:1, height:1, background: i<current?"#378ADD":"var(--color-border-tertiary)", margin:"0 6px", marginBottom:20 }} />}
        </div>
      ))}
    </div>
  );
}

function ResumeEntry({ entries, setEntries }) {
  const [tab, setTab] = useState("paste");
  const [text, setText] = useState("");
  const [name, setName] = useState("");

  const addPaste = () => {
    if (!text.trim()) return;
    setEntries(p => [...p, { id: Date.now(), label: name.trim() || `简历 ${p.length+1}`, text: text.trim(), pdfB64: null }]);
    setText(""); setName("");
  };

  const addPDF = async (e) => {
    for (const f of Array.from(e.target.files)) {
      const b64 = await new Promise((res,rej) => { const r=new FileReader(); r.onload=ev=>res(ev.target.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(f); });
      setEntries(p => [...p, { id: Date.now()+Math.random(), label: f.name, text: null, pdfB64: b64 }]);
    }
    e.target.value = "";
  };

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{ padding:"7px 18px", borderRadius:8, fontSize:13, cursor:"pointer", border: tab===id?"0.5px solid #378ADD":"0.5px solid var(--color-border-secondary)", background: tab===id?"#E6F1FB":"none", color: tab===id?"#185FA5":"var(--color-text-secondary)", fontWeight: tab===id?500:400 }}>{label}</button>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
      <div style={{ background:"#E6F1FB", border:"0.5px solid #B5D4F4", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#0C447C", lineHeight:1.6 }}>
        <strong>推荐方式：</strong>将简历内容<strong>复制粘贴</strong>到下方，或直接上传 <strong>PDF</strong>。每份单独添加。
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <TabBtn id="paste" label="📋 粘贴文字" />
        <TabBtn id="pdf" label="📄 上传 PDF" />
      </div>
      {tab==="paste" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <input placeholder="候选人姓名（选填）" value={name} onChange={e=>setName(e.target.value)} style={inp} />
          <textarea rows={8} placeholder="将简历全文粘贴到这里…" value={text} onChange={e=>setText(e.target.value)} style={{ ...inp, resize:"vertical", lineHeight:1.7 }} />
          <div style={{ display:"flex", justifyContent:"flex-end" }}>
            <PBtn label="➕ 添加这份简历" onClick={addPaste} disabled={!text.trim()} />
          </div>
        </div>
      )}
      {tab==="pdf" && (
        <label style={{ display:"block", border:"1.5px dashed var(--color-border-secondary)", borderRadius:12, padding:"2rem", textAlign:"center", cursor:"pointer", background:"var(--color-background-secondary)" }}>
          <div style={{ fontSize:32, marginBottom:8 }}>📄</div>
          <p style={{ margin:0, fontWeight:500, fontSize:14 }}>点击选择 PDF 文件</p>
          <p style={{ margin:"4px 0 0", fontSize:12, color:"var(--color-text-secondary)" }}>支持批量选择</p>
          <input type="file" accept=".pdf" multiple onChange={addPDF} style={{ display:"none" }} />
        </label>
      )}
      {entries.length>0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <p style={{ margin:0, fontSize:12, fontWeight:500, color:"var(--color-text-secondary)" }}>已添加 {entries.length} 份：</p>
          {entries.map((e,i) => (
            <div key={e.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:8 }}>
              <span>{e.pdfB64?"📄":"📋"}</span>
              <span style={{ flex:1, fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.label}</span>
              {e.text && <span style={{ fontSize:11, color:"var(--color-text-tertiary)" }}>{e.text.length} 字</span>}
              <button onClick={() => setEntries(p=>p.filter((_,j)=>j!==i))} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--color-text-tertiary)", fontSize:16 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CriteriaForm({ c, set }) {
  const Field = ({ label, children }) => (
    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
      <label style={{ fontSize:12, fontWeight:500, color:"var(--color-text-secondary)" }}>{label}</label>
      {children}
    </div>
  );
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1.1rem" }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.85rem" }}>
        <Field label="学历要求"><select value={c.education} onChange={e=>set("education",e.target.value)} style={inp}>{EDU_OPTS.map(o=><option key={o}>{o}</option>)}</select></Field>
        <Field label="性别要求"><select value={c.gender} onChange={e=>set("gender",e.target.value)} style={inp}>{GENDER_OPTS.map(o=><option key={o}>{o}</option>)}</select></Field>
        <Field label="专业方向"><input placeholder="如：计算机、金融…" value={c.major} onChange={e=>set("major",e.target.value)} style={inp} /></Field>
        <Field label="公司背景"><input placeholder="如：互联网大厂、500强…" value={c.companyBackground} onChange={e=>set("companyBackground",e.target.value)} style={inp} /></Field>
        <Field label="最小年龄"><input type="number" placeholder="22" value={c.ageMin} onChange={e=>set("ageMin",e.target.value)} style={inp} /></Field>
        <Field label="最大年龄"><input type="number" placeholder="35" value={c.ageMax} onChange={e=>set("ageMax",e.target.value)} style={inp} /></Field>
      </div>
      <Field label="人才画像 / 岗位 JD"><textarea rows={4} placeholder="描述理想候选人，或粘贴岗位描述…" value={c.talentProfile} onChange={e=>set("talentProfile",e.target.value)} style={{ ...inp, resize:"vertical", lineHeight:1.6 }} /></Field>
      <Field label="其他要求（可选）"><textarea rows={2} placeholder="如：CPA证书；英语六级…" value={c.customRequirements} onChange={e=>set("customRequirements",e.target.value)} style={{ ...inp, resize:"vertical", lineHeight:1.6 }} /></Field>
    </div>
  );
}

function ResultCard({ r }) {
  const [open, setOpen] = useState(false);
  const score = Math.round(r.score||0);
  const sc = score>=70?"var(--color-text-success)":score>=50?"var(--color-text-warning)":"var(--color-text-danger)";
  return (
    <div style={{ background:"var(--color-background-primary)", border:`0.5px solid ${r.match?"var(--color-border-success)":"var(--color-border-tertiary)"}`, borderRadius:12, overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px", cursor:"pointer" }} onClick={()=>setOpen(v=>!v)}>
        <div style={{ width:36, height:36, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:600, background: r.match?"#EAF3DE":"var(--color-background-secondary)", color: r.match?"#3B6D11":"var(--color-text-tertiary)" }}>
          {r.name&&r.name!=="未知"?r.name.slice(0,1):"?"}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <span style={{ fontWeight:500, fontSize:14 }}>{r.name||"未知"}</span>
            <span style={{ fontSize:11, padding:"2px 8px", borderRadius:99, fontWeight:500, background: r.match?"#EAF3DE":"var(--color-background-secondary)", color: r.match?"#3B6D11":"var(--color-text-secondary)" }}>{r.match?"✓ 符合":"✗ 不符合"}</span>
          </div>
          <p style={{ margin:"2px 0 0", fontSize:11, color:"var(--color-text-tertiary)" }}>
            {[r.label, r.education, r.age!=="未知"?r.age+"岁":null, r.currentCompany].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:22, fontWeight:500, color:sc }}>{score}</div>
          <div style={{ fontSize:10, color:"var(--color-text-tertiary)" }}>匹配分</div>
        </div>
        <span style={{ color:"var(--color-text-tertiary)" }}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div style={{ borderTop:"0.5px solid var(--color-border-tertiary)", padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
          <p style={{ margin:0, fontSize:13, color:"var(--color-text-secondary)", fontStyle:"italic" }}>"{r.summary}"</p>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            {r.highlights?.length>0 && <div><p style={{ margin:"0 0 6px", fontSize:11, fontWeight:500, color:"var(--color-text-success)" }}>✦ 亮点</p>{r.highlights.map((h,i)=><p key={i} style={{ margin:"0 0 4px", fontSize:12, color:"var(--color-text-secondary)" }}>· {h}</p>)}</div>}
            {r.gaps?.length>0 && <div><p style={{ margin:"0 0 6px", fontSize:11, fontWeight:500, color:"var(--color-text-danger)" }}>✦ 不足</p>{r.gaps.map((g,i)=><p key={i} style={{ margin:"0 0 4px", fontSize:12, color:"var(--color-text-secondary)" }}>· {g}</p>)}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState(0);
  const [entries, setEntries] = useState([]);
  const [criteria, setCriteria] = useState(INIT);
  const [results, setResults] = useState([]);
  const [errors, setErrors] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ done:0, total:0, current:"" });
  const [filter, setFilter] = useState("all");

  const setC = (k,v) => setCriteria(p=>({...p,[k]:v}));

  const start = async () => {
    setProcessing(true); setResults([]); setErrors([]);
    setProgress({ done:0, total:entries.length, current:"" });
    const res=[], errs=[];
    for (let i=0; i<entries.length; i++) {
      setProgress({ done:i, total:entries.length, current:entries[i].label });
      try { res.push({ ...await screenResume(entries[i], criteria), label:entries[i].label }); }
      catch(e) { errs.push({ label:entries[i].label, msg:e.message }); }
    }
    setResults(res); setErrors(errs); setProcessing(false); setStep(3);
  };

  const matched = results.filter(r=>r.match);
  const unmatched = results.filter(r=>!r.match);
  const displayed = (filter==="matched"?matched:filter==="unmatched"?unmatched:results).slice().sort((a,b)=>(b.score||0)-(a.score||0));
  const avg = results.length?Math.round(results.reduce((s,r)=>s+(r.score||0),0)/results.length):0;
  const reset = () => { setStep(0); setEntries([]); setResults([]); setErrors([]); setCriteria(INIT); setFilter("all"); };

  return (
    <div style={{ maxWidth:700, margin:"0 auto", padding:"2rem 1.25rem" }}>
      <div style={{ marginBottom:"1.5rem" }}>
        <h1 style={{ margin:0, fontSize:22, fontWeight:600 }}>🔍 AI 简历筛选系统</h1>
        <p style={{ margin:"5px 0 0", fontSize:14, color:"var(--color-text-secondary)" }}>录入简历 → 设置条件 → 一键智能筛选</p>
      </div>
      <StepBar current={step} />

      {step===0 && (
        <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
          <ResumeEntry entries={entries} setEntries={setEntries} />
          <div style={{ display:"flex", justifyContent:"flex-end" }}>
            <PBtn label="下一步：设置条件 →" onClick={()=>setStep(1)} disabled={entries.length===0} />
          </div>
        </div>
      )}

      {step===1 && (
        <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
          <div style={{ background:"var(--color-background-secondary)", borderRadius:8, padding:"8px 12px", fontSize:12, color:"var(--color-text-secondary)" }}>ℹ️ 已录入 {entries.length} 份，留空表示不限</div>
          <CriteriaForm c={criteria} set={setC} />
          <div style={{ display:"flex", justifyContent:"space-between" }}>
            <GBtn label="← 返回" onClick={()=>setStep(0)} />
            <PBtn label="下一步：确认 →" onClick={()=>setStep(2)} />
          </div>
        </div>
      )}

      {step===2 && (
        <div style={{ display:"flex", flexDirection:"column", gap:"1.25rem" }}>
          <div style={{ background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", borderRadius:12, padding:"1.1rem" }}>
            <p style={{ margin:"0 0 0.85rem", fontWeight:500 }}>筛选任务确认</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem", fontSize:12 }}>
              {[["简历数量",`${entries.length}份`],["学历",criteria.education],["性别",criteria.gender],["专业",criteria.major||"不限"],["年龄",(criteria.ageMin||criteria.ageMax)?`${criteria.ageMin||"不限"}~${criteria.ageMax||"不限"}岁`:"不限"],["公司背景",criteria.companyBackground||"不限"]].map(([k,v])=>(
                <div key={k} style={{ display:"flex", gap:6 }}>
                  <span style={{ color:"var(--color-text-tertiary)" }}>{k}：</span>
                  <span style={{ fontWeight:500 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          {processing && (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"var(--color-text-secondary)" }}>
                <span>分析中：{progress.current}</span><span>{progress.done}/{progress.total}</span>
              </div>
              <div style={{ height:5, background:"var(--color-background-secondary)", borderRadius:99, overflow:"hidden" }}>
                <div style={{ height:"100%", background:"#378ADD", width:`${progress.total?(progress.done/progress.total*100):0}%`, transition:"width 0.4s" }} />
              </div>
            </div>
          )}
          <div style={{ display:"flex", justifyContent:"space-between" }}>
            <GBtn label="← 返回" onClick={()=>setStep(1)} disabled={processing} />
            <button disabled={processing} onClick={start} style={{ padding:"9px 24px", borderRadius:8, fontSize:13, cursor:processing?"not-allowed":"pointer", fontWeight:500, border:"none", background:processing?"var(--color-background-secondary)":"#185FA5", color:processing?"var(--color-text-tertiary)":"#fff" }}>
              {processing?"⏳ 筛选中…":"✨ 开始 AI 筛选"}
            </button>
          </div>
        </div>
      )}

      {step===3 && (
        <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8 }}>
            {[["总计",results.length,"var(--color-text-primary)"],["符合",matched.length,"var(--color-text-success)"],["不符合",unmatched.length,"var(--color-text-danger)"],["平均分",avg,"#185FA5"]].map(([l,v,c])=>(
              <div key={l} style={{ background:"var(--color-background-secondary)", borderRadius:8, padding:"0.65rem", textAlign:"center" }}>
                <div style={{ fontSize:22, fontWeight:500, color:c }}>{v}</div>
                <div style={{ fontSize:11, color:"var(--color-text-tertiary)", marginTop:2 }}>{l}</div>
              </div>
            ))}
          </div>
          {errors.length>0 && (
            <div style={{ background:"var(--color-background-danger)", border:"0.5px solid var(--color-border-danger)", borderRadius:8, padding:"12px 14px" }}>
              <p style={{ margin:"0 0 8px", fontSize:12, fontWeight:500, color:"var(--color-text-danger)" }}>⚠️ {errors.length} 份处理失败</p>
              {errors.map((e,i)=><div key={i} style={{ fontSize:12, color:"var(--color-text-danger)", marginBottom:4 }}><strong>{e.label}</strong>：{e.msg}</div>)}
            </div>
          )}
          <div style={{ display:"flex", gap:7 }}>
            {[["all","全部",results.length],["matched","符合",matched.length],["unmatched","不符合",unmatched.length]].map(([v,l,n])=>(
              <button key={v} onClick={()=>setFilter(v)} style={{ padding:"5px 13px", borderRadius:8, fontSize:12, cursor:"pointer", border: filter===v?"0.5px solid #378ADD":"0.5px solid var(--color-border-secondary)", background: filter===v?"#E6F1FB":"var(--color-background-primary)", color: filter===v?"#185FA5":"var(--color-text-secondary)", fontWeight: filter===v?500:400 }}>{l} {n}</button>
            ))}
            <div style={{ flex:1 }} />
            <button onClick={reset} style={{ padding:"5px 12px", borderRadius:8, fontSize:12, cursor:"pointer", border:"0.5px solid var(--color-border-secondary)", background:"none", color:"var(--color-text-secondary)" }}>↺ 重新筛选</button>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {displayed.map((r,i)=><ResultCard key={i} r={r} />)}
          </div>
        </div>
      )}
    </div>
  );
}
