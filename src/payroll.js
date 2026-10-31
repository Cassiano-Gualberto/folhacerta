// Motor independente da interface. Valores monetários arredondados por rubrica.
export const round = n => n === 0 ? 0 : Math.sign(n) * Math.round((Math.abs(n) + 1e-9) * 100) / 100;
export const money = n => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
export const decimal = n => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export function number(value, label = 'Valor') {
  if (typeof value === 'number') { if (Number.isFinite(value)) return value; throw Error(`${label} inválido.`); }
  const s = String(value ?? '').trim().replace(/^R\$\s*/, '').replace(/\s/g, '');
  if (!s) return 0;
  if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(s) && !/^-?\d+(?:\.\d+)?$/.test(s)) throw Error(`${label} inválido.`);
  const n = Number(s.includes(',') ? s.replaceAll('.', '').replace(',', '.') : s);
  if (!Number.isFinite(n)) throw Error(`${label} inválido.`);
  return n;
}
export function hours(value) {
  const s = String(value ?? '').trim();
  if (!s) return 0;
  if (s.includes(':')) {
    const m = s.match(/^(\d{1,4}):([0-5]\d)$/);
    if (!m) throw Error('Horas inválidas. Use HH:MM ou horas decimais, por exemplo 05:30 ou 5,50.');
    return Number(m[1]) + Number(m[2]) / 60;
  }
  const n = number(value, 'Horas');
  if (n < 0 || n > 9999) throw Error('Horas devem estar entre 0 e 9999.');
  return n;
}
export const DEFAULTS = Object.freeze({
  salary: '', divisor: '220', advance: '0,00', assist: '0,00', insurance: '0,00', other: '0,00', extraEarnings: '0,00',
  nightPercent: '30', nightBasis: 'reduced', he75Factor: '1,975', he100Factor: '2,30', bankFactor: '1,75',
  dsrMode: 'ratio', dsrRate: '19,23076923', usefulDays: '26', restDays: '5', dsrHours: '', dsrValue: '',
  inssRounding: 'truncate-brackets', inssOverride: '', irrfOverride: '', dependents: '0', pension: '0,00'
});
const INSS = [[1621, .075], [2902.84, .09], [4354.27, .12], [8475.55, .14]];
export function inss2026(base, mode = 'truncate-brackets') {
  let previous = 0, total = 0;
  for (const [ceiling, rate] of INSS) {
    const value = Math.max(0, Math.min(base, ceiling) - previous) * rate;
    total += mode === 'truncate-brackets' ? Math.floor(value * 100 + 1e-7) / 100 : value;
    previous = ceiling;
    if (base <= ceiling) break;
  }
  return round(total);
}
export function irrf2026(gross, inss, dependents = 0, pension = 0) {
  const legalDeduction = inss + dependents * 189.59 + pension;
  const deduction = Math.max(legalDeduction, 607.20);
  const base = Math.max(0, gross - deduction);
  const [rate, minus] = base > 4664.68 ? [.275, 908.73] : base > 3751.05 ? [.225, 675.49] : base > 2826.65 ? [.15, 394.16] : base > 2428.80 ? [.075, 182.16] : [0, 0];
  const beforeReduction = round(Math.max(0, base * rate - minus));
  const reduction = gross <= 5000 ? beforeReduction : gross <= 7350 ? Math.min(beforeReduction, Math.max(0, 978.62 - .133145 * gross)) : 0;
  return { value: round(Math.max(0, beforeReduction - reduction)), base: round(base), deduction: round(deduction), reduction: round(reduction) };
}
function positive(v, label, max = 1e7) { const n = number(v, label); if (n < 0 || n > max) throw Error(`${label} deve estar entre 0 e ${max}.`); return n; }
const hasValue = v => String(v ?? '').trim() !== '';
export function calculate(point = {}, input = {}, payMonth = '2026-01') {
  const s = { ...DEFAULTS, ...input };
  const salary = positive(s.salary, 'Salário-base');
  const divisor = positive(s.divisor, 'Divisor', 1000);
  if (!salary || !divisor) throw Error('Informe o salário-base e um divisor maior que zero.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payMonth)) throw Error('Competência de pagamento inválida.');
  const year = Number(payMonth.slice(0, 4));
  if (year !== 2026 && (!hasValue(s.inssOverride) || !hasValue(s.irrfOverride))) throw Error(`Tabelas de ${year} não cadastradas. Informe INSS e IRRF manuais (inclusive zero) para este pagamento.`);
  const h = salary / divisor;
  const hrs = Object.fromEntries(['night', 'he75', 'he100', 'bank', 'sundayRaw'].map(k => [k, hours(point[k])]));
  // A12 do espelho já é reduzida. Redução aplicada apenas quando horas de relógio são escolhidas.
  const nightHours = hrs.night * (s.nightBasis === 'clock' ? 60 / 52.5 : 1);
  // Só as horas adicionais ainda NÃO incluídas no B04 recebem o crédito de 40%.
  const creditedSunday = hrs.sundayRaw * 1.4;
  const earn = {
    salary: round(salary),
    night: round(nightHours * h * positive(s.nightPercent, 'Adicional noturno', 100) / 100),
    he75: round(hrs.he75 * h * positive(s.he75Factor, 'Fator A80', 10)),
    he100: round(hrs.he100 * h * positive(s.he100Factor, 'Fator A72', 10)),
    bank: round((hrs.bank + creditedSunday) * h * positive(s.bankFactor, 'Fator B04', 10)),
    extra: round(positive(s.extraEarnings, 'Outros proventos'))
  };
  const variablePay = round(earn.night + earn.he75 + earn.he100 + earn.bank);
  let dsrDescription;
  if (s.dsrMode === 'ratio') { const ratio = positive(s.dsrRate, 'Percentual DSR', 100) / 100; earn.dsr = round(variablePay * ratio); dsrDescription = `${decimal(ratio * 100)}% das verbas variáveis · aproximação`; }
  else if (s.dsrMode === 'calendar') {
    const useful = positive(s.usefulDays, 'Dias úteis', 31), rest = positive(s.restDays, 'Repousos', 31);
    if (!useful) throw Error('Informe pelo menos um dia útil para simular o DSR.');
    earn.dsr = round(variablePay / useful * rest); dsrDescription = `${rest} repousos ÷ ${useful} dias úteis · simulação`;
  } else if (s.dsrMode === 'hours') { if (!hasValue(s.dsrHours)) throw Error('Informe as horas de DSR.'); earn.dsr = round(hours(s.dsrHours) * h); dsrDescription = 'Horas informadas × valor da hora'; }
  else if (s.dsrMode === 'value') { if (!hasValue(s.dsrValue)) throw Error('Informe o DSR em reais (inclusive zero).'); earn.dsr = round(positive(s.dsrValue, 'DSR')); dsrDescription = 'Valor informado manualmente'; }
  else throw Error('Selecione um modo de DSR válido.');
  const gross = round(Object.values(earn).reduce((a, b) => a + b, 0));
  const inss = hasValue(s.inssOverride) ? round(positive(s.inssOverride, 'INSS')) : inss2026(gross, s.inssRounding);
  const deps = positive(s.dependents, 'Dependentes', 30); if (!Number.isInteger(deps)) throw Error('Dependentes deve ser um número inteiro.');
  const irrfInfo = irrf2026(gross, inss, deps, positive(s.pension, 'Pensão alimentícia'));
  const irrf = hasValue(s.irrfOverride) ? round(positive(s.irrfOverride, 'IRRF')) : irrfInfo.value;
  const deductions = { inss, irrf, assist: round(positive(s.assist, 'Contribuição')), insurance: round(positive(s.insurance, 'Seguro')), other: round(positive(s.other, 'Outros descontos')), advance: round(positive(s.advance, 'Adiantamento')) };
  const deductionsTotal = round(Object.values(deductions).reduce((a, b) => a + b, 0));
  const net = round(gross - deductionsTotal + deductions.advance), final = round(gross - deductionsTotal);
  const warnings = [...(point.warnings || [])];
  if (s.dsrMode === 'ratio' || s.dsrMode === 'calendar') warnings.push('A fórmula de DSR da empresa ainda não foi confirmada. Este DSR é uma estimativa.');
  if (Object.values(point).some(v => typeof v === 'string' && /^\d+:[0-5]\d$/.test(v))) warnings.push('O ponto informa minutos; a folha pode usar frações não exibidas. Não arredondamos as horas antes de calcular.');
  if (creditedSunday) warnings.push('Crédito de 40% aplicado somente às horas adicionais de domingo/feriado, fora do B04 importado. Confira o enquadramento com a folha.');
  return { hrs, nightHours, creditedSunday, h, earn, variablePay, dsrDescription, deductions, deductionsTotal, gross, net, final, irrfInfo, warnings };
}
export function nextMonth(month) { const [y, m] = month.split('-').map(Number); return `${y + (m === 12 ? 1 : 0)}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`; }
export function validMonth(month) { return typeof month === 'string' && /^(20\d{2})-(0[1-9]|1[0-2])$/.test(month); }
export function monthLabel(month) { if (!validMonth(month)) return 'Competência'; const [y,m] = month.split('-').map(Number); return new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(Date.UTC(y,m-1,1))); }
