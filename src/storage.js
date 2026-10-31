import { DEFAULTS, validMonth, nextMonth } from './payroll.js';
export const KEY = 'folhacerta-ledger-v1';
export function blankRecord(month) { return { month, payMonth: nextMonth(month), settings: { ...DEFAULTS }, point: { night:'00:00', he75:'00:00', he100:'00:00', bank:'00:00', sundayRaw:'00:00', source:'manual', warnings:[] }, actual:null, forecast:null, notes:'', updatedAt:null }; }
export function readLedger(storage) {
  try {
    const v = JSON.parse(storage.getItem(KEY) || 'null');
    if (v) return validateLedger(v);
  } catch (e) { if (storage.getItem(KEY)) throw Error('O histórico salvo não pôde ser aberto. Exporte uma cópia antes de restaurar um backup.'); }
  return { version:1, records:{} };
}
export function validateLedger(value) {
  if (!value || value.version !== 1 || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) throw Error('Backup incompatível com o FolhaCerta.');
  if (Object.keys(value.records).length > 600) throw Error('Backup acima do limite de 600 competências.');
  const records = {};
  for (const [month, r] of Object.entries(value.records)) {
    if (!validMonth(month) || !r || typeof r !== 'object' || !validMonth(r.payMonth)) throw Error('Competência inválida no backup.');
    const rec = blankRecord(month);
    if (!r.settings || !r.point) throw Error('Backup incompleto.');
    for (const k of Object.keys(DEFAULTS)) if (typeof r.settings[k] === 'string' && r.settings[k].length < 100) rec.settings[k] = r.settings[k];
    for (const k of ['night','he75','he100','bank','sundayRaw','periodStart','periodEnd','days','worked','nightRaw','nightReduction','source']) if (typeof r.point[k] === 'string' && r.point[k].length < 100) rec.point[k] = r.point[k];
    rec.point.warnings = Array.isArray(r.point.warnings) ? r.point.warnings.filter(x=>typeof x==='string').map(x=>x.slice(0,500)).slice(0,20) : [];
    rec.notes = typeof r.notes === 'string' ? r.notes.slice(0,2000) : '';
    rec.updatedAt = typeof r.updatedAt === 'string' ? r.updatedAt : null;
    // Um backup contém só dados; a interface nunca interpreta HTML de seus campos.
    for (const k of ['actual','forecast']) {
      const obj = r[k];
      if (obj && typeof obj === 'object') {
        const json = JSON.stringify(obj);
        if (json.length > 30000 || !Number.isFinite(obj.gross) || !Number.isFinite(obj.final) || !Number.isFinite(obj.net)) throw Error('Valores inválidos no backup.');
        for (const group of ['earn','deductions']) if (obj[group] && Object.values(obj[group]).some(v=>!Number.isFinite(v))) throw Error('Valores inválidos no backup.');
        if (k === 'forecast' && (!obj.earn || !obj.deductions || !['salary','night','he75','he100','bank','extra','dsr'].every(key=>Number.isFinite(obj.earn[key])) || !['inss','irrf','assist','insurance','other','advance'].every(key=>Number.isFinite(obj.deductions[key])))) throw Error('Previsão incompleta no backup.');
        rec[k] = JSON.parse(json);
        rec[k].warnings = Array.isArray(obj.warnings) ? obj.warnings.filter(x=>typeof x==='string').slice(0,20).map(x=>x.slice(0,500)) : [];
      }
    }
    records[month] = rec;
  }
  return { version:1, records };
}
export function writeLedger(storage, ledger) { try { storage.setItem(KEY, JSON.stringify(ledger)); } catch { throw Error('Não foi possível salvar neste navegador. Exporte um backup antes de fechar.'); } }
export function migratePreferences(storage, record) {
  try {
    const old = JSON.parse(storage.getItem('folhacerta-prefs-v3') || storage.getItem('folhacerta-prefs-v2') || 'null');
    if (!old || typeof old !== 'object') return record;
    for (const k of Object.keys(DEFAULTS)) if (typeof old[k] === 'string') record.settings[k] = old[k];
    record.settings.dsrMode = ({automatic:'ratio',historical:'ratio',manual:'hours',value:'value'})[old.dsrMode] || 'ratio';
  } catch {}
  return record;
}
