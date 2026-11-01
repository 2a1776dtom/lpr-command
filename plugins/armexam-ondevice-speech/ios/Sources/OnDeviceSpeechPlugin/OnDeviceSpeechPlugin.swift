import Foundation
import AVFoundation
import Speech
import Capacitor

/// On-device dictation for ARM Exam chart fields.
/// Uses SFSpeechRecognizer with requiresOnDeviceRecognition = true, so audio never leaves the phone.
/// If the device cannot recognize on device, start() rejects with code NO_ON_DEVICE and the web
/// layer falls back to the iOS keyboard dictation key.
@objc(OnDeviceSpeechPlugin)
public class OnDeviceSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OnDeviceSpeechPlugin"
    public let jsName = "OnDeviceSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var lastText = ""
    private var running = false

    private func makeRecognizer(_ call: CAPPluginCall) -> SFSpeechRecognizer? {
        let id = call.getString("locale") ?? "en-US"
        return SFSpeechRecognizer(locale: Locale(identifier: id))
    }

    @objc public func available(_ call: CAPPluginCall) {
        let r = makeRecognizer(call)
        call.resolve([
            "available": r?.isAvailable ?? false,
            "onDevice": r?.supportsOnDeviceRecognition ?? false
        ])
    }

    @objc public func authorize(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            let speechOk = status == .authorized
            AVAudioSession.sharedInstance().requestRecordPermission { micOk in
                call.resolve(["speech": speechOk, "microphone": micOk])
            }
        }
    }

    @objc public func start(_ call: CAPPluginCall) {
        let rec = makeRecognizer(call)
        DispatchQueue.main.async {
            self.stopEngine()
            guard let rec = rec, rec.isAvailable else {
                call.reject("Speech recognition is not available right now", "UNAVAILABLE")
                return
            }
            guard rec.supportsOnDeviceRecognition else {
                call.reject("On-device recognition is not supported on this device", "NO_ON_DEVICE")
                return
            }
            guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
                call.reject("Speech recognition permission not granted", "NO_PERMISSION")
                return
            }
            do {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.record, mode: .measurement, options: .duckOthers)
                try session.setActive(true, options: .notifyOthersOnDeactivation)
                let req = SFSpeechAudioBufferRecognitionRequest()
                req.shouldReportPartialResults = true
                req.requiresOnDeviceRecognition = true
                if #available(iOS 16.0, *) {
                    req.addsPunctuation = true
                }
                let input = self.audioEngine.inputNode
                let format = input.outputFormat(forBus: 0)
                input.removeTap(onBus: 0)
                input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                    req.append(buffer)
                }
                self.audioEngine.prepare()
                try self.audioEngine.start()
                self.recognizer = rec
                self.request = req
                self.lastText = ""
                self.running = true
                self.task = rec.recognitionTask(with: req) { [weak self] result, error in
                    guard let self = self else { return }
                    if let result = result {
                        let text = result.bestTranscription.formattedString
                        DispatchQueue.main.async {
                            self.lastText = text
                        }
                        self.notifyListeners("partial", data: ["text": text, "final": result.isFinal])
                        if result.isFinal {
                            self.finish()
                        }
                    } else if error != nil {
                        self.finish()
                    }
                }
                call.resolve(["started": true])
            } catch {
                self.stopEngine()
                call.reject("Could not start the microphone: \(error.localizedDescription)", "MIC_ERROR")
            }
        }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let text = self.lastText
            self.stopEngine()
            call.resolve(["text": text])
        }
    }

    private func finish() {
        DispatchQueue.main.async {
            let wasRunning = self.running
            let text = self.lastText
            self.stopEngine()
            if wasRunning {
                self.notifyListeners("end", data: ["text": text])
            }
        }
    }

    private func stopEngine() {
        running = false
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
