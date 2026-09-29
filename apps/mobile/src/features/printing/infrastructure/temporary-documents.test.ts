const mockRemoved: string[] = [];
const mockFiles = new Map<string, { uri: string; name: string; exists: boolean; delete: () => void }>();
jest.mock("expo-file-system", () => {
  class MockFile {
    uri: string;
    name: string;
    exists = true;
    constructor(uri: string) { this.uri = uri; this.name = uri.split("/").pop() ?? ""; }
    delete() { mockRemoved.push(this.uri); this.exists = false; }
  }
  return { File: MockFile, Paths: { cache: { uri: "file:///cache/", list: () => [...mockFiles.values()] } } };
});

import { temporaryDocuments } from "@mobile/features/printing/infrastructure/temporary-documents";
const MockFile = jest.requireMock("expo-file-system").File as new (uri: string) => { uri: string; name: string; exists: boolean; delete: () => void };

beforeEach(() => { mockFiles.clear(); mockRemoved.length = 0; });

test("only removes owned print files, including orphans", async () => {
  mockFiles.set("print", new MockFile("file:///cache/yoyos-label-123.png"));
  mockFiles.set("other", new MockFile("file:///cache/other.png"));
  expect(await temporaryDocuments.removeOrphans()).toEqual({ success: true, data: undefined });
  expect(mockRemoved).toEqual(["file:///cache/yoyos-label-123.png"]);
  expect(await temporaryDocuments.remove({ uri: "file:///other/yoyos-label-456.png", widthPx: 1, heightPx: 1 })).toMatchObject({ success: false, error: { code: "CLEANUP_FAILED" } });
});
