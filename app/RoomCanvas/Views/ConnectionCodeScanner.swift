import SwiftUI
import VisionKit
import UIKit

struct ConnectionCodeScanner: UIViewControllerRepresentable {
    let receive: (String) -> Void
    let failure: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(receive: receive) }

    func makeUIViewController(context: Context) -> Controller {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])],
                                                qualityLevel: .balanced, recognizesMultipleItems: false,
                                                isHighFrameRateTrackingEnabled: false, isPinchToZoomEnabled: true,
                                                isGuidanceEnabled: true, isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        return Controller(scanner: scanner, failure: failure)
    }

    func updateUIViewController(_ controller: Controller, context: Context) {}
    static func dismantleUIViewController(_ controller: Controller, coordinator: Coordinator) { controller.scanner.stopScanning() }

    final class Controller: UIViewController {
        let scanner: DataScannerViewController
        let failure: (String) -> Void
        init(scanner: DataScannerViewController, failure: @escaping (String) -> Void) {
            self.scanner = scanner; self.failure = failure
            super.init(nibName: nil, bundle: nil)
        }
        required init?(coder: NSCoder) { fatalError("Use init(scanner:failure:)") }
        override func viewDidLoad() {
            super.viewDidLoad()
            addChild(scanner)
            scanner.view.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(scanner.view)
            NSLayoutConstraint.activate([
                scanner.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), scanner.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                scanner.view.topAnchor.constraint(equalTo: view.topAnchor), scanner.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            ])
            scanner.didMove(toParent: self)
        }
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            do { try scanner.startScanning() } catch { failure(error.localizedDescription) }
        }
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let receive: (String) -> Void
        private var received = false
        init(receive: @escaping (String) -> Void) { self.receive = receive }
        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !received else { return }
            for item in addedItems {
                if case .barcode(let barcode) = item, let value = barcode.payloadStringValue,
                   let data = value.data(using: .utf8),
                   let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                   object["endpoint"] is String, object["token"] is String {
                    received = true
                    dataScanner.stopScanning()
                    receive(value)
                    break
                }
            }
        }
    }
}
