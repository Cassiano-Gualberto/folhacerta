import { calculate, DEFAULTS, decimal, money, monthLabel, nextMonth, number, round, validMonth } from './payroll.js';
import { parsePoint, parsePayslip, readPdf } from './pdf.js';
import { blankRecord, migratePreferences, readLedger, validateLedger, writeLedger } from './storage.js';

const $ = id => document.getElementById(id);
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pages = { overview:['Visão geral','Seu salário, sem surpresa.','Do espelho de ponto à previsão de pagamento.'], calculate:['Calcular','Do ponto ao pagamento.','Confira suas horas e entenda cada parte do cálculo.'], history:['Histórico','Sua evolução, mês a mês.','Previsões salvas, pagamentos reais e regras de cada competência.'], settings:['Ajustes','As regras do seu mês.','Salário, divisor, descontos e hipóteses à vista.'] };
let ledger, protectedStorage = false, storage;
function status(message, kind = '') { $('globalStatus').hidden = false; $('globalStatus').className = 'notice '+kind; $('globalStatus').textContent = message; }
try { storage = localStorage; ledger = readLedger(storage); } catch(e) { ledger = { version:1, records:{} }; protectedStorage = true; status(e.message+' O app pode ser usado nesta sessão; seus dados anteriores não serão substituídos.', 'error'); }
const now = new Date(); const previous = new Date(now.getFullYear(), now.getMonth()-1, 1);
const defaultMonth = `${previous.getFullYear()}-${String(previous.getMonth()+1).padStart(2,'0')}`;
let currentMonth = Object.keys(ledger.records).sort().at(-1) || defaultMonth;
let record, last = null, importKind = 'point', busy = false, pendingRestore = null, pendingPayslip = null;
function getRecord(month) {
  if (ledger.records[month]) return ledger.records[month];
  const r = blankRecord(month);
  const prior = Object.keys(ledger.records).filter(k=>k<month).sort().at(-1);
  if (prior) {
    r.settings = { ...ledger.records[prior].settings, inssOverride:'', irrfOverride:'', dsrHours:'', dsrValue:'' };
    if (['value','hours'].includes(r.settings.dsrMode)) r.settings.dsrMode='ratio';
  } else if (!Object.keys(ledger.records).length && storage) migratePreferences(storage,r);
  ledger.records[month] = r;
  return r;
}
function persist() {
  record.updatedAt = new Date().toISOString();
  if (protectedStorage) { $('autosaveStatus').textContent='Sessão temporária — exporte um backup.'; return false; }
  try { writeLedger(storage,ledger); $('autosaveStatus').textContent='Rascunho salvo neste dispositivo.'; return true; }
  catch(e) { status(e.message,'error'); $('autosaveStatus').textContent='Falha ao salvar — exporte um backup.'; return false; }
}
function loadMonth(month) {
  if (!validMonth(month)) { status('Selecione uma competência válida.','error'); return; }
  currentMonth=month; record=getRecord(month); $('month').value=month; $('payMonth').value=record.payMonth;
  document.querySelectorAll('[data-setting]').forEach(el=>el.value=record.settings[el.dataset.setting] ?? DEFAULTS[el.dataset.setting]);
  document.querySelectorAll('[data-point]').forEach(el=>el.value=record.point[el.dataset.point] || '00:00');
  $('notes').value=record.notes;
  for (const [id,k] of [['actualGross','gross'],['actualNet','net'],['actualFinal','final']]) $(id).value=record.actual ? decimal(record.actual[k]) : '';
  $('pointMeta').hidden=!record.point.periodStart;
  $('pointMeta').textContent=record.point.periodStart ? `Ponto: ${record.point.periodStart} a ${record.point.periodEnd} · ${record.point.days || '—'} dias trabalhados · ${record.point.worked || '—'} horas trabalhadas · redução noturna: ${record.point.nightReduction || '—'}.` : '';
  $('pointSource').textContent=record.point.source==='point-pdf' ? 'PDF importado' : 'Manual';
  render();
}
function route() {
  let name=location.hash.replace(/^#\/?/,'');
  if (!pages[name]) name='overview';
  document.querySelectorAll('.page').forEach(el=>el.hidden=el.id!==name);
  document.querySelectorAll('[data-page]').forEach(el=>{ el.classList.toggle('active',el.dataset.page===name); if(el.dataset.page===name)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current'); });
  [$('pageTitle').textContent,$('heading').textContent,$('headingDescription').textContent]=pages[name];
  window.scrollTo({top:0,behavior:'instant'});
}
window.addEventListener('hashchange',route);
function syncDsr() { const mode=record.settings.dsrMode; for (const [id,show] of [['ratioWrap',mode==='ratio'],['usefulWrap',mode==='calendar'],['restWrap',mode==='calendar'],['dsrHoursWrap',mode==='hours'],['dsrValueWrap',mode==='value']]) $(id).hidden=!show; }
const earningLabels={ salary:'Salário-base', night:'A12 · adicional noturno', he75:'A80 · HE 75% + noturno', he100:'A72 · HE 100% + noturno', bank:'B04 · horas convertidas', extra:'Outros proventos', dsr:'180 · DSR' };
const deductionLabels={inss:'INSS',irrf:'IRRF',assist:'Contribuição assistencial',insurance:'Seguro de vida',other:'Outros descontos',advance:'Adiantamento recebido'};
function tableRow(label,value,detail='',cls='') { return `<tr class="${cls}"><td class="label">${escape(label)}${detail?`<small>${escape(detail)}</small>`:''}</td><td class="num">${money(value)}</td></tr>`; }
function summaryLine(label,value,cls='') { return `<div class="summary-line ${cls}"><span><i></i>${escape(label)}</span><strong>${money(value)}</strong></div>`; }
function render() {
  syncDsr(); last=null;
  try { last=calculate(record.point,record.settings,record.payMonth); $('calculationError').hidden=true; }
  catch(e) { $('calculationError').hidden=false; $('calculationError').textContent=e.message; }
  ['saveForecast','csvBtn','copyBtn'].forEach(id=>$(id).disabled=!last);
  $('paymentLabel').textContent=`Fechamento de ${monthLabel(record.payMonth)}`;
  const sources=record.point.source==='point-pdf'?'Com base no ponto importado':'Com base nos lançamentos manuais';
  $('balanceHint').textContent=last ? `${sources} · estimativa após o adiantamento.` : 'Informe o salário em Ajustes ou importe seu contracheque.';
  for (const [id,value] of [['final',last?.final],['gross',last?.gross],['net',last?.net],['variables',last?.variablePay],['deductions',last?.deductionsTotal],['advanceSummary',last?.deductions.advance]]) $(id).textContent=Number.isFinite(value)?money(value):'—';
  $('sundayCredit').textContent=last?.creditedSunday ? `Crédito adicional: ${decimal(last.creditedSunday)} horas, convertido em pagamento.` : '';
  $('savedInfo').textContent=record.forecast ? `Previsão fixada em ${new Date(record.forecast.savedAt).toLocaleString('pt-BR')}. Editar o rascunho não altera essa comparação; “Salvar previsão” a substitui.` : 'As edições são salvas como rascunho. Salve a previsão para fixar os valores da comparação.';
  if (last) {
    const v=last;
    $('breakdown').className='';
    $('breakdown').innerHTML=summaryLine('Salário-base',v.earn.salary)+summaryLine('Noturno e horas extras',v.variablePay,'positive')+summaryLine('DSR '+(['ratio','calendar'].includes(record.settings.dsrMode)?'(estimado)':''),v.earn.dsr,'positive')+(v.earn.extra?summaryLine('Outros proventos',v.earn.extra):'')+summaryLine('Descontos e adiantamento',-v.deductionsTotal,'negative')+summaryLine('A receber no fechamento',v.final,'summary-total');
    const details={salary:`Divisor ${record.settings.divisor} · hora-base ${money(v.h)}`,night:`${decimal(v.nightHours)} h remuneradas · ${record.settings.nightPercent}%`,he75:`${record.point.he75} h · fator ${record.settings.he75Factor}`,he100:`${record.point.he100} h · fator ${record.settings.he100Factor}`,bank:`${record.point.bank} h${v.creditedSunday?' + crédito adicional':''} · fator ${record.settings.bankFactor}`,dsr:v.dsrDescription};
    $('calculationDetails').className='table-wrap';
    $('calculationDetails').innerHTML='<table class="table" aria-label="Cálculo do pagamento"><tbody>'+Object.entries(v.earn).filter(([k,n])=>k!=='extra'||n).map(([k,n])=>tableRow(earningLabels[k],n,details[k])).join('')+tableRow('Total bruto',v.gross,'','total')+Object.entries(v.deductions).map(([k,n])=>tableRow(deductionLabels[k],-n)).join('')+tableRow('Líquido total do mês',v.net,'Antes de subtrair o adiantamento')+tableRow('Pagamento final',v.final,'Adiantamento subtraído uma única vez','total')+'</tbody></table>';
    $('calculationWarnings').innerHTML=v.warnings.map(s=>`<p>${escape(s)}</p>`).join('');
  } else {
    $('breakdown').className='empty compact-empty'; $('breakdown').textContent='Complete os ajustes para calcular a previsão.';
    $('calculationDetails').className='empty compact-empty'; $('calculationDetails').textContent='Confira o aviso acima. O cálculo e a exportação ficam pausados até a correção.'; $('calculationWarnings').textContent='';
  }
  renderComparison();renderHistory();
}
function renderComparison() {
  const el=$('comparison'), a=record.actual, p=record.forecast || last;
  if (!a) { el.className='empty compact-empty'; el.textContent='Importe o recibo ou informe valores reais em Ajustes para comparar.'; return; }
  if (!p) { el.className='empty compact-empty'; el.textContent=`Pagamento real registrado: ${money(a.final)}. Complete sua previsão para comparar.`; return; }
  el.className=''; const difference=round(a.final-p.final);
  const row=(label,predicted,actual)=>{ const known=Number.isFinite(actual); const d=known?round(actual-predicted):null; return `<tr><td>${escape(label)}</td><td class="num">${money(predicted)}</td><td class="num">${known?money(actual):'—'}</td><td class="num ${d===0?'match':'difference'}">${known?`${d>0?'+':''}${money(d)}`:'—'}</td></tr>`; };
  el.innerHTML=`<div class="comparison-summary">${Math.abs(difference)<.005?'Pagamento final coincide com a previsão.':`Real ${difference>0?'acima':'abaixo'} da previsão em ${money(Math.abs(difference))}.`} ${record.forecast?'Comparando com a previsão salva.':'Comparando com o rascunho atual.'}</div><div class="table-wrap"><table class="table" aria-label="Previsão e pagamento real"><thead><tr><th>Rubrica</th><th class="num">Previsto</th><th class="num">Real</th><th class="num">Real − previsto</th></tr></thead><tbody>${Object.keys(earningLabels).filter(k=>k!=='extra'||p.earn.extra||a.earn?.extra).map(k=>row(earningLabels[k],p.earn[k]||0,a.earn?.[k])).join('')}${row('Total bruto',p.gross,a.gross)}${Object.keys(deductionLabels).map(k=>row(deductionLabels[k],p.deductions[k],a.deductions?.[k])).join('')}${row('Pagamento final',p.final,a.final)}</tbody></table></div><p class="small muted">Diferenças pequenas podem vir da precisão das horas e dos arredondamentos. Confira especialmente o DSR e o divisor. ${escape((a.warnings||[]).join(' '))}</p>`;
}
function historicalRecords() { return Object.values(ledger.records).filter(r=>r.forecast||r.actual).sort((a,b)=>a.month.localeCompare(b.month)); }
function renderHistory() {
  const all=historicalRecords(); const el=$('historyList');
  el.className=all.length?'':'empty';
  if (!all.length) el.textContent='Você ainda não salvou uma previsão.';
  else el.innerHTML=[...all].reverse().map(r=>`<div class="history-item"><div><h3>${escape(monthLabel(r.month))}</h3><small>Pagamento: ${escape(monthLabel(r.payMonth))} · divisor ${escape(r.forecast?.divisor || r.settings.divisor)}</small></div><div><small>Previsto no fechamento</small><strong>${r.forecast?money(r.forecast.final):'—'}</strong></div><div><small>Pagamento real</small><strong>${r.actual?money(r.actual.final):'—'}</strong></div><button type="button" class="button" data-open-month="${r.month}">Abrir mês ↗</button></div>`).join('');
  const recent=all.slice(-6), chart=$('evolution');
  if (!recent.length) { chart.className='chart empty'; chart.textContent='Salve previsões para acompanhar sua evolução.'; $('chartLegend').textContent=''; return; }
  const max=Math.max(1,...recent.flatMap(r=>[r.forecast?.final||0,r.actual?.final||0]));
  chart.className='chart';
  chart.innerHTML=recent.map(r=>{const label=monthLabel(r.month);return `<div class="chart-column"><div class="chart-bars">${r.forecast?`<div class="chart-bar" role="img" aria-label="${escape(label)} previsto ${money(r.forecast.final)}" title="Previsto: ${money(r.forecast.final)}" style="height:${Math.max(2,r.forecast.final/max*100)}%"></div>`:''}${r.actual?`<div class="chart-bar real" role="img" aria-label="${escape(label)} real ${money(r.actual.final)}" title="Real: ${money(r.actual.final)}" style="height:${Math.max(2,r.actual.final/max*100)}%"></div>`:''}</div><span class="chart-label">${escape(label.split(' de ')[0].slice(0,3))}/${r.month.slice(2,4)}</span></div>`;}).join('');
  $('chartLegend').textContent='Verde: previsão salva · azul: pagamento real · valores completos no histórico.';
}
$('historyList').addEventListener('click',e=>{const button=e.target.closest('[data-open-month]');if(button){loadMonth(button.dataset.openMonth);location.hash='/overview';}});
$('month').addEventListener('change',()=>loadMonth($('month').value));
$('payMonth').addEventListener('change',()=>{if(!validMonth($('payMonth').value)){status('Selecione uma competência válida de pagamento.','error');return;}record.payMonth=$('payMonth').value;persist();render();});
document.querySelectorAll('[data-setting],[data-point]').forEach(el=>el.addEventListener('input',()=>{const group=el.dataset.setting?'settings':'point', key=el.dataset.setting||el.dataset.point;record[group][key]=el.value;persist();render();}));
$('notes').addEventListener('input',()=>{record.notes=$('notes').value.slice(0,2000);persist();});
$('manualBtn').addEventListener('click',()=>{location.hash='/calculate';$('night').focus();status('Edite as horas e os ajustes. Nenhum PDF é necessário.');});
$('newMonthBtn').addEventListener('click',()=>{loadMonth(nextMonth(currentMonth));location.hash='/settings';status('Nova competência aberta. Ajustes recorrentes copiados; INSS, IRRF e DSR manuais foram limpos.');});
$('saveForecast').addEventListener('click',()=>{if(!last)return;record.forecast={...structuredClone(last),divisor:record.settings.divisor,payMonth:record.payMonth,savedAt:new Date().toISOString()};const saved=persist();render();status(saved?'Previsão salva. A comparação usará estes valores até você salvar novamente.':'Previsão fixada nesta sessão. Exporte o backup para guardá-la.',saved?'':'warning');});

function choosePdf(kind) { if(busy)return;importKind=kind;$('pdfInput').value='';$('pdfInput').click(); }
for(const id of ['importPoint','importPointHome'])$(id).addEventListener('click',()=>choosePdf('point'));
for(const id of ['importPayslipHome','importPayslipSettings'])$(id).addEventListener('click',()=>choosePdf('payslip'));
$('pdfInput').addEventListener('change',e=>importPdf(e.target.files[0],importKind));
const drop=document.querySelector('.import-card');
for(const type of ['dragenter','dragover'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('drag');});
for(const type of ['dragleave','drop'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('drag');});
drop.addEventListener('drop',e=>importPdf(e.dataTransfer.files[0],'point'));
async function importPdf(file,kind) {
  if(!file||busy)return;
  if(file.size>15*1024*1024){status('O PDF deve ter no máximo 15 MB.','error');return;}
  busy=true;status('Lendo o PDF neste dispositivo…');
  const buttons=['importPoint','importPointHome','importPayslipHome','importPayslipSettings'];buttons.forEach(id=>$(id).disabled=true);
  try {
    const lines=await readPdf(await file.arrayBuffer());
    if(kind==='point') {
      const point=parsePoint(lines);
      if(!validMonth(point.month))throw Error('Competência do espelho inválida.');
      const dest=getRecord(point.month);dest.point=point;dest.settings.nightBasis='reduced';
      loadMonth(point.month);const saved=persist();location.hash='/calculate';
      status('Ponto importado. Revise horas e salário antes de salvar a previsão.'+(saved?'':' Exporte um backup para guardar a sessão.'),point.warnings.length?'warning':'');
    } else {
      pendingPayslip=parsePayslip(lines);
      const a=pendingPayslip;
      $('payslipWorkMonth').value=currentMonth;
      $('payslipDescription').textContent=`Recibo de ${a.payMonth?monthLabel(a.payMonth):'competência não identificada'}: bruto ${money(a.gross)}, pagamento final ${money(a.final)}.${a.suggestedDivisor?` As rubricas sugerem divisor ${a.suggestedDivisor}; confira em Ajustes.`:''} Confirme a qual mês de horas ele pertence.`;
      $('payslipDialog').showModal();status('Contracheque lido. Confirme a competência para vinculá-lo.');
    }
  } catch(e) {status(e.message||'Não foi possível ler o PDF.','error');}
  finally {busy=false;buttons.forEach(id=>$(id).disabled=false);}
}
$('confirmPayslip').addEventListener('click',()=>{
  if(!pendingPayslip)return;
  const month=$('payslipWorkMonth').value;
  if(!validMonth(month)){status('Selecione o mês das horas.','error');return;}
  const a=pendingPayslip, dest=getRecord(month);
  // Não substituir uma previsão já fixada ao importar o documento real.
  try{if(!dest.forecast){const prediction=calculate(dest.point,dest.settings,dest.payMonth);dest.forecast={...prediction,divisor:dest.settings.divisor,payMonth:dest.payMonth,savedAt:new Date().toISOString()};}}catch{}
  dest.actual=a;
  if(a.payMonth)dest.payMonth=a.payMonth;
  let seeded=false;
  let salaryValid=false;try{salaryValid=number(dest.settings.salary)>0;}catch{}
  if(!salaryValid) {
    dest.settings.salary=decimal(a.earn.salary);seeded=true;
    if(a.suggestedDivisor&&[200,220].includes(a.suggestedDivisor))dest.settings.divisor=String(a.suggestedDivisor);
    for(const k of ['advance','assist','insurance','other']) if(Number.isFinite(a.deductions[k]))dest.settings[k]=decimal(a.deductions[k]);
  }
  pendingPayslip=null;$('payslipDialog').close();loadMonth(month);persist();location.hash='/overview';
  status('Contracheque vinculado. '+(seeded?'Salário e descontos foram preenchidos pelo recibo. A previsão atual usa essas informações, não uma previsão anterior. ':'A previsão salva foi preservada. ')+(a.warnings||[]).join(' '),a.warnings.length?'warning':'');
});
$('cancelPayslip').addEventListener('click',()=>{pendingPayslip=null;$('payslipDialog').close();});
$('actualForm').addEventListener('submit',e=>{e.preventDefault();try{
  const a={source:'manual',gross:number($('actualGross').value),net:number($('actualNet').value),final:number($('actualFinal').value),warnings:[]};
  if(a.gross<0||a.net<0||a.final<0||a.gross<a.net||a.net<a.final)throw Error('Confira os valores: bruto ≥ líquido mensal ≥ pagamento final, todos não negativos.');
  record.actual=a;persist();render();location.hash='/overview';status('Valores reais registrados para comparação.');
}catch(err){status(err.message,'error');}});
function download(content,type,name) {
  if(window.FolhaCertaAndroid?.saveFile) {
    const bytes=new TextEncoder().encode(content);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    window.FolhaCertaAndroid.saveFile(name,type,btoa(binary));return;
  }
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('backupBtn').addEventListener('click',()=>download(JSON.stringify(ledger,null,2),'application/json',`FolhaCerta_backup_${new Date().toISOString().slice(0,10)}.json`));
$('restoreBtn').addEventListener('click',()=>{$('backupInput').value='';$('backupInput').click();});
$('backupInput').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{
  if(file.size>5*1024*1024)throw Error('Backup acima do limite de 5 MB.');
  pendingRestore=validateLedger(JSON.parse(await file.text()));
  const months=Object.keys(pendingRestore.records);if(!months.length)throw Error('O backup não contém competências.');
  const overlaps=months.filter(m=>ledger.records[m]);$('restoreDescription').textContent=`Serão restauradas ${months.length} competências. ${overlaps.length} competências já existentes serão substituídas.`;$('restoreDialog').showModal();
}catch(err){pendingRestore=null;status(err.message,'error');}});
$('confirmRestore').addEventListener('click',()=>{if(!pendingRestore)return;ledger.records={...ledger.records,...pendingRestore.records};pendingRestore=null;protectedStorage=false;$('restoreDialog').close();loadMonth(Object.keys(ledger.records).sort().at(-1));const saved=persist();status(saved?'Backup restaurado neste dispositivo.':'Backup aberto nesta sessão; o navegador não permitiu salvar.',saved?'':'error');});
$('cancelRestore').addEventListener('click',()=>{pendingRestore=null;$('restoreDialog').close();});
function summary() { if(!last)return '';return `FOLHACERTA — HORAS ${monthLabel(currentMonth)}\nPagamento: ${monthLabel(record.payMonth)}\nDivisor: ${record.settings.divisor}\n${Object.entries(last.earn).map(([k,n])=>earningLabels[k]+': '+money(n)).join('\n')}\nBRUTO: ${money(last.gross)}\n${Object.entries(last.deductions).map(([k,n])=>deductionLabels[k]+': '+money(n)).join('\n')}\nLÍQUIDO MENSAL: ${money(last.net)}\nPAGAMENTO FINAL: ${money(last.final)}\nDSR: ${last.dsrDescription}. Estimativa não oficial.`; }
$('copyBtn').addEventListener('click',async()=>{if(!last)return;try{await navigator.clipboard.writeText(summary());status('Resumo copiado.');}catch{const text=document.createElement('textarea');text.value=summary();document.body.append(text);text.select();const ok=document.execCommand('copy');text.remove();status(ok?'Resumo copiado.':'Não foi possível copiar neste navegador.',ok?'':'warning');}});
$('csvBtn').addEventListener('click',()=>{if(!last)return;const rows=[['Campo','Valor'],['Horas de referência',currentMonth],['Competência pagamento',record.payMonth],['Divisor',record.settings.divisor],...Object.entries(last.earn).map(([k,v])=>[earningLabels[k],decimal(v)]),['Bruto',decimal(last.gross)],...Object.entries(last.deductions).map(([k,v])=>[deductionLabels[k],decimal(v)]),['Líquido mensal',decimal(last.net)],['Pagamento final',decimal(last.final)],['DSR',last.dsrDescription]];const quote=v=>'"'+String(v).replaceAll('"','""')+'"';download('\ufeff'+rows.map(r=>r.map(quote).join(';')).join('\r\n'),'text/csv',`FolhaCerta_${currentMonth}.csv`);});
let installPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
$('installBtn').addEventListener('click',async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;}else $('installDialog').showModal();});
$('closeInstall').addEventListener('click',()=>$('installDialog').close());
function installed() {$('installBtn').hidden=true;}
window.addEventListener('appinstalled',installed);
if(window.matchMedia('(display-mode: standalone)').matches||window.FolhaCertaAndroid)installed();
async function setupOffline() {
  if(!('serviceWorker' in navigator)||window.FolhaCertaAndroid)return;
  try{
    const registration=await navigator.serviceWorker.register('./sw.js');
    const showUpdate=()=>{if(registration.waiting){$('updateBanner').hidden=false;$('updateBtn').onclick=()=>registration.waiting.postMessage({type:'ACTIVATE'});}};
    showUpdate();registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate();});});
    const wasControlled=Boolean(navigator.serviceWorker.controller);let reloading=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(wasControlled&&navigator.serviceWorker.controller&&registration.active&&!reloading){reloading=true;location.reload();}});
    await navigator.serviceWorker.ready;$('connection').textContent=navigator.onLine?'Pronto para usar offline':'Offline · dados locais';
  }catch{ $('connection').textContent='Offline ainda indisponível'; }
}
window.addEventListener('online',()=>{$('connection').textContent='Local e privado';});
window.addEventListener('offline',()=>{$('connection').textContent='Sem conexão · dados locais';});
loadMonth(currentMonth);route();setupOffline();
