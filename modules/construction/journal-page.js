// Web form uses the existing Portal session; access keys never enter HTML.
export function renderJournalPage(tenantKey, initialProject = '', initialWork = '') {
  const boot = JSON.stringify({ tenant: tenantKey, project: initialProject, work: initialWork }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>工程日誌與工項進度</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;color:#22382e;background:#f3f6f4}header{padding:20px;background:#24563e;color:white}main{max-width:1080px;margin:auto;padding:18px}section,.entry{background:white;padding:18px;margin:12px 0;border:1px solid #d4e2da;border-radius:12px}h1{margin:0;font-size:24px}h2{font-size:19px}h3{font-size:16px}label{display:block;margin:10px 0;font-size:14px}input,select,textarea,button{font:inherit;padding:9px;border:1px solid #a9beb2;border-radius:6px}input,select,textarea{width:100%;margin-top:4px}input[type=checkbox]{width:auto}textarea{min-height:80px}button{cursor:pointer;background:#24563e;color:white;margin:4px}button.secondary{background:white;color:#24563e}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.muted{color:#61796c;font-size:13px}.error{color:#b12b20}#notice{position:sticky;top:0;padding:10px;background:#fff2c9;z-index:2;white-space:pre-wrap}a{color:inherit}details{padding:8px;border-bottom:1px solid #e3ebe6}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #e3ebe6;text-align:left}.scroll{overflow:auto}.spacePicker{margin:10px 0;min-width:0;border:0;padding:0}.spacePicker legend{font-size:14px}.spacePicker details{margin-top:4px;border:1px solid #a9beb2;border-radius:6px;background:#fff;padding:9px}.spacePicker summary{cursor:pointer;overflow-wrap:anywhere}.spaceChecks{max-height:260px;overflow:auto;margin-top:8px}.spaceChecks label{display:flex;gap:10px;align-items:center;margin:0;padding:8px;border-bottom:1px solid #e3ebe6}.spaceChecks input{margin:0;flex:0 0 auto}.spacePicker[hidden]{display:none}.record{padding:10px;background:#f4f8f5;margin:8px 0;white-space:pre-wrap}#workspace[hidden]{display:none}@media print{header,form,button,#notice,#selector{display:none}section{break-inside:avoid}}</style></head>
<body><header><h1>工程日誌與工項進度</h1><p>每天回報工作內容、人數與區域，照片連回原有工項。</p><a id="back">← 工程儀表板</a></header><main>
<div id="notice" role="status">載入案件…</div><section id="selector"><label>工程案件<select id="project"></select></label><button type="button" id="open">開啟案件</button></section>
<div id="workspace" hidden><form id="form"><section><h2>新增工程日誌</h2><div class="grid"><label>實際施工日期<input id="date" type="date" required></label><label>回報來源<select id="source"><option value="web">網頁現場回報</option><option value="line">LINE 補登</option><option value="report">既有報表補登</option></select></label></div>
<label>今日總結／停工原因<textarea id="summary" required maxlength="1900"></textarea></label><label><input id="noWork" type="checkbox"> 今日無施工</label>
<div id="sourceFields" hidden><label>原始來源（LINE 群組、時間、發話者；或報表檔案／連結）<input id="reference"></label><label>原始回報內容<textarea id="original"></textarea></label></div>
</section>
<section><h2>今日工作內容</h2><p class="muted">先選既有工項，再填工程名稱與工作內容。每筆各自填進場人數，日誌合計為人次；同一批人做不同工項仍分別記錄。</p><div id="entries"></div><button type="button" id="addEntry" class="secondary">＋ 工作內容</button></section>
<button id="submit">提交日誌，直接更新進度</button><p class="muted">提交後立即更新工項進度，保留原始回報與歷次紀錄。</p></form>
<section><h2>工程日誌檔案</h2><div id="journals"></div></section><section><h2>各工項進度報告</h2><p class="muted">顯示最新施工日期的回報累計完成率；同日以最新提交為準，歷次回報仍保留。</p><button type="button" id="export" class="secondary">下載案件日誌與進度 JSON</button><button type="button" id="print" class="secondary">列印進度報告／另存 PDF</button><div id="reports"></div></section></div></main>
<script>
const BOOT=${boot};let options={},report={},requestId=crypto.randomUUID(),projectId='',submitting=false,hasSavedAttempt=false,frozenPayload=null;
const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const select=(rows,blank=true)=>(blank?'<option value="">請選擇</option>':'')+rows.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.name)+'</option>').join('');
function notice(s,bad=false){$('notice').textContent=s;$('notice').className=bad?'error':''}
async function api(path,body){if(path==='submit'){frozenPayload=frozenPayload||structuredClone(body);body=frozenPayload}const r=await fetch('/journal/api/'+path+(path.includes('?')?'&':'?')+'tenant='+encodeURIComponent(BOOT.tenant),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok){if(path==='submit'&&r.status>=400&&r.status<500){frozenPayload=null;hasSavedAttempt=false}throw Error(j.error||'操作失敗')}if(path==='submit')frozenPayload=null;return j}
function bind(id,fn){$(id).onclick=()=>Promise.resolve().then(fn).catch(e=>notice(e.message,true))}



