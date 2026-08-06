import fs from "fs";
import path from "path";
import multer from "multer";

const uploadPath = path.join(__dirname, "../../uploads");

// 🔥 ensure folder exists
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

// Logos are the only thing uploaded through this middleware — restrict to
// image types by MIME (never trust the client-supplied filename/extension
// alone) and cap size, so an arbitrary file (e.g. an .html/.svg with an
// embedded script) can't be uploaded and then served back same-origin from
// /uploads as a stored-XSS vector, and so a huge upload can't fill disk.
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

// Compliance documents (FSSAI licenses, fire safety certificates, GST filing
// proofs, etc.) are frequently scanned/exported as PDFs, not just images —
// this set extends the image-only allowlist above with application/pdf, and
// is used ONLY by the separate `uploadDocument` instance below so the
// image-only `upload` export other modules rely on stays unchanged.
const DOCUMENT_ALLOWED_MIME_TYPES = new Set([...ALLOWED_MIME_TYPES, "application/pdf"]);
const DOCUMENT_EXTENSION_BY_MIME: Record<string, string> = {
  ...EXTENSION_BY_MIME,
  "application/pdf": ".pdf",
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Never derive the on-disk filename from the client-supplied
    // originalname (path-traversal risk, e.g. "../../server.js") — generate
    // one from a safe timestamp/random suffix and an extension derived from
    // the validated MIME type instead.
    const ext = EXTENSION_BY_MIME[file.mimetype] || ".bin";
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB — generous for a logo image
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("Only PNG, JPEG, WEBP, or GIF images are allowed"));
      return;
    }
    cb(null, true);
  },
});

// Same disk storage / safe-filename pattern as `upload` above, but for
// compliance documents (licenses, certificates, filing receipts) which may
// be PDFs as well as scanned images. Kept as a fully separate multer
// instance (own storage config, own fileFilter) so the image-only `upload`
// export above is untouched for the modules already depending on it.
const documentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = DOCUMENT_EXTENSION_BY_MIME[file.mimetype] || ".bin";
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

export const uploadDocument = multer({
  storage: documentStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — scanned certificates/PDFs run larger than a logo image
  fileFilter: (req, file, cb) => {
    if (!DOCUMENT_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("Only PNG, JPEG, WEBP, GIF images or PDF documents are allowed"));
      return;
    }
    cb(null, true);
  },
});
