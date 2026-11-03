import AVFoundation
import Foundation
import Speech

/// Apple speech recognition for the web page, shaped like the browser's SpeechRecognition
/// (events start | result | error | end, see src/native-speech.js). One recognition per start();
/// without "continuous" it ends after a short pause, like in the browser.
final class Speech {
    static var isSupported: Bool { SFSpeechRecognizer(locale: Locale(identifier: "de-DE")) != nil }

    var onEvent: ((Int, String, String, Bool) -> Void)?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var current = 0
    private var ended = true
    private var silence: DispatchWorkItem?

    func start(id: Int, lang: String, interim: Bool, continuous: Bool) {
        finish(sendEnd: true)
        current = id
        ended = false
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard id == self.current else { return }
                guard status == .authorized else { return self.fail(id, "not-allowed") }
                AVAudioSession.sharedInstance().requestRecordPermission { ok in
                    DispatchQueue.main.async {
                        guard id == self.current else { return }
                        guard ok else { return self.fail(id, "not-allowed") }
                        self.begin(id: id, lang: lang, interim: interim, continuous: continuous)
                    }
                }
            }
        }
    }

    private func begin(id: Int, lang: String, interim: Bool, continuous: Bool) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang.isEmpty ? "de-DE" : lang)), recognizer.isAvailable else {
            return fail(id, "service-not-allowed")
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            request = req
            let input = engine.inputNode
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                req.append(buffer)
            }
            engine.prepare()
            try engine.start()
            emit(id, "start", "", false)
            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                DispatchQueue.main.async {
                    guard let self, id == self.current, !self.ended else { return }
                    if let result {
                        let text = result.bestTranscription.formattedString
                        if !text.isEmpty, interim || result.isFinal { self.emit(id, "result", text, result.isFinal) }
                        if result.isFinal {
                            self.finish(sendEnd: true)
                        } else if !continuous {
                            // a short pause ends the input, like in the browser
                            self.silence?.cancel()
                            let w = DispatchWorkItem { [weak self] in self?.stop(id: id) }
                            self.silence = w
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.8, execute: w)
                        }
                    } else if let error {
                        let code = (error as NSError).code
                        self.emit(id, "error", code == 1110 ? "no-speech" : "aborted", false)
                        self.finish(sendEnd: true)
                    }
                }
            }
        } catch {
            fail(id, "audio-capture")
        }
    }

    func stop(id: Int) {
        guard id == current, !ended else { return }
        silence?.cancel()
        if engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        // the final result follows and ends the recognition; make sure it ends anyway
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, id == self.current, !self.ended else { return }
            self.finish(sendEnd: true)
        }
    }

    func abort(id: Int) {
        guard id == current, !ended else { return }
        task?.cancel()
        emit(id, "error", "aborted", false)
        finish(sendEnd: true)
    }

    private func fail(_ id: Int, _ error: String) {
        emit(id, "error", error, false)
        if id == current {
            finish(sendEnd: true)
        } else {
            emit(id, "end", "", false)
        }
    }

    private func finish(sendEnd: Bool) {
        silence?.cancel()
        silence = nil
        if engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if sendEnd && !ended { emit(current, "end", "", false) }
        ended = true
    }

    private func emit(_ id: Int, _ type: String, _ text: String, _ isFinal: Bool) {
        onEvent?(id, type, text, isFinal)
    }
}
