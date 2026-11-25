package app.hausakte;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.WebView;

import java.util.ArrayList;

/**
 * Android speech recognition for the web page, shaped like the browser's SpeechRecognition:
 * events go to window.__hausakteSpeech(id, type, text, isFinal) with type start|result|error|end.
 *
 * The phone's recognizer stops after every pause. In continuous mode (dictation) it is started again
 * right here, without a round trip through the page, so one session lasts until stop() or abort():
 * every finished sentence arrives as a final result, pauses and short hiccups ("recognizer busy",
 * "audio busy") are bridged. Only after several hard failures in a row does the session end.
 */
class Speech {
    private static final int MAX_FAILURES = 6;

    private final MainActivity activity;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private int current = 0;
    private boolean ended = true;
    private boolean continuous = false;
    private boolean stopping = false;
    private boolean listening = false;
    private int failures = 0;
    private String lang = "de-DE";
    private boolean interim = true;

    Speech(MainActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    void start(int id, String lang, boolean interim, boolean continuous) {
        finish(false);
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            fail(id, "service-not-allowed");
            return;
        }
        current = id;
        ended = false;
        stopping = false;
        failures = 0;
        this.lang = lang == null || lang.isEmpty() ? "de-DE" : lang;
        this.interim = interim;
        this.continuous = continuous;
        if (listen(id)) emit(id, "start", "", false);
        else fail(id, "audio-capture");
    }

    void stop(int id) {
        if (id != current || ended) return;
        stopping = true;
        if (rec != null && listening) {
            // the recognizer delivers what it heard (onResults) or reports silence (onError); both end the session
            rec.stopListening();
            main.postDelayed(() -> {
                if (id == current && !ended) finish(true);
            }, 4000);
        } else {
            finish(true);
        }
    }

    void abort(int id) {
        if (id != current || ended) return;
        stopping = true;
        if (rec != null) rec.cancel();
        emit(id, "error", "aborted", false);
        finish(true);
    }

    void fail(int id, String error) {
        emit(id, "error", error, false);
        emit(id, "end", "", false);
    }

    void destroy() {
        finish(false);
    }

    private Intent intent() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, interim);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.getPackageName());
        // let people pause before the recognizer closes a sentence (not every recognizer honours this)
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, continuous ? 4000L : 2500L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, continuous ? 3000L : 2000L);
        return i;
    }

    /** Starts one listening round; creates the recognizer when needed. */
    private boolean listen(int id) {
        try {
            if (rec == null) {
                rec = SpeechRecognizer.createSpeechRecognizer(activity);
                rec.setRecognitionListener(new Listener(id));
            }
            rec.startListening(intent());
            listening = true;
            return true;
        } catch (Exception e) {
            drop();
            listening = false;
            return false;
        }
    }

    /** The next round of a continuous session; after a hard error with a fresh recognizer. */
    private void again(int id, long delayMs, boolean fresh) {
        listening = false;
        main.postDelayed(() -> {
            if (id != current || ended || stopping) return;
            if (fresh) drop();
            if (!listen(id)) {
                if (++failures > MAX_FAILURES) {
                    emit(id, "error", "audio-capture", false);
                    finish(true);
                } else {
                    again(id, 600, true);
                }
            }
        }, delayMs);
    }

    private void drop() {
        if (rec == null) return;
        try {
            rec.destroy();
        } catch (Exception ignored) {
        }
        rec = null;
    }

    private void finish(boolean sendEnd) {
        if (sendEnd && !ended) emit(current, "end", "", false);
        ended = true;
        listening = false;
        drop();
    }

    private void emit(int id, String type, String text, boolean isFinal) {
        String js = "window.__hausakteSpeech&&window.__hausakteSpeech(" + id + ",'" + type + "'," + Bridge.quote(text) + "," + isFinal + ")";
        activity.runOnMain(() -> web.evaluateJavascript(js, null));
    }

    private static String first(Bundle b) {
        ArrayList<String> list = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return list == null || list.isEmpty() ? "" : list.get(0);
    }

    private static String code(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "not-allowed";
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "no-speech";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "network";
            case SpeechRecognizer.ERROR_AUDIO: return "audio-capture";
            default: return "aborted";
        }
    }

    private class Listener implements RecognitionListener {
        private final int id;

        Listener(int id) {
            this.id = id;
        }

        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int eventType, Bundle params) {}

        @Override
        public void onPartialResults(Bundle partial) {
            if (id != current || ended) return;
            String t = first(partial);
            if (!t.isEmpty()) {
                failures = 0;
                emit(id, "result", t, false);
            }
        }

        @Override
        public void onResults(Bundle results) {
            if (id != current || ended) return;
            String t = first(results);
            if (!t.isEmpty()) {
                failures = 0;
                emit(id, "result", t, true);
            }
            if (continuous && !stopping) again(id, 30, false);
            else finish(true);
        }

        @Override
        public void onError(int error) {
            if (id != current || ended) return;
            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS || !continuous || stopping) {
                emit(id, "error", code(error), false);
                finish(true);
                return;
            }
            // continuous: silence just starts the next round; other errors get a fresh recognizer
            boolean silence = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
            if (!silence && ++failures > MAX_FAILURES) {
                emit(id, "error", code(error), false);
                finish(true);
                return;
            }
            boolean network = error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT;
            again(id, silence ? 30 : network ? 1500 : 400, !silence);
        }
    }
}
