// Leitor original preservado do FolhaCerta (fallback para relatórios Dexian).
  function bytesLatin1(bytes) {
    let out='';
    for(let i=0;i<bytes.length;i+=0x6000) out += String.fromCharCode(...bytes.subarray(i,i+0x6000));
    return out;
  }
  async function inflated(bytes) {
    if (typeof DecompressionStream === 'undefined') throw Error('Este navegador não permite ler o PDF offline. Use uma versão atualizada do Chrome ou Edge.');
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      const out = await new Response(stream).arrayBuffer();
      return bytesLatin1(new Uint8Array(out));
    } catch(e) {throw new Error('Falha na descompressão do PDF: ' + e.message);}
  }
  function decodePdfLiteral(s) {
    return s.replace(/\\(?:([0-7]{1,3})|([nrtbf()\\])|\r?\n)/g, (_,oct,special)=>{
      if(oct) return String.fromCharCode(parseInt(oct,8)&255);
      const map={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'};
      return special && (map[special]||special) || '';
    });
  }
  // Formed from the text drawing operators. Limits extraction to textual operators,
  // avoiding accidentally interpreting binary PDF metadata as summary contents.
  function extractOperators(pageContent) {
    const pieces=[];
    for (const block of pageContent.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
      const atoms=[];
      for(const m of block[1].matchAll(/\(((?:\\[\s\S]|[^\\)])*)\)\s*(?:Tj|'|")/g)) {
        atoms.push(decodePdfLiteral(m[1]));
      }
      if(atoms.length) pieces.push(atoms.join(' ').replace(/\s+/g,' ').trim());
    }
    return pieces;
  }
  async function pdfTextLegacy(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const binary=bytesLatin1(bytes);
    if(!binary.startsWith('%PDF-')) throw Error('Este arquivo não parece ser um PDF.');
    const objs = Array.from(binary.matchAll(/\b\d+\s+\d+\s+obj\b/g));
    let contents=[];
    for(let i=0;i<objs.length;i++){
      const start=objs[i].index,stop=i+1<objs.length?objs[i+1].index:binary.length;
      const section=binary.slice(start,Math.min(stop,start+1500));
      const m=section.match(/\bstream\r?\n/);
      if(!m) continue;
      const header=section.slice(0,m.index);
      if(!/\/Filter\s*\/FlateDecode/.test(header) || /\/Type\s*\/(ObjStm|XRef)/.test(header))continue;
      const l=header.match(/\/Length\s+(\d+)/);
      const begin=start+m.index+m[0].length;
      const end=l?begin+Number(l[1]):binary.indexOf('endstream',begin);
      if(end<=begin || end>bytes.length || end-begin>25e6)continue;
      let raw;
      try {raw=await inflated(bytes.subarray(begin,end));} catch {continue;}
      if(raw.includes('BT') && (raw.includes(' Tm')||raw.includes(' Td'))) contents.push(raw);
    }
    if(!contents.length)throw Error('Não consegui ler o texto deste PDF. Verifique se é o espelho de ponto original (não uma digitalização ou foto).');
    const items=contents.flatMap(extractOperators);
    if(items.length<20)throw Error('O arquivo não contém texto reconhecível suficiente para extrair as rubricas.');
    return items;
  }
  function parseItemsLegacy(items) {
    const normalized=items.map(s=>s.replace(/\s+/g,' ').trim());
    const all=normalized.join(' ');
    const period=all.match(/Espelho de ponto\s*-\s*Per[íi]odo\s*(\d\d\/\d\d\/\d{4})\s*at[ée]\s*(\d\d\/\d\d\/\d{4})/i);
    if(!period) throw Error('Este PDF não parece ser um espelho de ponto da Dexian compatível: não encontrei o período.');
    function after(regex, valueRegex, def='') {
      for(let i=0;i<normalized.length;i++){
        if(regex.test(normalized[i])) {
          for (let j=i+1;j<Math.min(i+4,normalized.length);j++) {
            if(valueRegex.test(normalized[j])) return normalized[j];
          }
        }
      }
      return def;
    }
    const hh=/^\d{1,4}:\d{2}(?:\s*h)?$/;
    const gets=(r)=>after(r,hh,'').replace(/\s*h$/,'');
    const selected={
      night: gets(/^ADIC\.?NOTURNO\s*30%\s*\(A12\)/i),
      he100: gets(/^HR\.?EXT\.?100%AD\.?NT30%\s*\(A7/i),
      he75: gets(/^HR\.?EXT\.?75%AD\.?NT30%\s*\(A80\)/i),
      bank: gets(/^PAGTO\.?\s*B\.?HORAS\s*75%\s*\(B04\)/i),
    };
    if(!selected.night)throw Error('Não encontrei o total A12 (adicional noturno). Confira se enviou um espelho de ponto com a seção Verbas.');
    const dias=after(/^Dias trabalhados$/i,/^\d{1,2}$/,'');
    const ht=gets(/^HT\s*-\s*Horas trabalhadas$/i);
    const hn=gets(/^HN\s*-\s*Horas noturnas$/i);
    const redu=gets(/^Horas noturnas reduzidas$/i);
    const emitted=after(/^Data Emiss[aã]o:\s*$/i,/\d\d\/\d\d\/\d{4}/,'');
    const data={periodStart:period[1],periodEnd:period[2],days:dias,worked:ht,nightRaw:hn,nightReduction:redu,emission:emitted, ...selected};
    const missing=Object.entries(selected).filter(([k,v])=>!v).map(([k])=>({he75:'A80',he100:'A72',bank:'B04'}[k]||k));
    const startYear=Number(period[1].slice(-4));
    const endParts=period[2].split('/').map(Number);
    const dateEnd=new Date(endParts[2],endParts[1]-1,endParts[0],23,59,59);
    const warnings=[];
    if(missing.length)warnings.push('Rubricas não encontradas: '+missing.join(', ')+'. Foram consideradas como zero. Confira se realmente não houve essas verbas.');
    if(data.emission){
      const d=data.emission.match(/\d\d\/\d\d\/\d{4}/);
      if(d){const a=d[0].split('/').map(Number);const dt=new Date(a[2],a[1]-1,a[0]);if(dt<dateEnd)warnings.push('O PDF foi emitido antes do término do mês: valores podem estar parciais.');}
    }
    if(startYear!==2026)warnings.push('As tabelas automáticas de INSS/IRRF configuradas são de 2026. Atualize para outro ano.');
    return {...data,missing,warnings};
  }

export { pdfTextLegacy, parseItemsLegacy };
