export type Attachment = {
  id: string;
  file_name: string;
  byte_size: string;
  state: string;
  excluded: boolean;
  clean: boolean;
  verification_status?: string | null;
};
export function documentStatus(document: Attachment) {
  if (document.excluded)
    return {
      key: "excluded",
      label: "Excluded from this revision",
      help: "Retained privately for history. This PDF will not be sent with this revision.",
    };
  if (document.state === "available" && document.clean)
    return {
      key: "ready",
      label: "Ready for submission",
      help: "Your PDF passed the required security check and is ready to be sent to TEFT.",
    };
  switch (document.verification_status) {
    case "checking":
      return {
        key: "checking",
        label: "Being checked",
        help: "We're checking your PDF before making it available for submission.",
      };
    case "delayed":
      return {
        key: "delayed",
        label: "Taking longer than expected",
        help: "Your file is saved, but verification is taking longer than usual. You can return later.",
      };
    case "waiting":
      return {
        key: "waiting",
        label: "Awaiting verification",
        help: "Your PDF has been uploaded and is waiting for a security check. You can leave this page and return later.",
      };
    case "uploading":
      return {
        key: "uploading",
        label: "Upload not yet complete",
        help: "This upload has not finished. Refresh the attachment list before retrying an interrupted upload.",
      };
    default:
      return {
        key: "unsuccessful",
        label: "Verification unsuccessful",
        help: "We couldn't verify this PDF. It cannot be submitted. Please follow the available recovery instructions or contact support.",
      };
  }
}
export function needsVerification(document: Attachment) {
  return (
    !document.excluded &&
    ["waiting", "checking", "delayed", "uploading"].includes(documentStatus(document).key)
  );
}
