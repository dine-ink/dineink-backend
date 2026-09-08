import { describe, expect, it } from "vitest";
import path from "path";
import { sanitiseDisplayName, attachmentRoot, MAX_ATTACHMENT_BYTES } from "./attachments.service";

/**
 * Attachment handling.
 *
 * Two properties matter and neither is obvious from reading the happy path:
 * a client-supplied filename must never reach the filesystem, and the storage
 * directory must never be somewhere the app serves statically.
 */

describe("attachment display names", () => {
  it("strips path components so a name cannot traverse", () => {
    expect(sanitiseDisplayName("../../server.js")).toBe("server.js");
    expect(sanitiseDisplayName("/etc/passwd")).toBe("passwd");
    expect(sanitiseDisplayName("..\\..\\windows\\system32\\config")).not.toContain("..");
  });

  it("strips characters that would break a Content-Disposition header", () => {
    // A quote or a newline here lets the sender inject header fields.
    const injected = sanitiseDisplayName('evil".pdf\r\nX-Injected: yes');
    expect(injected).not.toContain('"');
    expect(injected).not.toContain("\r");
    expect(injected).not.toContain("\n");
  });

  it("falls back to a usable name when given nothing", () => {
    expect(sanitiseDisplayName("")).toBe("attachment");
    expect(sanitiseDisplayName("   ")).toBe("attachment");
  });

  it("caps absurd lengths", () => {
    expect(sanitiseDisplayName("a".repeat(5000)).length).toBeLessThanOrEqual(200);
  });

  it("leaves an ordinary filename alone", () => {
    expect(sanitiseDisplayName("order-92831-screenshot.png")).toBe("order-92831-screenshot.png");
  });
});

describe("attachment storage location", () => {
  /**
   * `/uploads` is served by express.static with no authentication. Anything
   * written there is readable by anyone who can guess the filename, and support
   * attachments routinely contain a diner's details. If this test ever fails,
   * the attachments have become world-readable.
   */
  it("is not inside the publicly served uploads directory", () => {
    const root = attachmentRoot();
    const publicUploads = path.resolve(path.join(__dirname, "../../../../uploads"));
    expect(root.startsWith(publicUploads + path.sep)).toBe(false);
    expect(root).not.toBe(publicUploads);
  });

  it("is an absolute path", () => {
    expect(path.isAbsolute(attachmentRoot())).toBe(true);
  });
});

describe("attachment limits", () => {
  it("caps upload size", () => {
    expect(MAX_ATTACHMENT_BYTES).toBeGreaterThan(0);
    // Large enough for a scanned invoice, small enough that a loop over the
    // endpoint cannot fill a disk quickly.
    expect(MAX_ATTACHMENT_BYTES).toBeLessThanOrEqual(25 * 1024 * 1024);
  });
});
