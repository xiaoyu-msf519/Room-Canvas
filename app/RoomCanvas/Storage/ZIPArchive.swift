import Foundation

enum ZIPArchive {
    private struct Entry {
        var name: Data
        var crc: UInt32
        var size: UInt32
        var offset: UInt32
    }

    static func create(from directory: URL, to destination: URL) throws {
        let files = try ScanFiles.listFiles(in: directory)
        guard files.count < 65535 else { throw ScanError.message("文件数量超出 ZIP32 限制。") }
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let output = try FileHandle(forWritingTo: destination)
        defer { try? output.close() }
        var entries: [Entry] = []
        for path in files {
            let sourceURL = directory.appendingPathComponent(path)
            guard FileManager.default.fileExists(atPath: sourceURL.path) else {
                throw ScanError.message("扫描包文件在导出期间丢失：\(path)。请结束采集后重试；已保存文件仍保留。")
            }
            let source = try FileHandle(forReadingFrom: sourceURL)
            defer { try? source.close() }
            let size = try source.seekToEnd()
            let offset = try output.offset()
            let name = Data(path.utf8)
            guard size <= UInt32.max, offset <= UInt32.max, name.count <= Int(UInt16.max) else {
                throw ScanError.message("扫描包超过 ZIP32 限制，请从“文件”App 导出目录。")
            }
            try source.seek(toOffset: 0)
            var checksum: UInt32 = 0xffffffff
            while let chunk = try source.read(upToCount: 65536), !chunk.isEmpty {
                checksum = crc32(chunk, initial: checksum)
            }
            let crc = checksum ^ 0xffffffff
            var header = Data()
            header.appendLE(UInt32(0x04034b50))
            header.appendLE(UInt16(20)); header.appendLE(UInt16(0x0800))
            header.appendLE(UInt16(0)); header.appendLE(UInt16(0)); header.appendLE(UInt16(0x0021))
            header.appendLE(crc); header.appendLE(UInt32(size)); header.appendLE(UInt32(size))
            header.appendLE(UInt16(name.count)); header.appendLE(UInt16(0)); header.append(name)
            try output.write(contentsOf: header)
            try source.seek(toOffset: 0)
            while let chunk = try source.read(upToCount: 65536), !chunk.isEmpty {
                try output.write(contentsOf: chunk)
            }
            entries.append(Entry(name: name, crc: crc, size: UInt32(size), offset: UInt32(offset)))
        }
        let centralOffset = try output.offset()
        for entry in entries {
            var header = Data()
            header.appendLE(UInt32(0x02014b50))
            header.appendLE(UInt16(20)); header.appendLE(UInt16(20)); header.appendLE(UInt16(0x0800))
            header.appendLE(UInt16(0)); header.appendLE(UInt16(0)); header.appendLE(UInt16(0x0021))
            header.appendLE(entry.crc); header.appendLE(entry.size); header.appendLE(entry.size)
            header.appendLE(UInt16(entry.name.count)); header.appendLE(UInt16(0)); header.appendLE(UInt16(0))
            header.appendLE(UInt16(0)); header.appendLE(UInt16(0)); header.appendLE(UInt32(0))
            header.appendLE(entry.offset); header.append(entry.name)
            try output.write(contentsOf: header)
        }
        let finalOffset = try output.offset()
        guard finalOffset <= UInt32.max else { throw ScanError.message("扫描包超过 ZIP32 限制。") }
        var footer = Data()
        footer.appendLE(UInt32(0x06054b50)); footer.appendLE(UInt16(0)); footer.appendLE(UInt16(0))
        footer.appendLE(UInt16(entries.count)); footer.appendLE(UInt16(entries.count))
        footer.appendLE(UInt32(finalOffset - centralOffset)); footer.appendLE(UInt32(centralOffset))
        footer.appendLE(UInt16(0))
        try output.write(contentsOf: footer)
    }

    static func crc32(_ data: Data, initial: UInt32 = 0xffffffff) -> UInt32 {
        var crc = initial
        for byte in data { crc = table[Int((crc ^ UInt32(byte)) & 0xff)] ^ (crc >> 8) }
        return crc
    }

    private static let table: [UInt32] = (0..<256).map { index in
        var value = UInt32(index)
        for _ in 0..<8 { value = value & 1 == 1 ? 0xedb88320 ^ (value >> 1) : value >> 1 }
        return value
    }
}

private extension Data {
    mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
        var little = value.littleEndian
        Swift.withUnsafeBytes(of: &little) { append(contentsOf: $0) }
    }
}
