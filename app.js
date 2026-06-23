/* ===================================================================
   簿記3級 本試験シミュレーター — アプリ本体
=================================================================== */
'use strict';

const LS = {
  hist: 's3sim_history',     // [{examId,score,pass,date,sec}]
  best: 's3sim_best',        // {examId: score}
  wrong: 's3sim_wrong',      // [{examId,no} ...] 特訓で間違えた仕訳
};
const yen = n => '¥' + Number(n).toLocaleString('ja-JP');
const num = n => Number(n).toLocaleString('ja-JP');
const $ = id => document.getElementById(id);

function load(key, def){ try{ return JSON.parse(localStorage.getItem(key)) ?? def; }catch(e){ return def; } }
function save(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }

let state = null;       // 現在の受験状態
let timerId = null;
let renshu = null;      // 特訓状態

/* ===================== 画面遷移 ===================== */
function show(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  $('screen-'+name).classList.add('active');
  window.scrollTo(0,0);
}
function goHome(){
  stopTimer();
  closeCalc();
  renderHome();
  show('home');
}

/* ===================== ホーム ===================== */
function renderHome(){
  const hist = load(LS.hist, []);
  const best = load(LS.best, {});
  const passCount = hist.filter(h=>h.pass).length;
  const bestScore = hist.length ? Math.max(...hist.map(h=>h.score)) : null;
  $('hs-attempts').textContent = hist.length;
  $('hs-best').textContent = bestScore===null ? '―' : bestScore+'点';
  $('hs-pass').textContent = passCount;

  const wrong = load(LS.wrong, []);
  $('wrong-count-sub').textContent = wrong.length>0
    ? `現在 ${wrong.length}問が復習対象`
    : '特訓で間違えた問題がここに集まる';

  const list = $('exam-list');
  list.innerHTML = '';
  EXAMS.forEach(ex=>{
    const b = best[ex.id];
    const passed = b !== undefined && b >= 70;
    const card = document.createElement('button');
    card.className = 'exam-card ' + (ex.theme||'');
    card.onclick = ()=>startExam(ex.id);
    card.innerHTML = `
      <div class="ribbon"></div>
      <div class="exam-top">
        <div class="exam-ico">📋</div>
        <div>
          <div class="exam-name">${ex.title}</div>
          <div class="exam-sub">${ex.sub}</div>
        </div>
      </div>
      <div class="exam-meta">
        <span class="exam-pill">第1問 45点</span>
        <span class="exam-pill">第2問 20点</span>
        <span class="exam-pill">第3問 35点</span>
        ${b!==undefined ? `<span class="exam-pill ${passed?'pass':'fail'}">${passed?'合格 ':'最高 '}${b}点</span>` : ''}
        <span class="exam-arrow">▶</span>
      </div>`;
    list.appendChild(card);
  });
}

/* ===================== 受験開始 ===================== */
function startExam(examId){
  const ex = EXAMS.find(e=>e.id===examId);
  if(!ex) return;
  // 答案の初期化： q1Answers[i] = [{ds,da,cs,ca}...rows], q2/q3 fill = {blankKey:value}
  state = {
    ex, examId,
    daimon: 1,
    q1Idx: 0,
    q1Answers: ex.q1.items.map(()=>[blankRow()]),
    fill: {},                 // "2-0-3" のようなキー → 入力値
    startMs: Date.now(),
    remain: (ex.totalMinutes||60)*60,
  };
  $('ex-title').textContent = ex.title;
  buildCalc();
  startTimer();
  renderDaimonTabs();
  renderDaimon();
  show('exam');
}
function blankRow(){ return {ds:'',da:'',cs:'',ca:''}; }

/* ===================== タイマー ===================== */
function startTimer(){
  stopTimer();
  updateTimer();
  timerId = setInterval(()=>{
    state.remain--;
    updateTimer();
    if(state.remain<=0){
      stopTimer();
      gradeExam(true);
    }
  },1000);
}
function stopTimer(){ if(timerId){ clearInterval(timerId); timerId=null; } }
function updateTimer(){
  const m = Math.floor(state.remain/60), s = state.remain%60;
  const el = $('timer');
  el.textContent = `${m}:${String(s).padStart(2,'0')}`;
  el.classList.toggle('warn', state.remain<=300);
}

