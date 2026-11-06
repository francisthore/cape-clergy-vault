import type { MalwareScanner, ScannerHealth, ScanResult } from "./scanner.server.ts";
// Explicit dependency injection for disposable fixtures only; never selected by configuration.
export class TestScanner implements MalwareScanner {
  readonly name = "TestScanner";
  private result: ScanResult;
  constructor(result: ScanResult = { verdict: "clean" }) {
    this.result = result;
  }
  async health(): Promise<ScannerHealth> {
    return {
      ready: true,
      reachable: true,
      engineAvailable: true,
      signaturesAvailable: true,
      fresh: true,
      testObjectPassed: true,
    };
  }
  async scan(bytes: AsyncIterable<Uint8Array>): Promise<ScanResult> {
    if (process.env["NODE_ENV"] === "production")
      throw Error("TestScanner forbidden in production");
    for await (const chunk of bytes) void chunk;
    return {
      engine: "TestScanner (disposable fixtures only)",
      definitionsVersion: "test-1",
      definitionsAt: new Date(),
      ...this.result,
    };
  }
}
