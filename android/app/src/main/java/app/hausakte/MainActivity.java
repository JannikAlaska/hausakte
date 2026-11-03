package app.hausakte;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The app: a full-screen WebView showing the Hausakte web version. The web code talks to the
 * phone through {@link Bridge} (widgets, speech input, saving files); widgets and launcher shortcuts
 * open the app with an action ("rechnung", "notiz", "todo") or a view ("grundriss", "projekte" ...).
 */
public class MainActivity extends Activity {
    static final String EXTRA_ACTION = "aktion";
    static final String EXTRA_VIEW = "ansicht";

    private static final int REQ_FILE = 11;
    private static final int REQ_PERMISSION = 20;

    private WebView web;
    private Speech speech;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private boolean pageLoaded;
    private String pendingCommand;
    private int permissionSeq = 0;
    private final Map<Integer, Runnable[]> permissionCallbacks = new HashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web = new WebView(this);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " HausakteApp/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);

        speech = new Speech(this, web);
        web.addJavascriptInterface(new Bridge(this, speech), "HausakteAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> openExternal(Uri.parse(url)));

        String command = commandOf(getIntent());
        if (state != null && web.restoreState(state) != null) {
            pendingCommand = command;
        } else {
            web.loadUrl(urlFor(command));
        }
    }

    // ---------- intents from widgets, shortcuts and links ----------

    /** "aktion:todo", "ansicht:grundriss" or null for the start page. */
    static String commandOf(Intent intent) {
        if (intent == null) return null;
        String action = intent.getStringExtra(EXTRA_ACTION);
        if (action != null) return "aktion:" + action;
        String view = intent.getStringExtra(EXTRA_VIEW);
        if (view != null) return "ansicht:" + view;
        Uri data = intent.getData();
        if (data != null && BuildConfig.APP_HOST.equals(data.getHost())) {
            String a = data.getQueryParameter("aktion");
            if (a != null) return "aktion:" + a;
            String frag = data.getFragment();
            if (frag != null && !frag.isEmpty() && !"cockpit".equals(frag)) return "ansicht:" + frag;
        }
        return null;
    }

    static String urlFor(String command) {
        if (command == null) return BuildConfig.APP_URL;
        if (command.startsWith("aktion:")) return BuildConfig.APP_URL + "?aktion=" + Uri.encode(command.substring(7)) + "#cockpit";
        return BuildConfig.APP_URL + "#" + Uri.encode(command.substring(8));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String command = commandOf(intent);
        if (command == null) return;
        if (pageLoaded) runCommand(command);
        else pendingCommand = command;
    }

    private void runCommand(String command) {
        String js = "(function(){try{if(window.__hausakteCommand){window.__hausakteCommand(" + Bridge.quote(command) + ");return 1}}catch(e){}return 0})()";
        web.evaluateJavascript(js, v -> {
            if (!"1".equals(v)) web.loadUrl(urlFor(command));
        });
    }