/* ===================== 大問タブ ===================== */
function renderDaimonTabs(){
  const tabs = $('daimon-tabs');
  const labels = [['1','第1問'],['2','第2問'],['3','第3問']];
  tabs.innerHTML = labels.map(([d,l])=>{
    const done = daimonAnswered(+d);
    return `<button class="dtab ${state.daimon==d?'active':''}" onclick="switchDaimon(${d})">
      ${l}${done?'<span class="dt-done">●</span>':''}</button>`;
  }).join('');
}
function daimonAnswered(d){
  if(d===1) return state.q1Answers.some(rows=>rows.some(r=>r.ds||r.cs||r.da||r.ca));
  const g = d===2 ? state.ex.q2.groups : state.ex.q3.groups;
  let any=false;
  g.forEach((grp,gi)=>grp.blanks.forEach((bl,bi)=>{ if(state.fill[`${d}-${gi}-${bi}`]!=null && state.fill[`${d}-${gi}-${bi}`]!=='') any=true; }));
  return any;
}
function switchDaimon(d){
  saveCurrentInputs();
  state.daimon = d;
  renderDaimonTabs();
  renderDaimon();
  $('ex-body').scrollTop = 0;
  window.scrollTo(0,0);
}

/* ===================== 描画ディスパッチ ===================== */
function renderDaimon(){
  if(state.daimon===1) renderQ1();
  else renderFill(state.daimon);
  renderFootInfo();
}
function renderFootInfo(){
  let txt='';
  if(state.daimon===1){
    const answered = state.q1Answers.filter(rows=>rows.some(r=>r.ds&&r.cs)).length;
    txt = `第1問 <b>${answered}/15</b> 問入力済み`;
  } else {
    const d = state.daimon;
    const groups = d===2 ? state.ex.q2.groups : state.ex.q3.groups;
    let total=0, filled=0;
    groups.forEach((grp,gi)=>grp.blanks.forEach((bl,bi)=>{ total++; const v=state.fill[`${d}-${gi}-${bi}`]; if(v!=null&&v!=='') filled++; }));
    txt = `第${d}問 <b>${filled}/${total}</b> 箇所入力済み`;
  }
  $('foot-info').innerHTML = txt;
}

/* ===================== 第1問（仕訳）===================== */
function renderQ1(){
  const items = state.ex.q1.items;
  const i = state.q1Idx;
  const q = items[i];
  const body = $('ex-body');
  body.innerHTML = `
    <div class="q1nav">
      <div class="qno">第1問　問${i+1} / 15</div>
      <div class="qnav-btns">
        <button class="qnav-btn" ${i===0?'disabled':''} onclick="q1Move(-1)">‹</button>
        <button class="qnav-btn" ${i===14?'disabled':''} onclick="q1Move(1)">›</button>
      </div>
    </div>
    <div class="qdots" id="q1dots"></div>
    <div class="qcard">
      <div class="qtext">${q.text}</div>
      <div class="choices-note">使用できる勘定科目（この中から選ぶ）
        <div class="choices-list">${q.accounts.map(a=>`<span class="choice-chip">${a}</span>`).join('')}</div>
      </div>
    </div>
    <div class="je-head"><div class="h">借　方</div><div style="width:30px"></div><div class="h">貸　方</div></div>
    <div id="je-rows"></div>
    <button class="je-add" onclick="q1AddRow()">＋ 行を追加（複合仕訳のとき）</button>
  `;
  renderQ1Dots();
  renderQ1Rows();
}
function renderQ1Dots(){
  const items = state.ex.q1.items;
  $('q1dots').innerHTML = items.map((q,idx)=>{
    const ans = state.q1Answers[idx].some(r=>r.ds&&r.cs);
    return `<div class="qdot ${ans?'answered':''} ${idx===state.q1Idx?'current':''}" onclick="q1Goto(${idx})">${idx+1}</div>`;
  }).join('');
}
function renderQ1Rows(){
  const q = state.ex.q1.items[state.q1Idx];
  const rows = state.q1Answers[state.q1Idx];
  const opts = ['<option value="">― 科目 ―</option>'].concat(q.accounts.map(a=>`<option value="${a}">${a}</option>`)).join('');
  $('je-rows').innerHTML = rows.map((r,ri)=>`
    <div class="je-row">
      <div class="je-side">
        <select class="je-sel" data-r="${ri}" data-f="ds">${opts}</select>
        <input class="je-amt" data-r="${ri}" data-f="da" inputmode="numeric" placeholder="金額" value="${fmtAmt(r.da)}">
      </div>
      ${rows.length>1?`<button class="je-rm" onclick="q1RemoveRow(${ri})">✕</button>`:'<div style="width:18px"></div>'}
      <div class="je-side">
        <select class="je-sel" data-r="${ri}" data-f="cs">${opts}</select>
        <input class="je-amt" data-r="${ri}" data-f="ca" inputmode="numeric" placeholder="金額" value="${fmtAmt(r.ca)}">
      </div>
    </div>`).join('');
  // 値復元 & イベント
  $('je-rows').querySelectorAll('.je-sel').forEach(sel=>{
    const ri=+sel.dataset.r, f=sel.dataset.f;
    sel.value = rows[ri][f]||'';
    sel.onchange = ()=>{ rows[ri][f]=sel.value; renderQ1Dots(); renderFootInfo(); renderDaimonTabs(); };
  });
  $('je-rows').querySelectorAll('.je-amt').forEach(inp=>{
    const ri=+inp.dataset.r, f=inp.dataset.f;
    bindAmount(inp, (digits)=>{ rows[ri][f]=digits; }, ()=>{ renderQ1Dots(); renderFootInfo(); renderDaimonTabs(); });
  });
}
function fmtAmt(v){ if(v==null||v==='') return ''; const n=String(v).replace(/[^0-9]/g,''); return n===''?'':Number(n).toLocaleString('ja-JP'); }

