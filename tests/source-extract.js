'use strict';

// Shared by the source-executing suites: pulls a real function out of main.js /
// renderer source so tests run the shipped implementation, not a copy.

// ---------------------------------------------------------------------------
// Lexer-aware extractor: finds "function NAME(" at identifier boundary and
// slices to the matching closing brace, skipping strings, templates, comments,
// and regex literals (so quantifier braces like {1,3} never confuse depth).
// ---------------------------------------------------------------------------

const KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'new', 'delete', 'void', 'instanceof', 'yield', 'await']);

function regexAllowed(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  if ('([{=,:;!&|?+-~^%*<>'.includes(src[j])) return true;
  const m = /([A-Za-z$_][A-Za-z0-9$_]*)$/.exec(src.slice(0, j + 1));
  if (!m) return true;
  return KEYWORDS.has(m[1]);
}

function extractFunction(src, name) {
  const sig = 'function ' + name + '(';
  let start = -1;
  let idx = src.indexOf(sig);
  while (idx > -1) {
    const prev = idx > 0 ? src[idx - 1] : '\n';
    if (!/[A-Za-z0-9_$]/.test(prev)) { start = idx; break; }
    idx = src.indexOf(sig, idx + 1);
  }
  if (start < 0) return null;
  let i = src.indexOf('{', start);
  if (i < 0) return null;
  let depth = 0;
  let state = 'code';
  for (; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (state === 'squote') { if (c === '\\') i++; else if (c === "'") state = 'code'; }
    else if (state === 'dquote') { if (c === '\\') i++; else if (c === '"') state = 'code'; }
    else if (state === 'template') { if (c === '\\') i++; else if (c === '`') state = 'code'; }
    else if (state === 'line') { if (c === '\n') state = 'code'; }
    else if (state === 'block') { if (c === '*' && n === '/') { i++; state = 'code'; } }
    else if (state === 'regex') {
      if (c === '\\') i++;
      else if (c === '[') state = 'regexclass';
      else if (c === '/') state = 'code';
    }
    else if (state === 'regexclass') { if (c === '\\') i++; else if (c === ']') state = 'regex'; }
    else {
      if (c === "'") state = 'squote';
      else if (c === '"') state = 'dquote';
      else if (c === '`') state = 'template';
      else if (c === '/' && n === '/') { state = 'line'; i++; }
      else if (c === '/' && n === '*') { state = 'block'; i++; }
      else if (c === '/') { if (regexAllowed(src, i)) state = 'regex'; }
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
  }
  return null;
}

module.exports = { extractFunction };
