import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubmissionDetail } from "./SubmissionDetail";
import { DocumentAttachmentCard } from "./DocumentAttachmentCard";
import { PdfUpload } from "./PdfUpload";
import type { Attachment } from "@/lib/documents/status";
import { submissionRequest } from "@/lib/submissions/client";
vi.mock("@/lib/submissions/client", () => ({ submissionRequest: vi.fn() }));
const request = vi.mocked(submissionRequest);
const document: Attachment = {
  id: "pdf-1",
  file_name: "pastoral-resource.pdf",
  byte_size: "2048",
  state: "quarantined",
  excluded: false,
  clean: false,
  verification_status: "waiting",
};
const submission = {
  id: "resource-1",
  title: "A pastoral resource",
  kind: "document",
  category: "General",
  abstract: "A meaningful description of this theological resource.",
  keywords: [],
  confidential: false,
  status: "draft",
  version: 1,
  revision: 1,
  created_at: "2026-11-16T00:00:00Z",
  submitted_at: null,
};
const detail = (documents = [document]) => ({ submission, documents, history: [], feedback: [] });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
beforeEach(() => {
  request.mockResolvedValue(detail());
});
describe("submission workspace", () => {
  it("keeps queued files calm and blocks sending and downloads until trusted evidence arrives", async () => {
    render(<SubmissionDetail id="resource-1" />);
    await screen.findByText("Awaiting verification");
    const send = screen.getByRole("button", { name: "Send to TEFT for review" });
    expect(send).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Download PDF" })).not.toBeInTheDocument();
    request.mockResolvedValue(
      detail([{ ...document, state: "available", clean: true, verification_status: "ready" }]),
    );
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(send).toBeEnabled());
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute(
      "href",
      "/api/documents/pdf-1/download",
    );
  });
  it("requires meaningful saved description text before enabling submission", async () => {
    request.mockResolvedValue({
      ...detail([{ ...document, state: "available", clean: true, verification_status: "ready" }]),
      submission: { ...submission, abstract: "A          short          text" },
    });
    render(<SubmissionDetail id="resource-1" />);
    await screen.findByText("Ready for submission");
    expect(screen.getByRole("button", { name: "Send to TEFT for review" })).toBeDisabled();
    expect(
      screen.getByText("Save a title and a description of at least 20 characters."),
    ).toBeInTheDocument();
  });
  it("preserves unsaved resource details during focus refresh and scan updates", async () => {
    render(<SubmissionDetail id="resource-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit submission" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My unsaved title" } });
    request.mockResolvedValue(
      detail([{ ...document, state: "available", clean: true, verification_status: "ready" }]),
    );
    fireEvent(window, new Event("focus"));
    await screen.findByText("Ready for submission");
    expect(screen.getByLabelText("Title")).toHaveValue("My unsaved title");
    expect(screen.getByRole("button", { name: "Send to TEFT for review" })).toBeDisabled();
  });
  it("polls only outstanding checks, pauses in hidden tabs and stops after verification", async () => {
    vi.useFakeTimers();
    render(<SubmissionDetail id="resource-1" />);
    await act(async () => {});
    request.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(request).toHaveBeenCalledTimes(1);
    const visible = vi
      .spyOn(globalThis.document, "visibilityState", "get")
      .mockReturnValue("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(request).toHaveBeenCalledTimes(1);
    visible.mockReturnValue("visible");
    request.mockResolvedValue(
      detail([{ ...document, state: "available", clean: true, verification_status: "ready" }]),
    );
    await act(async () => {
      fireEvent(globalThis.document, new Event("visibilitychange"));
    });
    request.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(request).not.toHaveBeenCalled();
    visible.mockRestore();
  });
  it("clears private content and closes the editor when live authorization is revoked", async () => {
    render(<SubmissionDetail id="resource-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit submission" }));
    request.mockImplementation(async () => {
      throw Object.assign(new Error("Access denied"), { status: 403 });
    });
    await act(async () => {
      fireEvent(window, new Event("focus"));
    });
    expect(screen.getByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByText("A pastoral resource")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });
  it("confirms exclusion and explains retained history before posting", async () => {
    render(<SubmissionDetail id="resource-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Exclude attachment" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("not permanently deleted");
    expect(request.mock.calls.every((call) => call[1] === undefined)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Confirm exclusion" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/api/submissions", {
        action: "exclude",
        id: "pdf-1",
        version: 1,
      }),
    );
  });
});
describe("attachment presentation", () => {
  it.each([
    ["waiting", "Awaiting verification"],
    ["checking", "Being checked"],
    ["delayed", "Taking longer than expected"],
    ["unsuccessful", "Verification unsuccessful"],
  ])("announces %s without fabricated progress or download access", (state, label) => {
    render(<DocumentAttachmentCard document={{ ...document, verification_status: state }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("does not trust a ready label without clean available backend evidence", () => {
    render(<DocumentAttachmentCard document={{ ...document, verification_status: "ready" }} />);
    expect(screen.getByText("Verification unsuccessful")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("offers keyboard file selection, one-file drop and separate upload progress", () => {
    const onSelect = vi.fn();
    const click = vi.spyOn(HTMLInputElement.prototype, "click");
    const { container, rerender } = render(
      <PdfUpload
        selected={null}
        onSelect={onSelect}
        onUpload={() => {}}
        onCancel={() => {}}
        error=""
        checking={false}
        progress={null}
        disabled={false}
        editing={false}
        hasAttachments={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose PDF" }));
    expect(click).toHaveBeenCalled();
    const file = new File(["%PDF-1.4\n%%EOF"], "resource.pdf", { type: "application/pdf" });
    fireEvent.drop(container.querySelector(".upload-area")!, { dataTransfer: { files: [file] } });
    expect(onSelect).toHaveBeenCalledWith(file);
    rerender(
      <PdfUpload
        selected={file}
        onSelect={onSelect}
        onUpload={() => {}}
        onCancel={() => {}}
        error=""
        checking={false}
        progress={65}
        disabled={true}
        editing={false}
        hasAttachments={false}
      />,
    );
    expect(screen.getByRole("progressbar", { name: "Upload progress" })).toHaveAttribute(
      "value",
      "65",
    );
    expect(
      screen.getByText("Security verification begins after the upload is saved."),
    ).toBeInTheDocument();
    click.mockRestore();
  });
});

describe("persisted submission readiness", () => {
  it("blocks a second stale save when a committed save cannot reload its persisted revision", async () => {
    render(<SubmissionDetail id="resource-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit submission" }));
    request.mockImplementation(async (_path, body) => {
      if (body) return { id: "resource-1" };
      throw Error("Temporary read failure");
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "Save resource details" }).closest("form")!,
    );
    await screen.findByText(
      "Details saved, but the latest revision could not be loaded. Refresh before editing again.",
    );
    expect(screen.getByRole("button", { name: "Save resource details" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send to TEFT for review" })).toBeDisabled();
    expect(screen.getByText("Resource details saved").parentElement).toHaveTextContent(
      "Incomplete:",
    );
  });

  it.each([false, true])(
    "save/reopen uses the refreshed persisted description with confidentiality=%s",
    async (confidential) => {
      const clean = [
        { ...document, state: "available", clean: true, verification_status: "ready" },
      ];
      request.mockResolvedValue({
        ...detail(clean),
        submission: { ...submission, abstract: "Short", confidential },
      });
      const view = render(<SubmissionDetail id="resource-1" />);
      fireEvent.click(await screen.findByRole("button", { name: "Edit submission" }));
      fireEvent.change(screen.getByLabelText("Abstract or description"), {
        target: { value: submission.abstract },
      });
      expect(screen.getByRole("button", { name: "Send to TEFT for review" })).toBeDisabled();
      let resolveRefresh: (value: unknown) => void = () => {};
      const refreshed = new Promise((resolve) => {
        resolveRefresh = resolve;
      });
      request.mockImplementation(async (_path, body) => (body ? { id: "resource-1" } : refreshed));
      fireEvent.submit(
        screen.getByRole("button", { name: "Save resource details" }).closest("form")!,
      );
      await waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          "/api/submissions",
          expect.objectContaining({ confidential, abstract: submission.abstract }),
        ),
      );
      // Save has committed, but stale pre-save detail must not turn the checklist green.
      expect(screen.getByLabelText("Abstract or description")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send to TEFT for review" })).toBeDisabled();
      await act(async () =>
        resolveRefresh({
          ...detail(clean),
          submission: { ...submission, version: 2, confidential },
        }),
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Send to TEFT for review" })).toBeEnabled(),
      );
      expect(screen.getByText("Resource details saved").parentElement).toHaveTextContent(
        "Complete:",
      );
      view.unmount();
      request.mockResolvedValue({
        ...detail(clean),
        submission: { ...submission, version: 2, confidential },
      });
      render(<SubmissionDetail id="resource-1" />);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Send to TEFT for review" })).toBeEnabled(),
      );
    },
  );
});