/* 金額入力欄をPCでも快適に。
   入力中：数字以外を除去しつつカーソル位置を保持（値の保存のみ・他UIは触らない）。
   blur時：カンマ整形＋UI更新（commit）。 */
function bindAmount(inp, store, commit){
  inp.addEventListener('input', ()=>{
    const before = inp.value;
    const pos = inp.selectionStart ?? before.length;
    const digitsBeforeCaret = before.slice(0,pos).replace(/[^0-9]/g,'').length;
    const digits = before.replace(/[^0-9]/g,'');
    if(before !== digits){
      inp.value = digits;
      try{ inp.setSelectionRange(digitsBeforeCaret, digitsBeforeCaret); }catch(e){}
    }
    store(digits);          // 保存のみ（再描画しない＝カーソル安全）
  });
  inp.addEventListener('blur', ()=>{
    const digits = inp.value.replace(/[^0-9]/g,'');
    inp.value = digits ? Number(digits).toLocaleString('ja-JP') : '';
    store(digits);
    if(commit) commit(digits);   // ここでUI更新
  });
}
function q1Move(d){ saveCurrentInputs(); const n=state.q1Idx+d; if(n>=0&&n<15){ state.q1Idx=n; renderQ1(); } }
function q1Goto(i){ saveCurrentInputs(); state.q1Idx=i; renderQ1(); }
function q1AddRow(){ saveCurrentInputs(); state.q1Answers[state.q1Idx].push(blankRow()); renderQ1Rows(); }
function q1RemoveRow(ri){ saveCurrentInputs(); state.q1Answers[state.q1Idx].splice(ri,1); renderQ1Rows(); renderQ1Dots(); }

