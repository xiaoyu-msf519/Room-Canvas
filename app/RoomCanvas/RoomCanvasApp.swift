import SwiftUI

@main
struct RoomCanvasApp: App {
    @StateObject private var library = ScanLibrary()

    var body: some Scene {
        WindowGroup {
            LibraryView()
                .environmentObject(library)
                .tint(.teal)
        }
    }
}