function selectedSpaces(d){return [...d.querySelectorAll('.spaceChecks input:checked')].map(c=>c.value)}
function syncSpaceSummary(d){const ids=selectedSpaces(d),names=options.spaces.filter(s=>ids.includes(s.id)).map(s=>s.name);d.querySelector('.spaceSummary').textContent=names.length?names.join('、'):'請勾選施工區域（可複選）'}
function addEntry(){
  const d=document.createElement('div');d.className='entry';
  d.innerHTML='<div class="grid"><label>既有工項<select class="work" required>'+select(options.works)+'</select></label><label>工程名稱<input class="workName" required maxlength="200" placeholder="今天要做的工程名稱"></label></div><p class="muted workTrade"></p>'
    +'<label>工作內容<textarea class="content" required maxlength="1900" placeholder="今天實際做了哪些工作"></textarea></label>'
    +'<div class="grid"><label>今日施作量<input class="quantity" type="number" min="0" step="any"></label><label>單位<input class="unit" maxlength="50" placeholder="平方公尺／公尺／樘"></label><label>累計完成率 %<input class="percent" type="number" min="0" max="100" step="any"></label></div>'
    +(options.budgets.length?'<label>對應預算項目<select class="budget">'+select(options.budgets)+'</select></label>':'')
    +(options.contracts.length?'<label>對應合約<select class="contract">'+select(options.contracts)+'</select></label>':'')
    +'<div class="grid"><label>現場障礙<textarea class="blocker" maxlength="1900"></textarea></label><label>下一步<textarea class="nextStep" maxlength="1900"></textarea></label></div>'
    +'<label>選擇已歸檔照片（可複選）<select class="photos" multiple size="4">'+options.photos.map((p,i)=>'<option value="'+i+'">'+esc(p.name)+'</option>').join('')+'</select></label><label>上傳現場照片（JPEG、PNG、WebP，每張 20 MB）<input class="upload" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div class="uploaded"></div>'
    +'<div class="grid workLocation"><label>進場人數<input class="headcount" type="number" min="0" max="10000" step="1" placeholder="本筆工作人數；未知可留空"></label><fieldset class="spacePicker"><legend>現場空間 / 施工位置</legend><details><summary class="spaceSummary">請勾選施工區域（可複選）</summary><div class="spaceChecks">'+options.spaces.map(s=>'<label><input type="checkbox" value="'+esc(s.id)+'"><span>'+esc(s.name)+'</span></label>').join('')+'</div></details><p class="muted">可勾選同案件多個區域，例如一次施作多層樓。</p></fieldset></div><button type="button" class="secondary remove">移除工作內容</button>';
  d.photoData=[];d.querySelector('.remove').onclick=()=>d.remove();$('entries').append(d);
  const work=d.querySelector('.work'),name=d.querySelector('.workName');
  name.oninput=()=>{d.nameDirty=true};
  work.onchange=()=>{const item=options.works.find(w=>w.id===work.value);if(!d.nameDirty||!name.value){name.value=item?.name||'';d.nameDirty=false}d.querySelector('.workTrade').textContent=item?.trade?'工種：'+item.trade+'（依既有工項帶入）':'';for(const c of d.querySelectorAll('.spaceChecks input'))c.checked=(item?.spaceIds||[]).includes(c.value);syncSpaceSummary(d)};
  d.querySelector('.spaceChecks').onchange=()=>syncSpaceSummary(d);
  if(BOOT.work&&options.works.some(w=>w.id===BOOT.work))work.value=BOOT.work;
  work.onchange();
}
function n(d,c){const v=d.querySelector('.'+c)?.value;return v==null||v===''?null:Number(v)}
function val(d,c){return d.querySelector('.'+c)?.value||''}
async function loadReport(){report=await api('report?project='+encodeURIComponent(projectId));$('journals').innerHTML=report.journals.length?report.journals.map(j=>'<details><summary>'+esc(j.date)+' · '+esc(j.status)+' · '+(j.headcount==null?'人數待補':'合計 '+j.headcount+' '+(j.headcountUnit||'人'))+'</summary><p>'+esc(j.summary)+'</p><p>填報：'+esc(j.reporter)+(j.updatedAt?'；更新：'+esc(j.updatedAt):'')+'</p></details>').join(''):'尚無日誌';$('reports').innerHTML=report.items.map(w=>'<details open><summary><strong>'+esc(w.name)+'</strong> · '+(w.conflict?'同時完成率有衝突，待釐清':w.percent==null?'尚未回報完成率':w.percent+'%')+'</summary>'+w.records.map(r=>'<div class="record">'+esc(r.date)+' · '+esc(r.status)+' · '+esc(r.workName||r.crew)+' · '+(r.crewCount==null?'人數待補':r.crewCount+' 人')+' · '+r.spaceIds.map(id=>esc(options.spaces.find(s=>s.id===id)?.name||'')).join('、')+' · '+esc(r.location)+'<br>'+esc(r.content)+'<br>今日施作量：'+(r.quantity==null?'未填':r.quantity+' '+esc(r.unit))+'；累計：'+(r.percent==null?'未填':r.percent+'%')+(r.blocker?'<br>障礙：'+esc(r.blocker):'')+(r.nextStep?'<br>下一步：'+esc(r.nextStep):'')+'<br>'+r.photos.map(p=>'<a target="_blank" rel="noopener noreferrer" href="'+esc(p.url)+'">'+esc(p.caption||'查看現場照片')+'</a>').join(' · ')+'</div>').join('')+(w.records.length?'':'<p class="muted">尚無施工回報</p>')+'</details>').join('')}
bind('open',async()=>{if(submitting)throw Error('正在提交，請稍候');if(hasSavedAttempt)throw Error('已有提交嘗試，請先用相同內容重試完成後再切換案件');projectId=$('project').value;if(!projectId)throw Error('請選案件');options=await api('options?project='+encodeURIComponent(projectId));requestId=crypto.randomUUID();$('entries').innerHTML='';addEntry();$('noWork').checked=false;setNoWork();$('workspace').hidden=false;await loadReport();notice('可填寫日誌；工作內容與照片連回原工項')});
function setNoWork(){const yes=$('noWork').checked;$('entries').hidden=yes;document.querySelectorAll('#entries [required]').forEach(e=>e.disabled=yes);$('addEntry').disabled=yes}
bind('addEntry',addEntry);$('source').onchange=()=>{$('sourceFields').hidden=$('source').value==='web'};$('noWork').onchange=setNoWork;
$('form').onsubmit=async ev=>{
  ev.preventDefault();if(submitting)return;submitting=true;$('submit').disabled=true;
  try{
    // Validate all location selections before uploading any files.
    const rows=$('noWork').checked?[]:[...$('entries').children];
    if(!rows.length&&!$('noWork').checked)throw Error('請至少填一筆工作內容');
    if(rows.some(d=>!selectedSpaces(d).length))throw Error('請為每筆工作勾選現場空間 / 施工位置');
    notice('正在保存日誌與照片…');const entries=[];
    for(const d of rows){
      for(const file of d.querySelector('.upload').files){
        if(d.photoData.some(p=>p.localKey===file.name+':'+file.lastModified))continue;
        if(file.size>20*1024*1024)throw Error('照片單張上限 20 MB');
        const u='/journal/api/photos/upload?tenant='+encodeURIComponent(BOOT.tenant)+'&project='+encodeURIComponent(projectId)+'&date='+encodeURIComponent($('date').value)+'&filename='+encodeURIComponent(file.name);
        const response=await fetch(u,{method:'POST',headers:{'Content-Type':file.type},body:file});const p=await response.json();if(!response.ok)throw Error(p.error);
        d.photoData.push({...p,localKey:file.name+':'+file.lastModified});d.querySelector('.uploaded').textContent=d.photoData.map(p=>p.name).join('、');
      }
      entries.push({workItemId:val(d,'work'),workName:val(d,'workName'),headcount:n(d,'headcount'),spaceIds:selectedSpaces(d),content:val(d,'content'),quantity:n(d,'quantity'),unit:val(d,'unit'),percent:n(d,'percent'),budgetId:val(d,'budget'),contractId:val(d,'contract'),blocker:val(d,'blocker'),nextStep:val(d,'nextStep'),photos:[...d.querySelector('.photos').selectedOptions].map(o=>options.photos[Number(o.value)]).concat(d.photoData).map(p=>({id:p.id,kind:p.kind,caption:p.caption||p.name}))});
    }
    hasSavedAttempt=true;
    await api('submit',{format:'work-content-v2',projectId,date:$('date').value,requestId,summary:$('summary').value,noWork:$('noWork').checked,entries,source:{kind:$('source').value,reference:$('reference').value,original:$('original').value}});
    hasSavedAttempt=false;requestId=crypto.randomUUID();$('entries').innerHTML='';addEntry();setNoWork();$('summary').value='';await loadReport();notice('日誌已保存，工項進度已更新');
  }catch(e){notice(e.message+'。表單已保留，可用相同內容重試。',true)}finally{submitting=false;$('submit').disabled=false}
};
bind('export',()=>{const b=new Blob([JSON.stringify({projectId,exportedAt:new Date().toISOString(),...report},null,2)],{type:'application/json'});const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download='工程日誌與進度_'+$('date').value+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)});bind('print',()=>window.print());
const baseLoadReport=loadReport;loadReport=async()=>{await baseLoadReport();for(const j of report.journals){const d=[...$('journals').children][report.journals.indexOf(j)];if(!d)continue;const evidence=document.createElement('pre');evidence.style.whiteSpace='pre-wrap';evidence.textContent='原始回報來源：'+j.original.source.kind+' '+j.original.source.reference+'\\n'+j.original.source.original+'\\n'+(j.original.format==='work-content-v2'?'工作：'+j.original.entries.map(e=>e.workName+' / '+(e.headcount==null?'人數待補':e.headcount+' 人')).join('；'):'工班：'+j.original.crews.map(c=>c.name+' / '+c.trade+' / '+(c.count==null?'人數待補':c.count+' 人')).join('；'))+(j.voidReason?'\\n作廢原因：'+j.voidReason:'');d.append(evidence);if(options.canVoid&&j.status!=='作廢'){const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent='作廢並保留原始紀錄';b.onclick=async()=>{const note=prompt('作廢原因（可再提交同日的更正日誌，原紀錄仍保留）');if(!note)return;try{await api('void',{journalId:j.id,note});await loadReport();notice('日誌已作廢，原始回報仍保留')}catch(e){notice(e.message,true)}};d.append(b)}}};
(async()=>{$('back').href='/dashboard?tenant='+encodeURIComponent(BOOT.tenant);$('date').value=new Date(Date.now()+8*3600000).toISOString().slice(0,10);const data=await api('projects');$('project').innerHTML=select(data.projects);if(BOOT.project)$('project').value=BOOT.project;notice('請開啟要回報的案件');if(BOOT.project)$('open').click()})().catch(e=>notice(e.message,true));
</script></body></html>`;
}
