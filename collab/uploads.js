// Upload parsing: base64-in-JSON -> { text, parseStatus, locator, ... }.
// Honest statuses only: supported formats parse; pdf/docx/xlsx are stored-unparsed
// (server extraction not implemented); anything else is unsupported.
// NEVER fabricate extracted content.

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB raw cap

function extOf(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(String(filename || ''));
  return m ? m[1].toLowerCase() : '';
}

// Returns { ok, buffer } or { ok:false, error }.
function decodeBase64(contentBase64) {
  if (typeof contentBase64 !== 'string' || contentBase64.length === 0) {
    return { ok: false, error: 'contentBase64 is required' };
  }
  // Basic sanity: base64 alphabet only (allow whitespace/newlines).
  const compact = contentBase64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    return { ok: false, error: 'contentBase64 is not valid base64' };
  }
  const buffer = Buffer.from(compact, 'base64');
  if (buffer.length > MAX_BYTES) {
    return { ok: false, error: `upload exceeds ${MAX_BYTES} byte limit` };
  }
  return { ok: true, buffer };
}

export function parseUpload({ filename, mimeType, contentBase64 }) {
  const decoded = decodeBase64(contentBase64);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  const buffer = decoded.buffer;
  const ext = extOf(filename);
  const mime = String(mimeType || '').toLowerCase();
  const size = buffer.length;
  const base = { filename: filename || 'upload', mimeType: mimeType || '', size, format: ext || mime };

  const textOf = () => buffer.toString('utf8');

  // Plain text / markdown
  if (mime === 'text/plain' || mime === 'text/markdown' || ext === 'txt' || ext === 'md' || (!mime && (ext === 'txt' || ext === 'md'))) {
    const text = textOf();
    return {
      ok: true, buffer, ...base,
      text,
      parseStatus: 'parsed',
      note: '',
      locator: { excerpt: text.slice(0, 500) },
    };
  }

  // JSON
  if (mime === 'application/json' || ext === 'json') {
    const raw = textOf();
    let note = '';
    let text = raw;
    try {
      text = JSON.stringify(JSON.parse(raw), null, 2);
      note = 'JSON document pretty-printed for readability.';
    } catch {
      note = 'Invalid JSON; stored as plain text.';
    }
    return {
      ok: true, buffer, ...base,
      text,
      parseStatus: 'parsed',
      note,
      locator: { excerpt: text.slice(0, 500) },
    };
  }

  // CSV: first 50 rows as text + row refs
  if (mime === 'text/csv' || ext === 'csv') {
    const raw = textOf();
    const rows = raw.split(/\r?\n/);
    const kept = rows.slice(0, 50).join('\n');
    const truncated = rows.length > 50;
    return {
      ok: true, buffer, ...base,
      text: kept,
      parseStatus: 'parsed',
      note: truncated
        ? `Showing first 50 of ${rows.length} rows. Full file stored as upload.`
        : `${rows.length} rows parsed.`,
      locator: { row: 1, rowCount: rows.length, excerpt: kept.slice(0, 500) },
    };
  }

  // Binary office formats: store raw, do NOT fabricate extracted text.
  const officeNote =
    'Server extraction not implemented; parse client-side with the app\'s existing ' +
    'pdf/mammoth/xlsx libraries and attach extracted text.';
  if (
    mime === 'application/pdf' || ext === 'pdf' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === 'xlsx'
  ) {
    return {
      ok: true, buffer, ...base,
      text: '',
      parseStatus: 'stored-unparsed',
      note: officeNote,
      locator: { page: 0, sheet: '', row: 0, excerpt: '' },
    };
  }

  // Anything else: honest unsupported status.
  return {
    ok: true, buffer, ...base,
    text: '',
    parseStatus: 'unsupported',
    note: `Format '${mime || ext || 'unknown'}' is not supported for server-side parsing. Raw file stored as upload; attach extracted text manually.`,
    locator: { page: 0, sheet: '', row: 0, excerpt: '' },
  };
}
