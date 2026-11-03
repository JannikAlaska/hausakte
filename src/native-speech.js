// Android app (WebView): the WebView has no speech recognition of its own, so the app's native one is
// offered under the browser's name (SpeechRecognition). Must run before any module reads that name.
const A = typeof window !== 'undefined' ? window.HausakteAndroid : null;

// the WebView may name a browser recognizer that does not work there - the app's always wins
if (A) {
  let available = false;
  try {
    available = A.speechAvailable();
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
        A.speechStart(this._id, this.lang || 'de-DE', !!this.interimResults);
      }
      stop() {
        if (this._id) A.speechStop(this._id);
      }
      abort() {
        if (this._id) A.speechAbort(this._id);
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