    // ---------- back key: close what is open in the web app, otherwise go to the home screen ----------

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(function(){try{return window.__hausakteBack&&window.__hausakteBack()?1:0}catch(e){return 0}})()", v -> {
            if ("1".equals(v)) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        speech.destroy();
        web.destroy();
        super.onDestroy();
    }

    // ---------- links ----------

    private boolean isOwn(Uri u) {
        return u != null && "https".equals(u.getScheme()) && BuildConfig.APP_HOST.equals(u.getHost());
    }

    void openExternal(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Keine App zum Öffnen gefunden.", Toast.LENGTH_SHORT).show();
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (isOwn(u)) return false;
            if ("blob".equals(u.getScheme()) || "data".equals(u.getScheme())) return false;
            openExternal(u);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            pageLoaded = true;
            if (pendingCommand != null) {
                String c = pendingCommand;
                pendingCommand = null;
                // give the web app a moment to start
                main.postDelayed(() -> runCommand(c), 1200);
            }
        }
    }

    // ---------- camera, files and microphone for the web page ----------

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            String[] accept = params.getAcceptTypes();
            boolean images = acceptsImages(accept);
            boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
            if (images && params.isCaptureEnabled()) {
                withPermission(Manifest.permission.CAMERA, MainActivity.this::openCamera, () -> pickFiles(accept, multiple, false));
            } else {
                pickFiles(accept, multiple, images && granted(Manifest.permission.CAMERA));
            }
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            main.post(() -> {
                List<String> needed = new ArrayList<>();
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) needed.add(Manifest.permission.RECORD_AUDIO);
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) needed.add(Manifest.permission.CAMERA);
                }
                if (needed.isEmpty()) {
                    request.deny();
                    return;
                }
                withPermissions(needed.toArray(new String[0]), () -> request.grant(request.getResources()), request::deny);
            });
        }
    }

    private static boolean acceptsImages(String[] accept) {
        if (accept == null || accept.length == 0) return true;
        for (String a : accept) {
            if (a == null || a.trim().isEmpty() || a.startsWith("image/") || "*/*".equals(a)) return true;
            String e = a.toLowerCase(Locale.ROOT);
            if (e.equals(".jpg") || e.equals(".jpeg") || e.equals(".png") || e.equals(".heic")) return true;
        }
        return false;
    }

    private static String mimeOf(String a) {
        String t = a.trim().toLowerCase(Locale.ROOT);
        if (t.contains("/")) return t;
        switch (t) {
            case ".pdf": return "application/pdf";
            case ".json": return "application/json";
            case ".jpg": case ".jpeg": return "image/jpeg";
            case ".png": return "image/png";
            case ".heic": return "image/heic";
            case ".csv": return "text/csv";
            case ".txt": return "text/plain";
            default: return "*/*";
        }
    }

    private File newCameraFile() {
        File dir = new File(getCacheDir(), "camera");
        if (!dir.exists()) dir.mkdirs();
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) if (System.currentTimeMillis() - f.lastModified() > 86400000L) f.delete();
        return new File(dir, "Foto_" + System.currentTimeMillis() + ".jpg");
    }

    private Intent cameraIntent() {
        File f = newCameraFile();
        cameraUri = FileProvider.getUriForFile(this, "app.hausakte.files", f);
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        i.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        i.setClipData(ClipData.newRawUri("", cameraUri));
        return i;
    }

    private void openCamera() {
        try {
            startActivityForResult(cameraIntent(), REQ_FILE);
        } catch (ActivityNotFoundException e) {
            cameraUri = null;
            pickFiles(new String[] {"image/*"}, false, false);
        }
    }

    private void pickFiles(String[] accept, boolean multiple, boolean withCamera) {
        List<String> mimes = new ArrayList<>();
        if (accept != null) for (String a : accept) if (a != null && !a.trim().isEmpty()) mimes.add(mimeOf(a));
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        if (mimes.size() == 1) pick.setType(mimes.get(0));
        else {
            pick.setType("*/*");
            if (mimes.size() > 1 && !mimes.contains("*/*")) pick.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        }
        if (multiple) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        Intent chooser = Intent.createChooser(pick, "Datei auswählen");
        cameraUri = null;
        if (withCamera) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] {cameraIntent()});
        try {
            startActivityForResult(chooser, REQ_FILE);
        } catch (ActivityNotFoundException e) {
            deliverFiles(null);
        }
    }

    private void deliverFiles(Uri[] uris) {
        if (fileCallback != null) fileCallback.onReceiveValue(uris);
        fileCallback = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE) return;
        if (resultCode != RESULT_OK) {
            deliverFiles(null);
            return;
        }
        List<Uri> out = new ArrayList<>();
        if (data != null && data.getClipData() != null && data.getData() == null && !isCameraClip(data.getClipData())) {
            ClipData c = data.getClipData();
            for (int i = 0; i < c.getItemCount(); i++) out.add(c.getItemAt(i).getUri());
        } else if (data != null && data.getData() != null) {
            out.add(data.getData());
        } else if (cameraUri != null) {
            out.add(cameraUri);
        }
        cameraUri = null;
        deliverFiles(out.isEmpty() ? null : out.toArray(new Uri[0]));
    }

    private boolean isCameraClip(ClipData c) {
        return cameraUri != null && c.getItemCount() == 1 && cameraUri.equals(c.getItemAt(0).getUri());
    }

    // ---------- runtime permissions ----------

    boolean granted(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    void withPermission(String permission, Runnable ok, Runnable denied) {
        withPermissions(new String[] {permission}, ok, denied);
    }

    void withPermissions(String[] permissions, Runnable ok, Runnable denied) {
        List<String> missing = new ArrayList<>();
        for (String p : permissions) if (!granted(p)) missing.add(p);
        if (missing.isEmpty()) {
            ok.run();
            return;
        }
        int code = REQ_PERMISSION + (permissionSeq++ % 1000);
        permissionCallbacks.put(code, new Runnable[] {ok, denied});
        requestPermissions(missing.toArray(new String[0]), code);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        Runnable[] cb = permissionCallbacks.remove(requestCode);
        if (cb == null) return;
        boolean all = results.length > 0;
        for (int r : results) if (r != PackageManager.PERMISSION_GRANTED) all = false;
        if (all) cb[0].run();
        else {
            Toast.makeText(this, "Ohne diese Berechtigung geht das leider nicht. Du kannst sie in den Android-Einstellungen der App erlauben.", Toast.LENGTH_LONG).show();
            cb[1].run();
        }
    }

    void runOnMain(Runnable r) {
        main.post(r);
    }
}