/* ===================== 第2問・第3問（穴埋め）===================== */
function renderFill(d){
  const dq = d===2 ? state.ex.q2 : state.ex.q3;
  const body = $('ex-body');
  let html = `<div class="q1nav"><div class="qno">第${d}問（${dq.points}点）</div></div>`;
  dq.groups.forEach((grp,gi)=>{
    html += `<div class="fill-group">
      <div class="fill-group-title">${grp.title}</div>
      ${grp.ctx?`<div class="fill-ctx"><h4>📋 資料・条件</h4>${grp.ctx}</div>`:''}`;
    grp.blanks.forEach((bl,bi)=>{
      const key = `${d}-${gi}-${bi}`;
      const val = state.fill[key] ?? '';
      if(bl.type==='select'){
        const opts = ['<option value="">― 選択 ―</option>'].concat(bl.opts.map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`)).join('');
        html += `<div class="fill-row"><div class="fill-label">${bl.label}</div>
          <select class="fill-sel" data-key="${key}">${opts}</select></div>`;
      } else {
        html += `<div class="fill-row"><div class="fill-label">${bl.label}</div>
          <span class="fill-yen">¥</span>
          <input class="fill-input" data-key="${key}" inputmode="numeric" placeholder="金額" value="${fmtAmt(val)}"></div>`;
      }
    });
    html += `</div>`;
  });
  body.innerHTML = html;
  body.querySelectorAll('.fill-sel').forEach(sel=>{
    sel.onchange = ()=>{ state.fill[sel.dataset.key]=sel.value; renderFootInfo(); renderDaimonTabs(); };
  });
  body.querySelectorAll('.fill-input').forEach(inp=>{
    bindAmount(inp, (digits)=>{ state.fill[inp.dataset.key]=digits; }, ()=>{ renderFootInfo(); renderDaimonTabs(); });
  });
}
function saveCurrentInputs(){
  // フォーカス中の入力を反映（blur前でも拾う）
  document.querySelectorAll('#ex-body .je-amt').forEach(inp=>{
    const rows=state.q1Answers[state.q1Idx]; if(rows&&rows[+inp.dataset.r]) rows[+inp.dataset.r][inp.dataset.f]=inp.value.replace(/[^0-9]/g,'');
  });
  document.querySelectorAll('#ex-body .fill-input').forEach(inp=>{ state.fill[inp.dataset.key]=inp.value.replace(/[^0-9]/g,''); });
}

/* ===================== 採点 ===================== */
function gradeJournal(correct, user){
  // user rows -> {acc:amt} maps; 空行除外
  const sideMap = (rows, sideSel, sideAmt)=>{
    const m={};
    rows.forEach(r=>{ const a=r[sideSel], amt=parseInt(String(r[sideAmt]).replace(/[^0-9]/g,''))||0;
      if(a && amt>0){ m[a]=(m[a]||0)+amt; } });
    return m;
  };
  const cD={}, cC={};
  correct.forEach(e=>{ if(e.debit&&e.dam>0) cD[e.debit]=(cD[e.debit]||0)+e.dam; if(e.credit&&e.cam>0) cC[e.credit]=(cC[e.credit]||0)+e.cam; });
  const uD=sideMap(user,'ds','da'), uC=sideMap(user,'cs','ca');
  const eq=(a,b)=>{ const ka=Object.keys(a), kb=Object.keys(b); if(ka.length!==kb.length) return false; return ka.every(k=>a[k]===b[k]); };
  return eq(cD,uD) && eq(cC,uC);
}
function gradeExam(timeUp){
  stopTimer();
  saveCurrentInputs();
  const ex = state.ex;
  // 第1問
  let q1score=0; const q1results=[];
  ex.q1.items.forEach((q,i)=>{
    const ok = gradeJournal(q.answer, state.q1Answers[i]);
    if(ok) q1score+=3;
    q1results.push({ok, user:state.q1Answers[i]});
  });
  // 第2/3問
  function gradeFill(d){
    const dq = d===2?ex.q2:ex.q3;
    let sc=0; const res=[];
    dq.groups.forEach((grp,gi)=>{
      grp.blanks.forEach((bl,bi)=>{
        const key=`${d}-${gi}-${bi}`;
        let uv = state.fill[key];
        let ok;
        if(bl.type==='select'){ ok = uv===bl.answer; }
        else { const n=parseInt(String(uv).replace(/[^0-9]/g,'')); ok = n===bl.answer; uv = (uv==null||uv==='')?'':n; }
        if(ok) sc+=bl.points;
        res.push({gi,bi,ok,uv,bl});
      });
    });
    return {sc,res};
  }
  const q2=gradeFill(2), q3=gradeFill(3);
  const total = q1score+q2.sc+q3.sc;
  const pass = total>=70;
  const sec = Math.floor((Date.now()-state.startMs)/1000);

  // 保存
  const hist=load(LS.hist,[]);
  hist.unshift({examId:ex.id, examTitle:ex.title, score:total, pass, sec, date:Date.now(), timeUp:!!timeUp});
  save(LS.hist, hist.slice(0,50));
  const best=load(LS.best,{});
  if(best[ex.id]===undefined || total>best[ex.id]) best[ex.id]=total;
  save(LS.best, best);
  // 間違えた仕訳を復習プールへ
  const wrong=load(LS.wrong,[]);
  q1results.forEach((r,i)=>{ if(!r.ok){ if(!wrong.some(w=>w.examId===ex.id&&w.no===i)) wrong.push({examId:ex.id,no:i}); } });
  save(LS.wrong, wrong);

  state.result = { total, pass, sec, q1score, q1results, q2, q3, timeUp:!!timeUp };
  renderResult();
  closeCalc();
  show('result');
}

/* ===================== 結果画面 ===================== */
function renderResult(){
  const r = state.result, ex = state.ex;
  $('res-hero').className = 'res-hero ' + (r.pass?'pass':'fail');
  $('res-verdict').textContent = r.pass ? '合 格' : '不合格';
  $('res-score').innerHTML = `${r.total}<small> / 100点</small>`;
  const m=Math.floor(r.sec/60), s=r.sec%60;
  $('res-time').textContent = `⏱ 所要 ${m}分${s}秒${r.timeUp?'（時間切れ）':''}`;
  const rows = [
    ['第1問', r.q1score, ex.q1.points, '#2980b9'],
    ['第2問', r.q2.sc, ex.q2.points, '#16a085'],
    ['第3問', r.q3.sc, ex.q3.points, '#c0392b'],
  ];
  $('res-break').innerHTML = rows.map(([l,sc,mx,c])=>`
    <div class="break-row">
      <div class="break-dai">${l}</div>
      <div class="break-bar-wrap">
        <div class="break-bar-top"><span>${sc} / ${mx}点</span><span>${Math.round(sc/mx*100)}%</span></div>
        <div class="break-bar"><div class="break-fill" style="width:${Math.round(sc/mx*100)}%;background:${c}"></div></div>
      </div>
    </div>`).join('') +
    `<div style="text-align:center;font-size:12.5px;color:var(--txt2);margin-top:4px;line-height:1.7">
      ${r.pass?'🎉 この調子です！本番でも合格ラインを超えられる実力。':'あと'+(70-r.total)+'点で合格。下の解説で間違えた問題を確認しよう。'}
    </div>`;
}

/* ===================== 解答・解説（レビュー）===================== */
function renderReview(){
  const r=state.result, ex=state.ex;
  let h = '';
  // 第1問
  h += `<div class="rv-sec-label">第1問　仕訳（${r.q1score}/45点）</div>`;
  ex.q1.items.forEach((q,i)=>{
    const res=r.q1results[i];
    const userRows = res.user.filter(x=>x.ds||x.cs||x.da||x.ca);
    h += `<div class="rv-q ${res.ok?'correct':'wrong'}">
      <div class="rv-q-top"><span class="rv-mark">${res.ok?'✅':'❌'}</span>
        <span class="rv-qno">問${i+1}</span>
        <span class="rv-pts ${res.ok?'ok':'ng'}">${res.ok?'+3点':'0点'}</span></div>
      <div class="rv-qtext">${q.text}</div>
      ${journalTable('あなたの解答', userRows.length?userRows:null, 'your')}
      ${journalTable('正解', q.answer, 'corr', true)}
      <div class="rv-expl">💡 ${q.expl}</div>
    </div>`;
  });
  // 第2/3問
  [['第2問',2,ex.q2,r.q2],['第3問',3,ex.q3,r.q3]].forEach(([lbl,d,dq,gr])=>{
    h += `<div class="rv-sec-label">${lbl}（${gr.sc}/${dq.points}点）</div>`;
    dq.groups.forEach((grp,gi)=>{
      h += `<div class="rv-q"><div class="rv-q-top"><span class="rv-qno">${grp.title}</span></div>`;
      h += `<table class="rv-tbl"><tr><th style="text-align:left">項目</th><th>あなた</th><th>正解</th><th>配点</th></tr>`;
      grp.blanks.forEach((bl,bi)=>{
        const rr = gr.res.find(x=>x.gi===gi&&x.bi===bi);
        const uv = (rr.uv===''||rr.uv==null)?'<span style="color:#bbb">未入力</span>':(bl.type==='select'?rr.uv:num(rr.uv));
        const cv = bl.type==='select'?bl.answer:num(bl.answer);
        h += `<tr>
          <td class="acc">${bl.label}</td>
          <td class="${rr.ok?'':'your'}">${uv}</td>
          <td class="corr">${cv}</td>
          <td style="text-align:center">${rr.ok?'<span style="color:#27ae60;font-weight:800">+'+bl.points+'</span>':'<span style="color:#e74c3c">0</span>'}</td>
        </tr>`;
      });
      h += `</table></div>`;
    });
  });
  $('rv-body').innerHTML = h;
  $('rv-title').textContent = `${ex.title}　解答・解説`;
}
function journalTable(title, rows, cls, isCorrect){
  if(!rows){
    return `<table class="rv-tbl"><tr><th colspan="4" style="text-align:left">${title}</th></tr>
      <tr><td colspan="4" class="${cls}" style="text-align:center;color:#bbb">未入力</td></tr></table>`;
  }
  let body='';
  rows.forEach(r=>{
    const ds = isCorrect ? r.debit : r.ds;
    const da = isCorrect ? r.dam : r.da;
    const cs = isCorrect ? r.credit : r.cs;
    const ca = isCorrect ? r.cam : r.ca;
    body += `<tr>
      <td class="acc ${cls}">${ds||''}</td><td class="${cls}">${da?num(String(da).replace(/[^0-9]/g,'')):''}</td>
      <td class="acc ${cls}">${cs||''}</td><td class="${cls}">${ca?num(String(ca).replace(/[^0-9]/g,'')):''}</td>
    </tr>`;
  });
  return `<table class="rv-tbl">
    <tr><th colspan="4" style="text-align:left">${title}</th></tr>
    <tr><th>借方科目</th><th>金額</th><th>貸方科目</th><th>金額</th></tr>${body}</table>`;
}
function showReview(){ renderReview(); show('review'); }
function backToResult(){ show('result'); }

/* ===================== 中断・提出の確認 ===================== */
let modalAction=null;
function openModal(title,msg,okLabel,cancelLabel,onOk,okClass){
  $('modal-title').textContent=title; $('modal-msg').textContent=msg;
  $('modal-ok').textContent=okLabel; $('modal-cancel').textContent=cancelLabel;
  $('modal-ok').className='m-ok '+(okClass||'');
  modalAction=onOk; $('modal').classList.add('show');
}
$('modal-cancel').onclick=()=>$('modal').classList.remove('show');
$('modal-ok').onclick=()=>{ $('modal').classList.remove('show'); if(modalAction) modalAction(); };
function confirmQuit(){ openModal('試験を中断しますか？','ここまでの解答は採点されず破棄されます。','中断する','続ける',()=>goHome(),''); }
function confirmSubmit(){
  saveCurrentInputs();
  const answered = state.q1Answers.filter(rows=>rows.some(r=>r.ds&&r.cs)).length;
  openModal('採点しますか？',`第1問は${answered}/15問入力済みです。採点後に解答・解説を確認できます。`,'採点する','まだ見直す',()=>gradeExam(false),'go');
}

/* ===================== 電卓 ===================== */
let calcState={cur:'0',prev:null,op:null,fresh:true};
function buildCalc(){
  const keys=[['C','fn'],['÷','op'],['×','op'],['⌫','fn'],
    ['7',''],['8',''],['9',''],['-','op'],
    ['4',''],['5',''],['6',''],['+','op'],
    ['1',''],['2',''],['3',''],['=','eq'],
    ['0',''],['00',''],['.',''],];
  $('calc-grid').innerHTML = keys.map(([k,c])=>`<button class="calc-k ${c}" onclick="calcKey('${k}')">${k}</button>`).join('');
}
function calcKey(k){
  const c=calcState;
  if(k==='C'){ c.cur='0';c.prev=null;c.op=null;c.fresh=true; }
  else if(k==='⌫'){ c.cur=c.cur.length>1?c.cur.slice(0,-1):'0'; }
  else if(['+','-','×','÷'].includes(k)){
    if(c.op&&!c.fresh){ calcEq(); }
    c.prev=parseFloat(c.cur); c.op=k; c.fresh=true;
  }
  else if(k==='='){ calcEq(); c.op=null; }
  else if(k==='.'){ if(!c.cur.includes('.')){ c.cur=c.fresh?'0.':c.cur+'.'; c.fresh=false; } }
  else { // digit
    if(c.fresh){ c.cur=(k==='00'?'0':k); c.fresh=false; }
    else { if(c.cur==='0'&&k!=='00') c.cur=k; else c.cur+=k; }
  }
  $('calc-disp').textContent = formatCalc(c.cur);
}
function calcEq(){
  const c=calcState; if(c.op==null||c.prev==null) return;
  const a=c.prev, b=parseFloat(c.cur); let r=0;
  if(c.op==='+')r=a+b; else if(c.op==='-')r=a-b; else if(c.op==='×')r=a*b; else if(c.op==='÷')r=b===0?0:a/b;
  c.cur=String(Math.round(r*1e6)/1e6); c.prev=null; c.fresh=true;
}
function formatCalc(s){ if(s.includes('.')){ const [a,b]=s.split('.'); return Number(a).toLocaleString('ja-JP')+'.'+b; } return Number(s).toLocaleString('ja-JP'); }
function toggleCalc(){ $('calc-pop').classList.toggle('show'); }
function closeCalc(){ $('calc-pop').classList.remove('show'); }

/* ===================== 仕訳特訓 ===================== */
function buildJournalPool(){
  const pool=[];
  EXAMS.forEach(ex=>ex.q1.items.forEach((q,i)=>pool.push({examId:ex.id,examTitle:ex.title,no:i,q})));
  return pool;
}
function startRenshu(){
  const pool=buildJournalPool();
  for(let i=pool.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  renshu={ mode:'all', list:pool, idx:0, rows:[blankRow()], graded:false };
  $('renshu-title').textContent='仕訳特訓';
  buildCalc(); renderRenshu(); show('renshu');
}
function startReviewWrong(){
  const wrong=load(LS.wrong,[]);
  if(wrong.length===0){ toast('復習対象の問題はまだありません'); return; }
  const list=wrong.map(w=>{ const ex=EXAMS.find(e=>e.id===w.examId); return {examId:w.examId,examTitle:ex.title,no:w.no,q:ex.q1.items[w.no]}; });
  renshu={ mode:'wrong', list, idx:0, rows:[blankRow()], graded:false };
  $('renshu-title').textContent='間違えた仕訳の復習';
  buildCalc(); renderRenshu(); show('renshu');
}
function renderRenshu(){
  const it=renshu.list[renshu.idx]; const q=it.q;
  $('renshu-prog').textContent=`${renshu.idx+1} / ${renshu.list.length}`;
  const opts=['<option value="">― 科目 ―</option>'].concat(q.accounts.map(a=>`<option value="${a}">${a}</option>`)).join('');
  const body=$('renshu-body');
  body.innerHTML=`
    <div class="qcard">
      <div style="font-size:11px;color:var(--txt2);font-weight:700;margin-bottom:6px">${it.examTitle}・問${it.no+1}</div>
      <div class="qtext">${q.text}</div>
      <div class="choices-note">使用できる勘定科目
        <div class="choices-list">${q.accounts.map(a=>`<span class="choice-chip">${a}</span>`).join('')}</div>
      </div>
    </div>
    <div class="je-head"><div class="h">借　方</div><div style="width:30px"></div><div class="h">貸　方</div></div>
    <div id="r-je-rows"></div>
    <button class="je-add" onclick="renshuAddRow()">＋ 行を追加</button>
    <div id="renshu-result"></div>`;
  renderRenshuRows(opts);
  renshu.graded=false;
  $('renshu-action').textContent='答え合わせ';
  $('renshu-foot-info').innerHTML='科目と金額を入力して答え合わせ';
}
function renderRenshuRows(opts){
  const rows=renshu.rows;
  $('r-je-rows').innerHTML=rows.map((r,ri)=>`
    <div class="je-row">
      <div class="je-side">
        <select class="je-sel" data-r="${ri}" data-f="ds">${opts}</select>
        <input class="je-amt" data-r="${ri}" data-f="da" inputmode="numeric" placeholder="金額" value="${fmtAmt(r.da)}">
      </div>
      ${rows.length>1?`<button class="je-rm" onclick="renshuRemoveRow(${ri})">✕</button>`:'<div style="width:18px"></div>'}
      <div class="je-side">
        <select class="je-sel" data-r="${ri}" data-f="cs">${opts}</select>
        <input class="je-amt" data-r="${ri}" data-f="ca" inputmode="numeric" placeholder="金額" value="${fmtAmt(r.ca)}">
      </div>
    </div>`).join('');
  $('r-je-rows').querySelectorAll('.je-sel').forEach(sel=>{
    const ri=+sel.dataset.r,f=sel.dataset.f; sel.value=rows[ri][f]||'';
    sel.onchange=()=>rows[ri][f]=sel.value;
  });
  $('r-je-rows').querySelectorAll('.je-amt').forEach(inp=>{
    const ri=+inp.dataset.r,f=inp.dataset.f;
    bindAmount(inp, (digits)=>{ rows[ri][f]=digits; }, null);
  });
}
function renshuAddRow(){ saveRenshuInputs(); renshu.rows.push(blankRow()); const it=renshu.list[renshu.idx]; const opts=['<option value="">― 科目 ―</option>'].concat(it.q.accounts.map(a=>`<option value="${a}">${a}</option>`)).join(''); renderRenshuRows(opts); }
function renshuRemoveRow(ri){ saveRenshuInputs(); renshu.rows.splice(ri,1); const it=renshu.list[renshu.idx]; const opts=['<option value="">― 科目 ―</option>'].concat(it.q.accounts.map(a=>`<option value="${a}">${a}</option>`)).join(''); renderRenshuRows(opts); }
function saveRenshuInputs(){
  document.querySelectorAll('#r-je-rows .je-amt').forEach(inp=>{ if(renshu.rows[+inp.dataset.r]) renshu.rows[+inp.dataset.r][inp.dataset.f]=inp.value.replace(/[^0-9]/g,''); });
}
function renshuAction(){
  if(!renshu.graded){
    saveRenshuInputs();
    const it=renshu.list[renshu.idx]; const ok=gradeJournal(it.q.answer, renshu.rows);
    renshu.graded=true;
    // 復習プール更新
    let wrong=load(LS.wrong,[]);
    if(ok){ wrong=wrong.filter(w=>!(w.examId===it.examId&&w.no===it.no)); }
    else { if(!wrong.some(w=>w.examId===it.examId&&w.no===it.no)) wrong.push({examId:it.examId,no:it.no}); }
    save(LS.wrong, wrong);
    // 結果表示
    $('renshu-result').innerHTML=`
      <div class="rv-q ${ok?'correct':'wrong'}" style="margin-top:14px">
        <div class="rv-q-top"><span class="rv-mark">${ok?'✅':'❌'}</span>
          <span class="rv-qno">${ok?'正解！':'不正解'}</span></div>
        ${journalTable('正解', it.q.answer,'corr',true)}
        <div class="rv-expl">💡 ${it.q.expl}</div>
      </div>`;
    $('renshu-result').scrollIntoView({behavior:'smooth',block:'nearest'});
    $('renshu-action').textContent = renshu.idx<renshu.list.length-1 ? '次の問題へ →' : '特訓を終える';
    $('renshu-foot-info').innerHTML = ok?'<b style="color:#27ae60">正解！</b>':'<b style="color:#e74c3c">復習リストに追加</b>';
  } else {
    if(renshu.idx<renshu.list.length-1){ renshu.idx++; renshu.rows=[blankRow()]; renderRenshu(); window.scrollTo(0,0); }
    else { toast('おつかれさまでした！'); goHome(); }
  }
}

/* ===================== toast ===================== */
let toastT=null;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2200); }

/* ===================== init ===================== */
renderHome();
