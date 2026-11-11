import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../src/payroll.js';
import { blankRecord, planRestore, readLedger, writeLedger } from '../src/storage.js';

const ledgerOf = (...records) => ({ version:1, records:Object.fromEntries(records.map(r=>[r.month,r])) });

test('Salvar e reabrir preserva pagamento no mesmo mês ou em ano diferente',()=>{
  for (const payMonth of ['2026-11','2027-02']) {
    const record=blankRecord('2026-11');
    record.payMonth=payMonth;
    record.settings={...record.settings,salary:'3000',inssOverride:'0',irrfOverride:'0'};
    record.forecast={...calculate(record.point,record.settings,payMonth),payMonth,savedAt:'2026-11-11T12:00:00.000Z'};
    record.actual={gross:3000,net:3000,final:3000,warnings:[]};
    record.notes='Conferir pagamento';
    let serialized;
    const storage={setItem(key,value){serialized=value;},getItem(){return serialized;}};
    writeLedger(storage,ledgerOf(record));
    const reopened=readLedger(storage).records[record.month];
    assert.deepEqual(reopened,record);
    assert.equal(calculate(reopened.point,reopened.settings,reopened.payMonth).final,record.forecast.final);
  }
});

test('Restaurar mantém conflitos por padrão e adiciona apenas meses novos',()=>{
  const local=blankRecord('2026-01'), conflict=blankRecord('2026-01');
  local.notes='Revisão mais recente';conflict.notes='Backup antigo';
  const untouched=blankRecord('2026-02'), added=blankRecord('2026-03');
  added.payMonth='2026-03';
  const ledger=ledgerOf(local,untouched), backup=ledgerOf(conflict,added);
  const before=JSON.stringify({ledger,backup});
  const plan=planRestore(ledger,backup);
  assert.deepEqual(plan.added,['2026-03']);
  assert.deepEqual(plan.kept,['2026-01']);
  assert.deepEqual(plan.replaced,[]);
  assert.equal(plan.ledger.records['2026-01'].notes,local.notes);
  assert.deepEqual(plan.ledger.records['2026-02'],untouched);
  assert.equal(plan.ledger.records['2026-03'].payMonth,'2026-03');
  assert.equal(JSON.stringify({ledger,backup}),before);
});

test('Substituir usa o mês completo do backup, sem apagar meses ausentes',()=>{
  const old=blankRecord('2026-01'), updated=blankRecord('2026-01'), untouched=blankRecord('2026-02');
  updated.notes='Revisado';updated.payMonth='2026-01';updated.point.night='12:30';
  const plan=planRestore(ledgerOf(old,untouched),ledgerOf(updated),'replace');
  assert.deepEqual(plan.replaced,['2026-01']);
  assert.deepEqual(plan.kept,[]);
  assert.deepEqual(plan.ledger.records['2026-01'],updated);
  assert.deepEqual(plan.ledger.records['2026-02'],untouched);
});

test('Backup só com conflitos mantidos não exige escrita; modos e backups inválidos são rejeitados',()=>{
  const ledger=ledgerOf(blankRecord('2026-01'));
  const plan=planRestore(ledger,ledger);
  assert.equal(plan.added.length+plan.replaced.length,0);
  assert.throws(()=>planRestore(ledger,ledger,'invalid'));
  assert.throws(()=>planRestore(ledger,ledgerOf()));
  assert.throws(()=>planRestore(ledger,{version:2,records:{}}));
});

test('Limite é aplicado ao histórico combinado, sem modificar os originais',()=>{
  const records=Array.from({length:600},(_,i)=>blankRecord(`${2020+Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`));
  const ledger=ledgerOf(...records), backup=ledgerOf(blankRecord('2070-01'));
  assert.throws(()=>planRestore(ledger,backup),/600/);
  assert.equal(Object.keys(ledger.records).length,600);
  assert.equal(Object.keys(backup.records).length,1);
  assert.equal(Object.keys(planRestore(ledger,ledgerOf(records[0]),'replace').ledger.records).length,600);
});
