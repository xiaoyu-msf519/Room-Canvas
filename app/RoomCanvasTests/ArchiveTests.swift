import XCTest
@testable import RoomCanvas

final class ArchiveTests: XCTestCase {
    private func cameraFrame() -> CameraFrameRecord {
        CameraFrameRecord(
            id: "frame_0001", timestamp: 1, imagePath: "frames/frame_0001.jpg",
            imageWidth: 100, imageHeight: 100, nativeImageWidth: 100, nativeImageHeight: 100,
            cameraToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
            intrinsics: [100, 0, 0, 0, 100, 0, 50, 50, 1],
            nativePixelToSavedPixel: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            trackingState: "normal", sharpness: 8, lightIntensity: nil, manuallyRequested: false
        )
    }

    func testInvalidCameraGeometryIsRejectedButOptionalMetricsAreSanitized() throws {
        var frame = cameraFrame()
        frame.sharpness = .nan
        frame.lightIntensity = .infinity
        let saved = try frame.validatedForStorage()
        XCTAssertEqual(saved.sharpness, 0)
        XCTAssertNil(saved.lightIntensity)
        XCTAssertEqual(saved.cameraToWorld, frame.cameraToWorld)
        for value in [Float.nan, Float.infinity, -Float.infinity] {
            var invalid = cameraFrame()
            invalid.cameraToWorld[12] = value
            XCTAssertThrowsError(try invalid.validatedForStorage())
        }
        frame = cameraFrame()
        frame.timestamp = .infinity
        XCTAssertThrowsError(try frame.validatedForStorage())
        frame = cameraFrame()
        frame.intrinsics[0] = .nan
        XCTAssertThrowsError(try frame.validatedForStorage())
    }

    func testEncodingFailureNamesFileAndFieldInsteadOfGenericFormatError() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try ScanFiles.createDirectory(root)
        defer { try? FileManager.default.removeItem(at: root) }
        var frame = cameraFrame()
        frame.cameraToWorld[12] = .nan
        XCTAssertThrowsError(try ScanFiles.write([frame], to: root.appendingPathComponent("cameras.json"))) { error in
            XCTAssertTrue(error.localizedDescription.contains("cameras.json"))
            XCTAssertTrue(error.localizedDescription.contains("cameraToWorld"))
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("cameras.json").path))
    }

    func testCameraIndexRecoversFromSidecarsAndExportsDirectoryWithTrailingSlash() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let folder = root.appendingPathComponent("scan", isDirectory: true)
        try ScanFiles.createDirectory(folder.appendingPathComponent("frames", isDirectory: true))
        defer { try? FileManager.default.removeItem(at: root) }
        let frame = cameraFrame()
        try Data([0xff, 0xd8, 0xff, 0xd9]).write(to: folder.appendingPathComponent(frame.imagePath))
        try ScanFiles.write(frame, to: folder.appendingPathComponent("frames/\(frame.id).json"))
        let recovered = try ScanFiles.recoverCameraFrames(directory: folder)
        XCTAssertEqual(recovered.frames.map(\.id), [frame.id])
        XCTAssertFalse(recovered.warnings.isEmpty)
        let cameras = try ScanFiles.read([CameraFrameRecord].self, at: folder.appendingPathComponent("cameras.json"))
        XCTAssertEqual(cameras.first?.cameraToWorld, frame.cameraToWorld)
        XCTAssertEqual(try ScanFiles.listFiles(in: folder), ["cameras.json", "frames/frame_0001.jpg", "frames/frame_0001.json"])
        let archive = root.appendingPathComponent("scan.zip")
        try ZIPArchive.create(from: folder, to: archive)
        let data = try Data(contentsOf: archive)
        XCTAssertNotNil(data.range(of: Data("cameras.json".utf8)))
        XCTAssertNotNil(data.range(of: Data("frames/frame_0001.json".utf8)))

        try Data("broken JSON".utf8).write(to: folder.appendingPathComponent("cameras.json"))
        let repaired = try ScanFiles.recoverCameraFrames(directory: folder)
        XCTAssertEqual(repaired.frames.map(\.id), [frame.id])
        XCTAssertTrue(try ScanFiles.listFiles(in: folder).contains { $0.hasPrefix("cameras-invalid-") })
    }

    func testBadFrameDoesNotPreventOtherFramesOrEmptyIndexBeingSaved() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try ScanFiles.createDirectory(root.appendingPathComponent("frames", isDirectory: true))
        defer { try? FileManager.default.removeItem(at: root) }
        let valid = cameraFrame()
        try Data([0xff, 0xd8]).write(to: root.appendingPathComponent(valid.imagePath))
        var invalid = valid
        invalid.id = "frame_0002"
        invalid.intrinsics[4] = .infinity
        let saved = try ScanFiles.saveCameraFrames([valid, invalid], directory: root)
        XCTAssertEqual(saved.frames.map(\.id), [valid.id])
        XCTAssertEqual(saved.warnings.count, 1)
        let empty = try ScanFiles.saveCameraFrames([invalid], directory: root)
        XCTAssertTrue(empty.frames.isEmpty)
        XCTAssertTrue(try ScanFiles.read([CameraFrameRecord].self, at: root.appendingPathComponent("cameras.json")).isEmpty)
    }

    func testCRC32MatchesKnownStandardVector() {
        XCTAssertEqual(ZIPArchive.crc32(Data("123456789".utf8)) ^ 0xffffffff, 0xcbf43926)
        XCTAssertEqual(ZIPArchive.crc32(Data()) ^ 0xffffffff, 0)
    }

    func testArchiveHeadersUnicodeNamesAndNestedFiles() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let source = root.appendingPathComponent("scan")
        try ScanFiles.createDirectory(source.appendingPathComponent("objects"))
        defer { try? FileManager.default.removeItem(at: root) }
        let payload = Data("RoomCanvas fixture".utf8)
        try payload.write(to: source.appendingPathComponent("objects/家具.json"))
        let archive = root.appendingPathComponent("scan.zip")
        try ZIPArchive.create(from: source, to: archive)
        let data = try Data(contentsOf: archive)
        XCTAssertEqual(Array(data.prefix(4)), [0x50, 0x4b, 0x03, 0x04])
        XCTAssertNotNil(data.range(of: Data("objects/家具.json".utf8)))
        XCTAssertNotNil(data.range(of: payload))
        XCTAssertEqual(Array(data.suffix(22).prefix(4)), [0x50, 0x4b, 0x05, 0x06])
        XCTAssertEqual(data[data.count - 12], 1)
    }

    func testManifestAndSceneRoundTripKeepStableIdentifiers() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try ScanFiles.createDirectory(root)
        defer { try? FileManager.default.removeItem(at: root) }
        let id = UUID()
        let manifest = ScanManifest(id: id, title: "测试房间", createdAt: Date(timeIntervalSince1970: 1_700_000_000),
                                    status: .complete, device: "test", systemVersion: "17")
        let url = root.appendingPathComponent("manifest.json")
        try ScanFiles.write(manifest, to: url)
        let decoded = try ScanFiles.read(ScanManifest.self, at: url)
        XCTAssertEqual(decoded.id, id)
        XCTAssertEqual(decoded.title, manifest.title)
        XCTAssertEqual(decoded.createdAt, manifest.createdAt)
        XCTAssertEqual(decoded.capturePolicy.maximumFrames, 300)
    }
}
