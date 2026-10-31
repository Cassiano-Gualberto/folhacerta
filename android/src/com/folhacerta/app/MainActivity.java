package com.folhacerta.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.*;
import android.widget.Toast;
import java.io.*;
import java.util.*;

/** Offline wrapper: same web app, local HTTPS origin, no network/storage permission. */
public final class MainActivity extends Activity {
 private WebView web;
 private ValueCallback<Uri[]> chooser;
 private byte[] pendingExport;
 private static final String HOST="appassets.androidplatform.net";
 private static final int OPEN=20,SAVE=21;
 @Override public void onCreate(Bundle state) {
  super.onCreate(state);
  getWindow().setStatusBarColor(0xff0b151b);
  getWindow().setNavigationBarColor(0xff10212b);
  web=new WebView(this);web.setBackgroundColor(0xff0b131a);setContentView(web);
  web.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
  settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);
  web.addJavascriptInterface(new ExportBridge(),"FolhaCertaAndroid");
  web.setWebViewClient(new WebViewClient(){
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
    Uri url=request.getUrl();String p=url.getPath();
    if(!"https".equals(url.getScheme())||!HOST.equals(url.getHost())||p==null||!p.startsWith("/assets/")||p.contains(".."))return blocked();
    try{
     String local=p.substring(8);if(local.isEmpty())local="index.html";
     String mime=local.endsWith(".mjs")||local.endsWith(".js")?"text/javascript":local.endsWith(".css")?"text/css":local.endsWith(".html")?"text/html":local.endsWith(".svg")?"image/svg+xml":local.endsWith(".png")?"image/png":local.endsWith(".webmanifest")?"application/manifest+json":local.endsWith(".json")?"application/json":local.endsWith(".ttf")?"font/ttf":"application/octet-stream";
     Map<String,String> headers=new HashMap<>();headers.put("X-Content-Type-Options","nosniff");
     return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open("www/"+local));
    }catch(IOException error){return blocked();}
   }
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
    Uri uri=request.getUrl();if("https".equals(uri.getScheme())&&HOST.equals(uri.getHost()))return false;
    if(request.isForMainFrame()&&"https".equals(uri.getScheme()))try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}
    return true;
   }
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> result,FileChooserParams params){
    if(chooser!=null)chooser.onReceiveValue(null);chooser=result;
    Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);
    String[] types=params.getAcceptTypes();intent.setType(types.length>0&&types[0].contains("json")?"application/json":"application/pdf");
    try{startActivityForResult(intent,OPEN);}catch(Exception e){chooser.onReceiveValue(null);chooser=null;return false;}return true;
   }
  });
  if(state!=null)web.restoreState(state);else web.loadUrl("https://"+HOST+"/assets/index.html");
 }
 private WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
 public final class ExportBridge {
  @JavascriptInterface public void saveFile(String name,String mime,String base64){
   if(base64==null||base64.length()>14000000)return;
   if(!"application/json".equals(mime)&&!"text/csv".equals(mime))return;
   final byte[] data;try{data=Base64.decode(base64,Base64.DEFAULT);}catch(Exception e){return;}
   runOnUiThread(()->{
    if(pendingExport!=null){Toast.makeText(MainActivity.this,"Conclua a exportação atual.",Toast.LENGTH_SHORT).show();return;}
    pendingExport=data;Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(mime);intent.putExtra(Intent.EXTRA_TITLE,name.replaceAll("[^a-zA-Z0-9._-]","_"));
    try{startActivityForResult(intent,SAVE);}catch(Exception e){pendingExport=null;Toast.makeText(MainActivity.this,"Não foi possível abrir o seletor de arquivos.",Toast.LENGTH_LONG).show();}
   });
  }
 }
 @Override protected void onActivityResult(int request,int result,Intent data){
  super.onActivityResult(request,result,data);
  if(request==OPEN&&chooser!=null){chooser.onReceiveValue(result==RESULT_OK&&data!=null&&data.getData()!=null?new Uri[]{data.getData()}:null);chooser=null;}
  if(request==SAVE){byte[] bytes=pendingExport;pendingExport=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null&&bytes!=null){try(OutputStream out=getContentResolver().openOutputStream(data.getData())){if(out==null)throw new IOException();out.write(bytes);Toast.makeText(this,"Arquivo salvo.",Toast.LENGTH_SHORT).show();}catch(Exception e){Toast.makeText(this,"Não foi possível salvar o arquivo.",Toast.LENGTH_LONG).show();}}}
 }
 @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);web.saveState(state);}
 @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
 @Override protected void onDestroy(){if(chooser!=null)chooser.onReceiveValue(null);web.removeJavascriptInterface("FolhaCertaAndroid");web.destroy();super.onDestroy();}
}
