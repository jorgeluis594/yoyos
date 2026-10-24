import { createServer, type Server } from "node:http";

// Minimal path-style S3: PUT stores the object, GET returns it. The SDK sends aws-chunked bodies, which are decoded here.
function decodeAwsChunked(body: Buffer) {
  const parts: Buffer[] = [];
  for (let offset = 0; ;) {
    const headerEnd = body.indexOf("\r\n", offset);
    const size = parseInt(body.subarray(offset, headerEnd).toString().split(";")[0], 16);
    if (!size) return Buffer.concat(parts);
    parts.push(body.subarray(headerEnd + 2, headerEnd + 2 + size));
    offset = headerEnd + 2 + size + 2;
  }
}
/** Starts the fake S3 the e2e server reads and writes through R2_ENDPOINT (port + 1000). */
export async function startFakeS3(port: number): Promise<Server> {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const storage = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const key = request.url!.split("?")[0];
      if (request.method === "PUT") {
        const body = Buffer.concat(chunks);
        const chunked = String(request.headers["x-amz-content-sha256"]).startsWith("STREAMING-");
        objects.set(key, { bytes: chunked ? decodeAwsChunked(body) : body, contentType: String(request.headers["content-type"]) });
        return response.writeHead(200).end();
      }
      const object = objects.get(key);
      if (!object) return response.writeHead(404, { "content-type": "application/xml" }).end("<Error><Code>NoSuchKey</Code></Error>");
      response.writeHead(200, { "content-type": object.contentType }).end(object.bytes);
    });
  });
  await new Promise<void>((resolve) => storage.listen(port, "127.0.0.1", resolve));
  return storage;
}
