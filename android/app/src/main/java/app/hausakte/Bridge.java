package app.hausakte;

import android.Manifest;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.speech.SpeechRecognizer;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** What the web page can ask of the phone: window.HausakteAndroid.* */
public class Bridge {
    private final MainActivity activity;
    private final Speech speech;

    Bridge(MainActivity activity, Speech speech) {
        this.activity = activity;
        this.speech = speech;
    }

    static String quote(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    @JavascriptInterface
    public String version() {
        return BuildConfig.VERSION_NAME;
    }

    /** Figures for the home screen widgets, computed by the web app (JSON, see WidgetData). */
    @JavascriptInterface
    public void setWidgetData(String json) {
        Context c = activity.getApplicationContext();
        WidgetData.save(c, json);
        WidgetData.updateAll(c);
    }

    // ---------- speech input (the WebView has no speech recognition of its own) ----------

    @JavascriptInterface
    public boolean speechAvailable() {
        return SpeechRecognizer.isRecognitionAvailable(activity);
    }

    @JavascriptInterface
    public void speechStart(int id, String lang, boolean interim) {
        activity.runOnMain(() -> activity.withPermission(Manifest.permission.RECORD_AUDIO,
                () -> speech.start(id, lang, interim),
                () -> speech.fail(id, "not-allowed")));
    }

    @JavascriptInterface
    public void speechStop(int id) {
        activity.runOnMain(() -> speech.stop(id));
    }

    @JavascriptInterface
    public void speechAbort(int id) {
        activity.runOnMain(() -> speech.abort(id));
    }

    // ---------- files ----------

    /** Saves a text file (e.g. the JSON backup) to "Downloads". */
    @JavascriptInterface
    public void saveText(String name, String mime, String text) {
        activity.runOnMain(() -> {
            try {
                byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IllegalStateException("no uri");
                    try (OutputStream o = activity.getContentResolver().openOutputStream(uri)) {
                        o.write(bytes);
                    }
                    Toast.makeText(activity, "Gespeichert unter Downloads: " + name, Toast.LENGTH_LONG).show();
                } else {
                    // older Android: hand the file to another app (Drive, Files, mail ...)
                    File dir = new File(activity.getCacheDir(), "export");
                    dir.mkdirs();
                    File f = new File(dir, name);
                    try (FileOutputStream o = new FileOutputStream(f)) {
                        o.write(bytes);
                    }
                    Uri uri = FileProvider.getUriForFile(activity, "app.hausakte.files", f);
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(mime);
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    activity.startActivity(Intent.createChooser(send, "Sicherung speichern"));
                }
            } catch (Exception e) {
                Toast.makeText(activity, "Speichern fehlgeschlagen: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    @JavascriptInterface
    public void openExternal(String url) {
        activity.runOnMain(() -> activity.openExternal(Uri.parse(url)));
    }
}
