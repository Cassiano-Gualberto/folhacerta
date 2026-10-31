import { pdfTextLegacy, parseItemsLegacy } from './legacy-pdf.js';
import { number, round } from './payroll.js';

// PDF.js é distribuído com o app: sem CDN, upload, rastreadores ou chamada remota.
export async function readPdf(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length > 15 * 1024 * 1024) throw Error('PDF acima do limite de 15 MB.');
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw Error('O arquivo selecionado não é um PDF válido.');
  let document, task;
  try {
    const pdfjs = await import('../vendor/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.mjs', import.meta.url).href;
    task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, cMapUrl: new URL('../vendor/cmaps/', import.meta.url).href, cMapPacked: true, standardFontDataUrl: new URL('../vendor/standard_fonts/', import.meta.url).href, useWorkerFetch: false });
    document = await task.promise;
    if (document.numPages > 40) throw Error('PDF acima do limite de 40 páginas.');
    const lines = [];
    for (let pageNum = 1; pageNum <= document.numPages; pageNum++) {
      const page = await document.getPage(pageNum);
      const content = await page.getTextContent();
      const rows = [];
      for (const item of content.items) {
        if (!item.str?.trim()) continue;
        const y = item.transform[5], x = item.transform[4];
        let row = rows.find(r => Math.abs(r.y - y) < 2);
        if (!row) { row = { y, items: [] }; rows.push(row); }
        row.items.push({ x, text: item.str });
      }
      rows.sort((a,b) => b.y - a.y);
      for (const row of rows) lines.push(row.items.sort((a,b) => a.x - b.x).map(i => i.text).join(' ').replace(/\s+/g,' ').trim());
      page.cleanup();
    }
    if (lines.join('').length < 40) throw Error('Não encontrei texto. PDFs escaneados precisam de OCR e ainda não são suportados.');
    return lines;
  } catch (e) {
    if (e.name === 'PasswordException') throw Error('PDF protegido por senha. Selecione uma cópia desbloqueada no seu dispositivo.');
    // O leitor original segue como alternativa para relatórios antigos.
    try { return await pdfTextLegacy(buffer); } catch { throw Error(e.message?.includes('limite') || e.message?.includes('escaneados') ? e.message : 'Não foi possível ler o texto do PDF. Use o documento original, sem senha, ou faça o lançamento manual.'); }
  } finally { await task?.destroy(); }
}
export function parsePoint(items) {
  let old;
  try { old = parseItemsLegacy(items); } catch {}
  const lines = items.map(s => s.replace(/\s+/g,' ').trim()), text = lines.join('\n');
  const period = text.match(/Espelho de ponto\s*[-–]?\s*Per[íi]odo\s*(\d{2}\/\d{2}\/\d{4})\s*at[ée]\s*(\d{2}\/\d{2}\/\d{4})/i);
  if (!period) throw Error('Não encontrei o período de um espelho de ponto compatível. Confira se selecionou o documento correto.');
  const get = (regex, fallback = '') => text.match(regex)?.[1] || fallback;
  const duration = '(\\d{1,4}:[0-5]\\d)';
  const point = {
    periodStart: period[1], periodEnd: period[2],
    night: get(new RegExp('ADIC\\.?\\s*NOTURNO\\s*30%\\s*\\(A12\\)\\s*'+duration,'i'), old?.night),
    he75: get(new RegExp('HR\\.?\\s*EXT\\.?\\s*75%\\s*AD\\.?\\s*NT30%\\s*\\(A80\\)\\s*'+duration,'i'), old?.he75),
    he100: get(new RegExp('HR\\.?\\s*EXT\\.?\\s*100%\\s*AD\\.?\\s*NT30%\\s*\\(A7(?:2\\))?\\s*'+duration,'i'), old?.he100),
    bank: get(new RegExp('PAGTO\\.?\\s*B\\.?\\s*HORAS\\s*75%\\s*\\(B04\\)\\s*'+duration,'i'), old?.bank),
    sundayRaw: '00:00',
    days: get(/Dias trabalhados\s+(\d{1,2})\b/i, old?.days),
    worked: get(/HT\s*-\s*Horas trabalhadas\s+(\d{1,4}:[0-5]\d)/i, old?.worked),
    nightRaw: get(/HN\s*-\s*Horas noturnas\s+(\d{1,4}:[0-5]\d)/i, old?.nightRaw),
    nightReduction: get(/Horas noturnas reduzidas\s+(\d{1,4}:[0-5]\d)/i, old?.nightReduction),
    source: 'point-pdf', warnings: []
  };
  if (!Object.values(point).some(v => typeof v === 'string' && /^\d+:[0-5]\d$/.test(v) && v !== '00:00') && !/Verbas|Resumo/i.test(text)) throw Error('Não encontrei os totais do ponto. Faça o lançamento manual.');
  point.missing = ['night','he75','he100','bank'].filter(k => !point[k]);
  if (point.missing.length) point.warnings.push('Rubricas ausentes no PDF: '+point.missing.map(k => ({night:'A12',he75:'A80',he100:'A72',bank:'B04'})[k]).join(', ')+'. Confira os zeros antes de salvar.');
  for (const k of point.missing) point[k] = '00:00';
  const emission = text.match(/Data Emiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] || old?.emission?.match(/\d{2}\/\d{2}\/\d{4}/)?.[0];
  const iso = d => d.split('/').reverse().join('-');
  if (emission && iso(emission) < iso(point.periodEnd)) point.warnings.push('Espelho emitido antes do fim do período: previsão parcial.');
  point.month = iso(point.periodEnd).slice(0,7);
  return point;
}
const MONTHS = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
export function parsePayslip(lines) {
  const text = lines.join('\n').replace(/[\u00a0\t]/g,' ');
  if (!/RECIBO DE PAGAMENTO|TOTAL BRUTO/i.test(text)) throw Error('Este PDF não parece ser um contracheque compatível.');
  const earn = {}, deductions = {}, refs = {};
  const known = { '001':['earn','salary'], '180':['earn','dsr'], 'A12':['earn','night'], 'A72':['earn','he100'], 'A80':['earn','he75'], 'B04':['earn','bank'], '401':['deductions','inss'], '402':['deductions','irrf'], '403':['deductions','irrf'], '413':['deductions','advance'], '426':['deductions','assist'], 'C99':['deductions','insurance'] };
  // A ordem visual preserva as três colunas do recibo. Não confundir BASES com proventos.
  const pattern = /\b(001|180|A12|A72|A80|B04|401|402|403|413|426|C99)\s+([^\n]*?)\s+([\d.,]+)\s+([\d.]+,\d{2})\b/g;
  for (const m of text.matchAll(pattern)) {
    const [group,key] = known[m[1]];
    if (key === 'irrf' && !/I\.?\s*R\.?\s*R\.?\s*F|RENDA/i.test(m[2])) continue;
    (group === 'earn' ? earn : deductions)[key] = number(m[4]);
    refs[key] = number(m[3]);
  }
  // IRRF pode usar outro código: reconhecer a descrição, sem capturar BASE IRRF.
  if (!('irrf' in deductions)) {
    const ir = text.match(/\b\d{3}\s+(?:IRRF|I\.R\.R\.F\.?|IMP\.? RENDA)\s+[\d.,]+\s+([\d.]+,\d{2})/i);
    deductions.irrf = ir ? number(ir[1]) : 0;
  }
  const gross = text.match(/TOTAL BRUTO\s*:\s*([\d.]+,\d{2})/i);
  const final = text.match(/L[ÍI]QUIDO A RECEBER\s*:\s*([\d.]+,\d{2})/i) || text.match(/830\s+LIQUIDO A RECEBER\s+[\d.,]+\s+([\d.]+,\d{2})/i);
  const deductionTotal = text.match(/TOTAL DE DESCONTOS\s*:\s*([\d.]+,\d{2})/i);
  if (!gross || !final || !earn.salary) throw Error('Não reconheci salário, total bruto e líquido. Você pode informar os valores reais manualmente.');
  const monthMatch = text.toLowerCase().match(new RegExp('('+MONTHS.join('|')+')\\s*[/ ]\\s*(20\\d{2})'));
  const payMonth = monthMatch ? `${monthMatch[2]}-${String(MONTHS.indexOf(monthMatch[1])+1).padStart(2,'0')}` : null;
  const out = { earn, deductions, refs, gross: number(gross[1]), final: number(final[1]), payMonth, source:'payslip-pdf', warnings: [] };
  for (const key of ['advance','assist','insurance']) deductions[key] ??= 0;
  deductions.other = deductionTotal ? round(number(deductionTotal[1]) - Object.values(deductions).reduce((a,b)=>a+b,0)) : 0;
  out.net = round(out.final + deductions.advance);
  out.deductionsTotal = deductionTotal ? number(deductionTotal[1]) : round(out.gross-out.final);
  if (Math.abs(out.gross-out.deductionsTotal-out.final) > .02) out.warnings.push('Os totais lidos não fecham. Revise o contracheque manualmente.');
  const knownEarnings = round(Object.values(earn).reduce((a,b)=>a+b,0));
  if (Math.abs(knownEarnings-out.gross) > .02) out.warnings.push('Há proventos não identificados nas rubricas conhecidas. O total bruto oficial foi preservado.');
  if (!('inss' in deductions)) out.warnings.push('INSS não identificado. Confira o valor no documento.');
  // Inferência apenas diagnóstica. Não transforma uma hipótese em regra contratual.
  const candidates = [['night',.3],['he75',1.975],['he100',2.3],['bank',1.75]].filter(([k])=>earn[k]>0&&refs[k]>0).map(([k,f])=>earn.salary*refs[k]*f/earn[k]).sort((a,b)=>a-b);
  if (candidates.length >= 2) out.suggestedDivisor = Math.round(candidates[Math.floor(candidates.length/2)]);
  return out;
}
