package app.hausakte;

import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.WebView;

import java.util.ArrayList;

/**
 * Android speech recognition for the web page, shaped like the browser's SpeechRecognition:
 * events go to window.__hausakteSpeech(id, type, text, isFinal) with type start|result|error|end.
 * One recognition per start(); the web code restarts it for continuous dictation.
 */
class Speech {
    private final MainActivity activity;
    private final WebView web;
    private SpeechRecognizer rec;
    private int current = 0;
    private boolean ended = true;

    Speech(MainActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    void start(int id, String lang, boolean interim) {
        finish(false);
        if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
            fail(id, "service-not-allowed");
            return;
        }
        current = id;
        ended = false;
        rec = SpeechRecognizer.createSpeechRecognizer(activity);
        rec.setRecognitionListener(new Listener(id));
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang == null || lang.isEmpty() ? "de-DE" : lang);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, interim);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, activity.getPackageName());
        // let people pause a little before the recognizer gives up
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);
        try {
            rec.startListening(i);
            emit(id, "start", "", false);
        } catch (Exception e) {
            fail(id, "audio-capture");
        }
    }

    void stop(int id) {
        if (id == current && rec != null) rec.stopListening();
    }

    void abort(int id) {
        if (id != current) return;
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

    private void finish(boolean sendEnd) {
        if (sendEnd && !ended) emit(current, "end", "", false);
        ended = true;
        if (rec != null) {
            try {
                rec.destroy();
            } catch (Exception ignored) {
            }
            rec = null;
        }
    }

    private void emit(int id, String type, String text, boolean isFinal) {
        String js = "window.__hausakteSpeech&&window.__hausakteSpeech(" + id + ",'" + type + "'," + Bridge.quote(text) + "," + isFinal + ")";
        activity.runOnMain(() -> web.evaluateJavascript(js, null));
    }

    private static String first(Bundle b) {
        ArrayList<String> list = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return list == null || list.isEmpty() ? "" : list.get(0);
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
            if (id != current) return;
            String t = first(partial);
            if (!t.isEmpty()) emit(id, "result", t, false);
        }

        @Override
        public void onResults(Bundle results) {
            if (id != current) return;
            String t = first(results);
            if (!t.isEmpty()) emit(id, "result", t, true);
            finish(true);
        }

        @Override
        public void onError(int error) {
            if (id != current) return;
            String e;
            switch (error) {
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: e = "not-allowed"; break;
                case SpeechRecognizer.ERROR_NO_MATCH:
                case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: e = "no-speech"; break;
                case SpeechRecognizer.ERROR_NETWORK:
                case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: e = "network"; break;
                case SpeechRecognizer.ERROR_AUDIO: e = "audio-capture"; break;
                case SpeechRecognizer.ERROR_CLIENT: e = "aborted"; break;
                default: e = "aborted";
            }
            emit(id, "error", e, false);
            finish(true);
        }
    }
}
