import SwiftUI

@main
struct RoomCanvasApp: App {
    @StateObject private var library = ScanLibrary()
    @StateObject private var uploads = AutoUploadQueue.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            LibraryView()
                .environmentObject(library)
                .environmentObject(uploads)
                .tint(.teal)
                .onAppear { uploads.resume() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { uploads.resume() }
                    else if phase == .background { uploads.pause() }
                }
        }
    }
}
