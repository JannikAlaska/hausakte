// The Android and iPad apps (a WebView around this page) offer the device's own functions through one
// interface, nativeBridge. Speech input: WebViews have no working speech recognition of their own, so the
// device's is offered under the browser's name (SpeechRecognition). Must run before any module reads it.
const AND = typeof window !== 'undefined' ? window.HausakteAndroid : null;
const IOS = typeof window !== 'undefined' && window.HausakteIOS && window.webkit?.messageHandlers?.hausakte ? window.HausakteIOS : null;
const post = (m) => window.webkit.messageHandlers.hausakte.postMessage(m);

export const nativeBridge = AND
  ? {
      kind: 'android',
      version: () => AND.version(),
      setWidgetData: (json) => AND.setWidgetData(json),
      saveText: (name, mime, text) => AND.saveText(name, mime, text),
      speechAvailable: () => AND.speechAvailable(),
      speechStart: (id, lang, interim) => AND.speechStart(id, lang, interim),
      speechStop: (id) => AND.speechStop(id),
      speechAbort: (id) => AND.speechAbort(id),
    }
  : IOS
    ? {
        kind: 'ios',
        version: () => IOS.version,
        setWidgetData: (json) => post({ type: 'widgets', json }),
        saveText: (name, mime, text) => post({ type: 'saveText', name, mime, text }),
        speechAvailable: () => !!IOS.speech,
        speechStart: (id, lang, interim, continuous) => post({ type: 'speechStart', id, lang, interim, continuous }),
        speechStop: (id) => post({ type: 'speechStop', id }),
        speechAbort: (id) => post({ type: 'speechAbort', id }),
      }
    : null;

const N = nativeBridge;
if (N) {
  let available = false;
  try {
    available = N.speechAvailable();
  } catch {}
  if (available) {
    const running = new Map();
    let seq = 1;
    class NativeSpeechRecognition {
      constructor() {
        this.lang = 'de-DE';
        this.continuous = false;
        this.interimResults = false;
        this.maxAlternatives = 1;
        this.onstart = this.onresult = this.onerror = this.onend = null;
        this._id = 0;
      }
      start() {
        this._id = seq++;
        running.set(this._id, this);
        N.speechStart(this._id, this.lang || 'de-DE', !!this.interimResults, !!this.continuous);
      }
      stop() {
        if (this._id) N.speechStop(this._id);
      }
      abort() {
        if (this._id) N.speechAbort(this._id);
      }
    }
    // events from the app: start | result (text, isFinal) | error (code) | end
    window.__hausakteSpeech = (id, type, text, isFinal) => {
      const r = running.get(id);
      if (!r) return;
      if (type === 'start') r.onstart?.({});
      else if (type === 'result') {
        const res = [{ transcript: text, confidence: 1 }];
        res.isFinal = !!isFinal;
        r.onresult?.({ resultIndex: 0, results: [res] });
      } else if (type === 'error') r.onerror?.({ error: text });
      else if (type === 'end') {
        running.delete(id);
        r.onend?.({});
      }
    };
    window.SpeechRecognition = NativeSpeechRecognition;
    window.webkitSpeechRecognition = NativeSpeechRecognition;
  }
}
