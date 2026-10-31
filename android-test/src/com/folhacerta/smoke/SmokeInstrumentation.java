package com.folhacerta.smoke;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.view.*;
import android.webkit.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Tests use synthetic values only. This APK is not included in the installer. */
public final class SmokeInstrumentation extends Instrumentation {
 private WebView web;
 @Override public void onCreate(Bundle b){super.onCreate(b);start();}
 private WebView find(View view){if(view instanceof WebView)return (WebView)view;if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++){WebView result=find(group.getChildAt(i));if(result!=null)return result;}}return null;}
 private String js(String script)throws Exception{CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();runOnMainSync(()->web.evaluateJavascript(script,value->{result.set(value);latch.countDown();}));if(!latch.await(10,TimeUnit.SECONDS))throw new Exception("JavaScript timeout");return result.get();}
 private void waitFor(String expression)throws Exception{for(int i=0;i<100;i++){if("true".equals(js(expression)))return;Thread.sleep(200);}throw new Exception("Condition failed: "+expression);}
 @Override public void onStart(){Bundle report=new Bundle();try{
  Intent intent=new Intent(Intent.ACTION_MAIN).setClassName("com.folhacerta.app","com.folhacerta.app.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
  Activity activity=startActivitySync(intent);runOnMainSync(()->web=find(activity.getWindow().getDecorView()));if(web==null)throw new Exception("WebView missing");
  waitFor("document.getElementById('salary')!==null && document.getElementById('installBtn').hidden");
  if(getTargetContext().checkCallingOrSelfPermission("android.permission.INTERNET")==PackageManager.PERMISSION_GRANTED)throw new Exception("Unexpected network permission");
  js("(()=>{const set=(id,value)=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event(id==='month'?'change':'input',{bubbles:true}));};set('month','2026-09');set('salary','3000');set('divisor','200');set('advance','1000');set('dsrMode','value');set('dsrValue','0');set('night','10');document.getElementById('saveForecast').click();location.hash='/overview';return true;})()");
  waitFor("document.getElementById('final').textContent.includes('1.791,02')");
  js("window.__fcBeforeReload=true");
  runOnMainSync(()->web.reload());
  waitFor("typeof window.__fcBeforeReload==='undefined' && document.getElementById('final')!==null && document.getElementById('final').textContent.includes('1.791,02')");
  js("window.__fcSmoke='waiting';(async()=>{try{const m=await import('./src/pdf.js');const lines=['RECIBO DE PAGAMENTO Janeiro/2026','001 SALARIO NORMAL 30.00 3.000,00','A12 ADIC.NOTURNO 30% 10.00 100,00','401 INSS 0.00 200,00','413 ADIANTAMENTO 0.00 1.000,00','TOTAL BRUTO: 3.100,00','TOTAL DE DESCONTOS: 1.200,00','LIQUIDO A RECEBER: 1.900,00'];let stream='BT /F1 10 Tf 40 750 Td ';for(const l of lines){stream+='('+l.replaceAll('(',String.fromCharCode(92)+'(').replaceAll(')',String.fromCharCode(92)+')')+') Tj 0 -20 Td ';}stream+='ET';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\\nstream\\n'+stream+'\\nendstream'];let pdf='%PDF-1.4\\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\\n'+objects[i]+'\\nendobj\\n';}const xref=pdf.length;pdf+='xref\\n0 6\\n0000000000 65535 f \\n';for(const offset of offsets.slice(1))pdf+=String(offset).padStart(10,'0')+' 00000 n \\n';pdf+='trailer << /Size 6 /Root 1 0 R >>\\nstartxref\\n'+xref+'\\n%%EOF';const buffer=new TextEncoder().encode(pdf.replaceAll('\\\\n','\\n'));const receipt=m.parsePayslip(await m.readPdf(buffer.buffer));window.__fcSmoke=receipt.final===1900&&receipt.gross===3100?'PASS':'FAIL: wrong PDF values';}catch(e){window.__fcSmoke='FAIL: '+e.message;}})();");
  waitFor("typeof window.__fcSmoke==='string' && window.__fcSmoke!=='waiting'");
  String result=js("window.__fcSmoke");if(!"\"PASS\"".equals(result))throw new Exception(result);
  report.putString("stream","PASS FolhaCerta: Android launch, local-only permissions, salary calculation, persistence, PDF.js worker and receipt parsing. WebView "+WebView.getCurrentWebViewPackage().versionName+"\n");finish(Activity.RESULT_OK,report);
 }catch(Exception e){report.putString("stream","FAIL FolhaCerta: "+android.util.Log.getStackTraceString(e)+"\n");report.putString("shortMsg",e.toString());finish(Activity.RESULT_CANCELED,report);}}
}
